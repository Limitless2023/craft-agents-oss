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
import { useAtomValue } from 'jotai'
import { useAtom } from 'jotai'
import { FileText, X, RotateCw } from 'lucide-react'
import { Markdown } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { useAppShellContext } from '@/context/AppShellContext'
import { sidebarDocsAtomFamily, closeSidebarDocTab } from '@/atoms/sidebar-docs'

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
  const [contents, setContents] = React.useState<Record<string, { content?: string; error?: string }>>({})
  const [refreshNonce, setRefreshNonce] = React.useState(0)

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
  }, [state.tabs])

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ ⌘R refreshes the active tab while this panel is mounted.           │
  // │ Scoped via data-right-sidebar-preview attribute on the container so │
  // │ the global ⌘R from useLinkInterceptor (for the overlay) doesn't    │
  // │ collide — the listener here only fires when the panel is visible.  │
  // └─────────────────────────────────────────────────────────────────────┘
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !e.altKey &&
        (e.key === 'r' || e.key === 'R')
      ) {
        e.preventDefault()
        e.stopPropagation()
        setRefreshNonce((n) => n + 1)
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

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

  const entry = activeTab ? contents[activeTab.filePath] : undefined
  const isLoading = activeTab && !entry
  const content = entry?.content ?? ''
  const error = entry?.error

  return (
    <div className="h-full flex flex-col" data-right-sidebar-preview>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Preview</span>
        </div>
        <div className="flex items-center gap-1">
          {activeTab && (
            <button
              onClick={() => setRefreshNonce((n) => n + 1)}
              className="p-1 rounded-[6px] transition-colors text-muted-foreground/50 hover:text-foreground"
              title="Refresh (⌘R)"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
          )}
          {closeButton}
        </div>
      </div>

      {/* Tab strip — only when there are tabs */}
      {state.tabs.length > 0 && (
        <div className="flex items-center gap-0.5 px-1.5 pt-1.5 pb-0 border-b border-border/50 overflow-x-auto shrink-0">
          {state.tabs.map((tab, idx) => {
            const isActive = idx === state.activeIndex
            return (
              <button
                key={tab.filePath}
                onClick={() => handleTabClick(idx)}
                title={tab.filePath}
                className={cn(
                  'group relative flex items-center gap-1 px-2 py-1 rounded-t-[6px] text-[12px] shrink-0 max-w-[140px] transition-colors',
                  isActive
                    ? 'bg-foreground/[0.06] text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.03]',
                )}
              >
                <span className="truncate">{tabLabel(tab.filePath)}</span>
                <span
                  onClick={handleClose(idx)}
                  className="shrink-0 opacity-0 group-hover:opacity-100 hover:bg-foreground/10 rounded-[4px] p-0.5 cursor-pointer"
                  role="button"
                  aria-label="Close tab"
                >
                  <X className="w-3 h-3" />
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Content / empty state */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {!activeTab && (
          <div className="h-full flex items-center justify-center px-6 text-center">
            <div>
              <FileText className="w-8 h-8 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-xs text-muted-foreground/60">
                Right-click any <span className="font-mono">.md</span> file in the file tree
                <br />and choose <em>"Open in sidebar"</em> to preview it here.
              </p>
            </div>
          </div>
        )}
        {activeTab && (
          // px-6 py-4 — more breathing room for prose at sidebar widths up to
          // 700px. Matches the comfortable reading-margin of in-app overlays.
          <div className="px-6 py-4">
            {isLoading && (
              <div className="text-xs text-muted-foreground/60 italic">Loading…</div>
            )}
            {error && (
              <div className="mb-2 px-2 py-1.5 rounded-[6px] bg-destructive/10 text-destructive text-[11px]">
                {error}
              </div>
            )}
            {!isLoading && (
              <div className="prose prose-sm dark:prose-invert max-w-none text-[13px]">
                <Markdown
                  mode="full"
                  onFileClick={onOpenFile}
                  onUrlClick={(url) => window.electronAPI.openUrl(url)}
                >
                  {content}
                </Markdown>
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
