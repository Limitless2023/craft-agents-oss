/**
 * InfoPopover — floating file-tree shown when the user clicks the Info icon
 * while the Preview panel is active.
 *
 * Replaces the default "switch sidebar to Info" behavior with a popover so
 * the Preview pane stays visible. Typical flow:
 *   1. User is reading a .md in Preview
 *   2. Clicks Info icon → this popover opens, anchored to the icon
 *   3. Browses the file tree, right-clicks another .md → "Open in sidebar"
 *   4. Popover auto-closes via the right-click handler's side effect
 *      (updateRightSidebar still resolves to 'preview', no state change)
 *
 * Content layout mirrors DocsPanel's split pane (Working Directory on top,
 * Session Files on bottom, draggable divider, ⌘F search). We don't reuse
 * DocsPanel directly because:
 *   - DocsPanel has its own header (BookOpen icon + "Info" label + close
 *     button) that would be redundant inside a popover header
 *   - Popover sizing is fixed (~400×580), so the split-pane ratio storage
 *     key is separate to avoid polluting the docked sidebar's preference
 */

import * as React from 'react'
import { Search, X, FolderOpen, RotateCw } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAppShellContext, useSession } from '@/context/AppShellContext'
import { SessionFilesSection } from './SessionFilesSection'
import { WorkingDirectoryTree } from './WorkingDirectoryTree'
import * as storage from '@/lib/local-storage'

interface InfoPopoverProps {
  /** Anchor element (the Info icon button). */
  trigger: React.ReactElement
  /** Currently focused session id. Without one the popover shows an empty state. */
  sessionId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const CONTENT_CLASS = 'w-[400px] h-[580px] overflow-hidden rounded-[10px] bg-background text-foreground shadow-modal-small p-0'

function shortenPath(path: string): string {
  const home = '/Users/' + path.split('/')[2]
  if (path.startsWith(home)) return '~' + path.slice(home.length)
  return path
}

export function InfoPopover({ trigger, sessionId, open, onOpenChange }: InfoPopoverProps) {
  const { activeSessionWorkingDirectory } = useAppShellContext()
  const session = useSession(sessionId ?? '__none__')
  const [filterQuery, setFilterQuery] = React.useState('')
  const [isSearchOpen, setIsSearchOpen] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  // Split pane state — separate storage key so popover and docked sidebar
  // don't fight over each other's preferred split ratio.
  const [splitRatio, setSplitRatio] = React.useState(() =>
    storage.get(storage.KEYS.infoPopoverSplitRatio, 0.5)
  )
  const [isDragging, setIsDragging] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!isDragging) return
    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const y = e.clientY - rect.top
      const ratio = Math.min(Math.max(y / rect.height, 0.15), 0.85)
      setSplitRatio(ratio)
    }
    const handleMouseUp = () => {
      setIsDragging(false)
      storage.set(storage.KEYS.infoPopoverSplitRatio, splitRatio)
    }
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, splitRatio])

  React.useEffect(() => {
    if (open && isSearchOpen) searchInputRef.current?.focus()
  }, [open, isSearchOpen])

  // Reset transient state when popover closes so reopening starts clean
  React.useEffect(() => {
    if (!open) {
      setFilterQuery('')
      setIsSearchOpen(false)
    }
  }, [open])

  const handleRefresh = React.useCallback(() => {
    setIsRefreshing(true)
    setRefreshToken(t => t + 1)
    setTimeout(() => setIsRefreshing(false), 600)
  }, [])

  const handleClearSearch = React.useCallback(() => {
    setFilterQuery('')
    setIsSearchOpen(false)
  }, [])

  const handleSearchKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') handleClearSearch()
  }, [handleClearSearch])

  const hasWorkingDir = !!activeSessionWorkingDirectory

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="bottom" align="end" sideOffset={6} className={CONTENT_CLASS}>
        <div className="h-full flex flex-col" data-info-popover>
          {/* Popover header — toolbar only (no title/close; the trigger handles toggle) */}
          <div className="flex items-center justify-end gap-1 px-2 py-1.5 border-b border-border/50 shrink-0">
            <button
              onClick={handleRefresh}
              className="p-1 rounded-[6px] transition-colors text-muted-foreground/50 hover:text-foreground"
              title="Refresh file list"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => isSearchOpen ? handleClearSearch() : setIsSearchOpen(true)}
              className={`p-1 rounded-[6px] transition-colors ${
                isSearchOpen ? 'text-foreground bg-foreground/10' : 'text-muted-foreground/50 hover:text-foreground'
              }`}
              title="Filter files (⌘F)"
            >
              <Search className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Search input */}
          {isSearchOpen && (
            <div className="px-2 py-1.5 border-b border-border/50 shrink-0">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Filter files..."
                  className="w-full text-xs bg-foreground/[0.04] border border-border/50 rounded-md px-2 py-1 pr-6 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring/50"
                />
                {filterQuery && (
                  <button
                    onClick={() => setFilterQuery('')}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/50 hover:text-foreground"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Split pane content area */}
          <div
            ref={containerRef}
            className="flex-1 min-h-0 flex flex-col"
            style={{ userSelect: isDragging ? 'none' : undefined }}
          >
            {/* Top: Working Directory */}
            <div
              className="overflow-y-auto overflow-x-hidden shrink-0"
              style={{ height: hasWorkingDir ? `${splitRatio * 100}%` : 'auto' }}
            >
              <div className="px-3 pt-3 pb-1">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <FolderOpen className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                    <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">
                      Working Directory
                    </span>
                  </div>
                  {activeSessionWorkingDirectory && (
                    <button
                      onClick={() => window.electronAPI.openFile(activeSessionWorkingDirectory)}
                      className="text-[10px] text-foreground/50 hover:text-foreground/80 hover:underline underline-offset-2 transition-colors truncate max-w-[140px]"
                      title={`Open in Finder: ${activeSessionWorkingDirectory}`}
                    >
                      {shortenPath(activeSessionWorkingDirectory)}
                    </button>
                  )}
                </div>
              </div>
              {activeSessionWorkingDirectory ? (
                <div className="pb-1">
                  <WorkingDirectoryTree
                    dirPath={activeSessionWorkingDirectory}
                    filterQuery={filterQuery || undefined}
                    refreshToken={refreshToken}
                  />
                </div>
              ) : (
                <div className="px-4 py-2">
                  <span className="text-xs text-muted-foreground/40 italic">No working directory set</span>
                </div>
              )}
            </div>

            {/* Draggable divider */}
            {hasWorkingDir && (
              <div
                onMouseDown={(e) => { e.preventDefault(); setIsDragging(true) }}
                className="shrink-0 flex items-center justify-center cursor-row-resize group border-y border-border/50"
                style={{ height: 8 }}
              >
                <div className="w-8 h-[2px] rounded-full bg-foreground/10 group-hover:bg-foreground/25 transition-colors" />
              </div>
            )}

            {/* Bottom: Session Files */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
              {sessionId ? (
                <SessionFilesSection
                  sessionId={sessionId}
                  sessionFolderPath={session?.sessionFolderPath}
                  hideHeader={false}
                  filterQuery={filterQuery || undefined}
                />
              ) : (
                <div className="px-4 py-2">
                  <span className="text-xs text-muted-foreground/40 italic">No session selected</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
