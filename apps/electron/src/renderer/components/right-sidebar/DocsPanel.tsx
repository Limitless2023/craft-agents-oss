/**
 * DocsPanel - Right sidebar panel showing session info
 *
 * Split pane layout:
 * - Top: Working Directory file tree (lazy-loading)
 * - Bottom: Session Files tree
 * - Draggable divider between them
 * - Search/filter applies to both panes
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { BookOpen, Search, X, FolderOpen, RotateCw } from 'lucide-react'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { useSession, useAppShellContext } from '@/context/AppShellContext'
import { SessionFilesSection } from './SessionFilesSection'
import { WorkingDirectoryTree } from './WorkingDirectoryTree'
import * as storage from '@/lib/local-storage'

interface DocsPanelProps {
  closeButton?: React.ReactNode
}

/** Shorten an absolute path by replacing $HOME with ~ */
function shortenPath(path: string): string {
  const home = '/Users/' + path.split('/')[2]
  if (path.startsWith(home)) {
    return '~' + path.slice(home.length)
  }
  return path
}

function DocsPanelContent({ sessionId, closeButton }: { sessionId: string; closeButton?: React.ReactNode }) {
  const session = useSession(sessionId)
  const { activeSessionWorkingDirectory } = useAppShellContext()
  const [filterQuery, setFilterQuery] = React.useState('')
  const [isSearchOpen, setIsSearchOpen] = React.useState(false)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const [refreshToken, setRefreshToken] = React.useState(0)
  const [isRefreshing, setIsRefreshing] = React.useState(false)

  const handleRefresh = React.useCallback(() => {
    setIsRefreshing(true)
    setRefreshToken(t => t + 1)
    setTimeout(() => setIsRefreshing(false), 600)
  }, [])

  // Split pane state — ratio is the fraction of available height for the top (working dir) pane
  const [splitRatio, setSplitRatio] = React.useState(() =>
    storage.get(storage.KEYS.rightSidebarSplitRatio, 0.5)
  )
  const [isDragging, setIsDragging] = React.useState(false)
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Split pane drag handler
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
      storage.set(storage.KEYS.rightSidebarSplitRatio, splitRatio)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, splitRatio])

  // Focus input when search opens
  React.useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus()
    }
  }, [isSearchOpen])

  // ⌘F shortcut to toggle search
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        if (searchInputRef.current?.closest('[data-right-sidebar]')) {
          e.preventDefault()
          e.stopPropagation()
          setIsSearchOpen(true)
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  const handleClearSearch = React.useCallback(() => {
    setFilterQuery('')
    setIsSearchOpen(false)
  }, [])

  const handleSearchKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleClearSearch()
    }
  }, [handleClearSearch])

  const hasWorkingDir = !!activeSessionWorkingDirectory

  return (
    <div className="h-full flex flex-col" data-right-sidebar>
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Info</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1 rounded-[6px] transition-colors text-muted-foreground/50 hover:text-foreground"
            title="Refresh file list"
          >
            <RotateCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => {
              if (isSearchOpen) {
                handleClearSearch()
              } else {
                setIsSearchOpen(true)
              }
            }}
            className={`p-1 rounded-[6px] transition-colors ${
              isSearchOpen
                ? 'text-foreground bg-foreground/10'
                : 'text-muted-foreground/50 hover:text-foreground'
            }`}
            title="Search files (⌘F)"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
          {closeButton}
        </div>
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
              className="w-full text-xs bg-foreground/[0.04] border border-border/50 rounded-md px-2 py-1 pr-6
                placeholder:text-muted-foreground/40
                focus:outline-none focus:ring-1 focus:ring-ring/50"
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
      <div ref={containerRef} className="flex-1 min-h-0 flex flex-col" style={{ userSelect: isDragging ? 'none' : undefined }}>
        {/* Top pane: Working Directory */}
        <div
          className="overflow-y-auto overflow-x-hidden shrink-0"
          style={{ height: hasWorkingDir ? `${splitRatio * 100}%` : 'auto' }}
        >
          <div className="px-3 pt-3 pb-1">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <FolderOpen className="w-3 h-3 text-muted-foreground/60 shrink-0" />
                <span className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">Working Directory</span>
              </div>
              {activeSessionWorkingDirectory && (
                <button
                  onClick={() => window.electronAPI.openFile(activeSessionWorkingDirectory)}
                  className="text-[10px] text-foreground/50 hover:text-foreground/80 hover:underline underline-offset-2 transition-colors truncate max-w-[120px]"
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

        {/* Bottom pane: Session Files */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
          <SessionFilesSection
            sessionId={sessionId}
            sessionFolderPath={session?.sessionFolderPath}
            hideHeader={false}
            filterQuery={filterQuery || undefined}
          />
        </div>
      </div>
    </div>
  )
}

export function DocsPanel({ closeButton }: DocsPanelProps) {
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)

  if (!focusedSessionId) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Info</span>
          </div>
          {closeButton}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground px-4">
          <p className="text-xs text-center">No session selected</p>
        </div>
      </div>
    )
  }

  return <DocsPanelContent sessionId={focusedSessionId} closeButton={closeButton} />
}
