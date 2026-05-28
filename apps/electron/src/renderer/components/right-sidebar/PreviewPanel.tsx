/**
 * PreviewPanel — dedicated right-sidebar pane for reading markdown docs.
 *
 * Independent panel type ('preview') sibling to 'docs' (Info). User opens it
 * via right-click → "Open in sidebar" on any .md in the file trees; the
 * file becomes a tab inside this panel, and the panel takes over the right
 * sidebar (mutually exclusive with Info — switch via the sidebar toolbar
 * buttons in AppShell).
 *
 * State is per-session via sidebarDocsAtomFamily. Switching sessions
 * automatically swaps the visible tabs. Closing the last tab keeps the
 * panel visible (showing an empty-state) rather than auto-collapsing —
 * matches Notion / Obsidian behavior where the pane stays open.
 *
 * Content is fetched on tab activation and cached locally so flipping
 * between tabs is instant. ⌘R while this panel is active refreshes the
 * current tab (wired through useLinkInterceptor's keyboard listener via
 * a per-panel refresh trigger).
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { useAtom } from 'jotai'
import { FileText, X, RotateCw, FolderSearch, Maximize2, GitCompare } from 'lucide-react'
import { createPatch } from 'diff'
import { Markdown, UnifiedDiffViewer } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { useAppShellContext } from '@/context/AppShellContext'
import { sidebarDocsAtomFamily, closeSidebarDocTab, openSidebarDocTab } from '@/atoms/sidebar-docs'
import { infoPopoverOpenAtom } from '@/atoms/info-popover'
// dnd-kit primitives — kept inline here (vs reusing SortableList) because
// SortableList uses vertical strategy and we want horizontal for the tab strip.
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface PreviewPanelProps {
  closeButton?: React.ReactNode
}

/** Strip directory + `.md` for the tab label; fall back to full filename. */
function tabLabel(filePath: string): string {
  const base = filePath.split('/').pop() ?? filePath
  return base.replace(/\.md$/i, '')
}

function PreviewPanelContent({
  sessionId,
  closeButton,
}: {
  sessionId: string
  closeButton?: React.ReactNode
}) {
  const [state, setState] = useAtom(sidebarDocsAtomFamily(sessionId))
  const { onOpenFile } = useAppShellContext()
  const setInfoPopoverOpen = useSetAtom(infoPopoverOpenAtom)
  // Per-tab content cache. `previous` carries the version before the most
  // recent change (set by the auto-refresh poll). When present, the user
  // can toggle a diff view that compares previous vs current.
  const [contents, setContents] = React.useState<Record<string, { content?: string; previous?: string; error?: string }>>({})
  // Whether the active tab is currently rendered as a diff (toggled via
  // the GitCompare icon in the header). Keyed by filePath so flipping
  // tabs preserves each tab's mode independently.
  const [diffViewForPath, setDiffViewForPath] = React.useState<Record<string, boolean>>({})
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  // Per-tab scroll position memory — when the user flips between tabs and
  // back, restore the scrollTop they left off at. Lives in a ref (not state)
  // because changes don't need to trigger re-render; the value is consulted
  // on tab activation and written on every scroll.
  const scrollPositionsRef = React.useRef<Record<string, number>>({})
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  // Drag-drop hint — visual highlight when a draggable file is over the panel.
  const [isDragActive, setIsDragActive] = React.useState(false)

  const activeTab = state.activeIndex >= 0 ? state.tabs[state.activeIndex] : null

  // Load active-tab content on tab activation or refresh.
  // Caches by filePath so flipping tabs is instant; refresh bypasses cache.
  React.useEffect(() => {
    if (!activeTab) return
    const filePath = activeTab.filePath
    let cancelled = false
    window.electronAPI
      .readFile(filePath)
      .then((content) => {
        if (cancelled) return
        setContents((prev) => ({ ...prev, [filePath]: { content } }))
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Failed to read file'
        setContents((prev) => ({ ...prev, [filePath]: { content: '', error: message } }))
      })
    return () => {
      cancelled = true
    }
  }, [activeTab?.filePath, refreshNonce])

  // Drop stale cache entries when their tab is closed (avoid unbounded growth)
  React.useEffect(() => {
    const open = new Set(state.tabs.map((t) => t.filePath))
    setContents((prev) => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) {
        if (open.has(k)) next[k] = v
      }
      return next
    })
    // Also drop scroll positions for closed tabs (mutating ref in place is
    // fine — no render depends on this map)
    for (const key of Object.keys(scrollPositionsRef.current)) {
      if (!open.has(key)) delete scrollPositionsRef.current[key]
    }
    // And drop diff-mode flags for closed tabs
    setDiffViewForPath((prev) => {
      const next: typeof prev = {}
      for (const [k, v] of Object.entries(prev)) {
        if (open.has(k)) next[k] = v
      }
      return next
    })
  }, [state.tabs])

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ Auto-refresh — poll the active tab's file every 2s and update the   │
  // │ cached content if it changed. This lets the user keep their eyes   │
  // │ on the preview while the agent edits the file, without manual ⌘R. │
  // │                                                                     │
  // │ Compares against `setContents` updater's prev to avoid setState     │
  // │ when bytes haven't changed (React still bails on identical state    │
  // │ refs but explicit string equality short-circuits earlier). 2s is    │
  // │ slow enough to avoid re-rendering mid-write yet fast enough that    │
  // │ the user perceives "live" updates as the agent works.               │
  // └─────────────────────────────────────────────────────────────────────┘
  React.useEffect(() => {
    if (!activeTab) return
    const filePath = activeTab.filePath
    let cancelled = false
    const POLL_MS = 2000
    const id = setInterval(async () => {
      try {
        const next = await window.electronAPI.readFile(filePath)
        if (cancelled) return
        setContents((prev) => {
          const existing = prev[filePath]
          if (existing && existing.content === next && !existing.error) return prev
          // Stash the just-replaced version as `previous` so the user can
          // diff against it. Only update `previous` when content actually
          // changes — repeated polls of an unchanged file shouldn't lose
          // the "previous" pointer the user might want to compare with.
          const previous = existing?.content
          return { ...prev, [filePath]: { content: next, previous } }
        })
      } catch {
        // Silent: the file may be momentarily missing during writes / renames.
        // The next poll will recover, or the user can click refresh manually.
      }
    }, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [activeTab?.filePath])

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ Keyboard shortcuts while the panel is mounted:                      │
  // │   ⌘R / Ctrl+R → refresh active tab                                  │
  // │   ⌘W / Ctrl+W → close active tab (skipped if there's no tab)        │
  // │ Both preventDefault to avoid the Electron menu accelerators in dev  │
  // │ mode (reload / close window).                                       │
  // └─────────────────────────────────────────────────────────────────────┘
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return
      const key = e.key.toLowerCase()
      if (key === 'r') {
        e.preventDefault()
        e.stopPropagation()
        setRefreshNonce((n) => n + 1)
      } else if (key === 'w') {
        // Close current tab only when one exists — otherwise let the keystroke
        // fall through so the user can close the window/panel as expected.
        if (state.activeIndex < 0) return
        e.preventDefault()
        e.stopPropagation()
        setState((prev) => closeSidebarDocTab(prev, prev.activeIndex))
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [state.activeIndex, setState])

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ Restore scroll position when (a) the active tab changes, or (b)    │
  // │ content finishes loading. Wait for both because scrollTop can't be │
  // │ set until the markdown DOM has populated and content is tall       │
  // │ enough. setTimeout(0) gives React one paint tick to commit content.│
  // └─────────────────────────────────────────────────────────────────────┘
  const activeContent = activeTab ? contents[activeTab.filePath]?.content : undefined
  React.useEffect(() => {
    if (!activeTab || activeContent === undefined) return
    const target = scrollPositionsRef.current[activeTab.filePath] ?? 0
    const id = setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = target
      }
    }, 0)
    return () => clearTimeout(id)
  }, [activeTab?.filePath, activeContent])

  const handleTabClick = React.useCallback(
    (idx: number) => {
      setState((prev) => ({ ...prev, activeIndex: idx }))
    },
    [setState],
  )

  const handleClose = React.useCallback(
    (idx: number) => (e: React.MouseEvent) => {
      e.stopPropagation()
      setState((prev) => closeSidebarDocTab(prev, idx))
    },
    [setState],
  )

  // Middle-click on a tab closes it — browser tab convention.
  // `auxClick` fires reliably for non-primary buttons (1 = middle).
  const handleAuxClick = React.useCallback(
    (idx: number) => (e: React.MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      e.stopPropagation()
      setState((prev) => closeSidebarDocTab(prev, idx))
    },
    [setState],
  )

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ Drag-reorder tabs. dnd-kit's SortableContext takes the filePaths as │
  // │ IDs (unique within a session) and notifies us via onDragEnd. We     │
  // │ apply arrayMove to the tabs list AND map activeIndex through the    │
  // │ move so the same logical tab stays active after the reorder.       │
  // └─────────────────────────────────────────────────────────────────────┘
  const sortableSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )
  const tabIds = React.useMemo(() => state.tabs.map((t) => t.filePath), [state.tabs])
  const handleTabDragEnd = React.useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setState((prev) => {
      const oldIdx = prev.tabs.findIndex((t) => t.filePath === active.id)
      const newIdx = prev.tabs.findIndex((t) => t.filePath === over.id)
      if (oldIdx === -1 || newIdx === -1) return prev
      const tabs = arrayMove(prev.tabs, oldIdx, newIdx)
      // Recompute activeIndex so the same tab stays selected after reorder
      let activeIndex = prev.activeIndex
      if (activeIndex === oldIdx) activeIndex = newIdx
      else if (oldIdx < activeIndex && newIdx >= activeIndex) activeIndex -= 1
      else if (oldIdx > activeIndex && newIdx <= activeIndex) activeIndex += 1
      return { tabs, activeIndex }
    })
  }, [setState])

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ Drag-drop .md from Finder → new tab.                                │
  // │ Uses electronAPI.getFilePath (webUtils.getPathForFile under the    │
  // │ hood) to resolve the absolute OS path — File.path is gone in       │
  // │ modern Electron. Filters to .md / .mdx / .markdown.                │
  // └─────────────────────────────────────────────────────────────────────┘
  const handleDragOver = React.useCallback((e: React.DragEvent) => {
    // Only activate the drop zone when the drag carries files
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setIsDragActive(true)
  }, [])
  const handleDragLeave = React.useCallback((e: React.DragEvent) => {
    // Only clear when leaving the container itself, not its children
    if (e.currentTarget === e.target) setIsDragActive(false)
  }, [])
  const handleDrop = React.useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragActive(false)
    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return
    const getPath = window.electronAPI.getFilePath
    if (!getPath) return
    const mdPaths: string[] = []
    for (const f of files) {
      if (!/\.(md|mdx|markdown)$/i.test(f.name)) continue
      const p = getPath(f)
      if (p) mdPaths.push(p)
    }
    if (mdPaths.length === 0) return
    setState((prev) => {
      let next = prev
      for (const p of mdPaths) {
        next = openSidebarDocTab(next, p)
      }
      return next
    })
  }, [setState])

  const entry = activeTab ? contents[activeTab.filePath] : undefined
  const isLoading = activeTab && !entry
  const content = entry?.content ?? ''
  const previous = entry?.previous
  const error = entry?.error
  const hasDiffAvailable = activeTab && previous !== undefined && previous !== content
  const showDiff = activeTab ? !!diffViewForPath[activeTab.filePath] : false

  const toggleDiffView = React.useCallback(() => {
    if (!activeTab) return
    setDiffViewForPath((m) => ({ ...m, [activeTab.filePath]: !m[activeTab.filePath] }))
  }, [activeTab])

  // Pre-compute the unified diff for the active tab when diff mode is on.
  // createPatch generates the standard `--- / +++ / @@` format
  // UnifiedDiffViewer expects.
  const unifiedDiff = React.useMemo(() => {
    if (!activeTab || !hasDiffAvailable || previous === undefined) return ''
    const name = activeTab.filePath.split('/').pop() ?? activeTab.filePath
    return createPatch(name, previous, content, 'previous', 'current')
  }, [activeTab, hasDiffAvailable, previous, content])

  return (
    <div
      className={cn(
        'h-full flex flex-col relative',
        isDragActive && 'after:absolute after:inset-1 after:rounded-[8px] after:border-2 after:border-dashed after:border-accent/60 after:bg-accent/5 after:pointer-events-none',
      )}
      data-right-sidebar-preview
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Preview</span>
        </div>
        <div className="flex items-center gap-1">
          {activeTab && (
            <>
              {/* Diff toggle — only meaningful when we have a prior version
                 captured (i.e., the file changed since you opened the tab). */}
              {hasDiffAvailable && (
                <button
                  onClick={toggleDiffView}
                  className={`p-1 rounded-[6px] transition-colors ${
                    showDiff ? 'text-foreground bg-foreground/10' : 'text-muted-foreground/50 hover:text-foreground'
                  }`}
                  title={showDiff ? 'Show rendered markdown' : 'Show changes vs previous version'}
                >
                  <GitCompare className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => setRefreshNonce((n) => n + 1)}
                className="p-1 rounded-[6px] transition-colors text-muted-foreground/50 hover:text-foreground"
                title="Refresh (⌘R)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
              {/* Pop out to full-screen overlay. Reuses the link interceptor
                 via onOpenFile — same routing path as clicking a .md link in
                 chat (markdown → DocumentFormattedMarkdownOverlay). Tab stays
                 in the sidebar so the user can come back after closing. */}
              <button
                onClick={() => onOpenFile(activeTab.filePath)}
                className="p-1 rounded-[6px] transition-colors text-muted-foreground/50 hover:text-foreground"
                title="Open in full-screen overlay"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          {closeButton}
        </div>
      </div>

      {/* Tab strip — sortable horizontal list */}
      {state.tabs.length > 0 && (
        <div className="flex items-center gap-0.5 px-1.5 pt-1.5 pb-0 border-b border-border/50 overflow-x-auto shrink-0">
          <DndContext
            sensors={sortableSensors}
            collisionDetection={closestCenter}
            onDragEnd={handleTabDragEnd}
          >
            <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
              {state.tabs.map((tab, idx) => (
                <SortableTab
                  key={tab.filePath}
                  id={tab.filePath}
                  label={tabLabel(tab.filePath)}
                  title={tab.filePath}
                  isActive={idx === state.activeIndex}
                  onClick={() => handleTabClick(idx)}
                  onAuxClick={handleAuxClick(idx)}
                  onClose={handleClose(idx)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Content / empty state */}
      <div
        ref={scrollContainerRef}
        onScroll={(e) => {
          if (!activeTab) return
          scrollPositionsRef.current[activeTab.filePath] = e.currentTarget.scrollTop
        }}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {!activeTab && (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <div>
              <FileText className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60 mb-3">
                Pick an <span className="font-mono">.md</span> file to preview it here.
              </p>
              {/* One-click entry to the floating Info popover so the user doesn't
                 have to backtrack through the toolbar on first use. */}
              <button
                onClick={() => setInfoPopoverOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] bg-foreground/[0.06] hover:bg-foreground/[0.1] text-foreground/80 hover:text-foreground transition-colors"
              >
                <FolderSearch className="w-3.5 h-3.5" />
                Browse files
              </button>
              <p className="text-[10px] text-muted-foreground/40 mt-3">
                Or right-click any <span className="font-mono">.md</span> in the file tree
                <br />and choose <em>"Open in sidebar"</em>.
              </p>
            </div>
          </div>
        )}
        {activeTab && (
          // px-6 py-4 — comfortable reading margin at sidebar widths up to 700px.
          // Styling matches DocumentFormattedMarkdownOverlay: `text-sm` wrapper
          // + Markdown `mode="minimal"`, NO Tailwind prose layer (the overlay
          // doesn't use prose either, and adding it changes heading sizes
          // / list spacing in ways that don't match what the user sees in
          // the full-screen view). Keep the two surfaces visually identical.
          <div className="px-6 py-4">
            {isLoading && (
              <div className="text-xs text-muted-foreground/60 italic">Loading…</div>
            )}
            {error && (
              <div className="mb-2 px-2 py-1.5 rounded-[6px] bg-destructive/10 text-destructive text-[11px]">
                {error}
              </div>
            )}
            {!isLoading && !showDiff && (
              <div className="text-sm">
                <Markdown
                  mode="minimal"
                  onFileClick={onOpenFile}
                  onUrlClick={(url) => window.electronAPI.openUrl(url)}
                  hideFirstMermaidExpand={false}
                >
                  {content}
                </Markdown>
              </div>
            )}
            {!isLoading && showDiff && unifiedDiff && (
              // Unified diff renderer expects the standard --- / +++ / @@
              // format; createPatch produces exactly that. Suppress its
              // built-in file header (we already show filename in the tab).
              <div className="text-xs">
                <UnifiedDiffViewer
                  unifiedDiff={unifiedDiff}
                  filePath={activeTab?.filePath}
                  diffStyle="unified"
                  disableFileHeader
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function PreviewPanel({ closeButton }: PreviewPanelProps) {
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)

  if (!focusedSessionId) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Preview</span>
          </div>
          {closeButton}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground px-4">
          <p className="text-xs text-center">No session selected</p>
        </div>
      </div>
    )
  }

  return <PreviewPanelContent sessionId={focusedSessionId} closeButton={closeButton} />
}

// ┌─────────────────────────────────────────────────────────────────────┐
// │ SortableTab — single tab pill wired with useSortable.               │
// │                                                                     │
// │ Drag activation has a 5px distance threshold (set on the sensor)    │
// │ so plain clicks still register as clicks, not drags. The close (X) │
// │ uses stopPropagation in its onClick handler so dragging from the   │
// │ X icon isn't recognized as a tab drag.                              │
// └─────────────────────────────────────────────────────────────────────┘
function SortableTab({
  id,
  label,
  title,
  isActive,
  onClick,
  onAuxClick,
  onClose,
}: {
  id: string
  label: string
  title: string
  isActive: boolean
  onClick: () => void
  onAuxClick: (e: React.MouseEvent) => void
  onClose: (e: React.MouseEvent) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <button
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : undefined,
      }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      onAuxClick={onAuxClick}
      title={title}
      className={cn(
        'group relative flex items-center gap-1 px-2 py-1 rounded-t-[6px] text-[12px] shrink-0 max-w-[140px] transition-colors',
        isActive
          ? 'bg-foreground/[0.06] text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]',
      )}
    >
      <span className="truncate">{label}</span>
      <span
        onClick={onClose}
        onPointerDown={(e) => e.stopPropagation()}
        className="shrink-0 opacity-0 group-hover:opacity-100 hover:bg-foreground/10 rounded-[4px] p-0.5 cursor-pointer"
        role="button"
        aria-label="Close tab"
      >
        <X className="w-3 h-3" />
      </span>
    </button>
  )
}

