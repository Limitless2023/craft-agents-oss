/**
 * WorkingDirectoryTree - Lazy-loading file tree for the working directory.
 * Loads one level at a time when folders are expanded.
 * Click files to preview in-app, click folders to expand.
 */

import * as React from 'react'
import { useState, useCallback, useEffect, useRef, memo } from 'react'
import { File, Folder, FolderOpen, FileText, Image, FileCode, ChevronRight, Eye, ExternalLink } from 'lucide-react'
import { useSetAtom, useAtomValue } from 'jotai'
import { cn } from '@/lib/utils'
import { useAppShellContext } from '@/context/AppShellContext'
import { useNavigation } from '@/contexts/NavigationContext'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { sidebarDocsAtomFamily, openSidebarDocTab } from '@/atoms/sidebar-docs'
import {
  ContextMenu,
  ContextMenuTrigger,
  StyledContextMenuContent,
  StyledContextMenuItem,
} from '@/components/ui/styled-context-menu'

const WORKING_DIR_POLL_MS = 3000

interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
}

interface TreeNodeProps {
  entry: FileEntry
  depth: number
  onFileClick: (path: string) => void
  onOpenInSidebar?: (path: string) => void
}

function getIcon(entry: FileEntry, isExpanded: boolean) {
  const cls = "h-3.5 w-3.5 text-muted-foreground shrink-0"
  if (entry.type === 'directory') {
    return isExpanded ? <FolderOpen className={cls} /> : <Folder className={cls} />
  }
  const ext = entry.name.split('.').pop()?.toLowerCase() || ''
  if (['md', 'mdx', 'markdown'].includes(ext)) return <FileText className={cls} />
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return <Image className={cls} />
  if (['ts', 'tsx', 'js', 'jsx', 'json', 'py', 'go', 'rs', 'rb', 'swift', 'kt', 'java'].includes(ext)) return <FileCode className={cls} />
  return <File className={cls} />
}

const TreeNode = memo(function TreeNode({ entry, depth, onFileClick, onOpenInSidebar }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [children, setChildren] = useState<FileEntry[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleClick = useCallback(async () => {
    if (entry.type === 'directory') {
      if (!isExpanded && children === null) {
        setIsLoading(true)
        try {
          const result = await window.electronAPI.listFiles(entry.path)
          setChildren(result.items)
        } catch {
          setChildren([])
        } finally {
          setIsLoading(false)
        }
      }
      setIsExpanded(!isExpanded)
    } else {
      onFileClick(entry.path)
    }
  }, [entry, isExpanded, children, onFileClick])

  const isMarkdown = entry.type === 'file' && /\.(md|mdx|markdown)$/i.test(entry.name)

  const buttonEl = (
    <button
      onClick={handleClick}
      className={cn(
        "flex items-center gap-1.5 w-full text-left py-[3px] rounded-md",
        "hover:bg-foreground/[0.04] transition-colors group text-xs",
        entry.type === 'directory' ? 'font-medium' : 'text-foreground/70',
      )}
      style={{ paddingLeft: `${8 + depth * 14}px`, paddingRight: 8 }}
      title={entry.path}
    >
      {entry.type === 'directory' && (
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground/50 shrink-0 transition-transform duration-150",
            isExpanded && "rotate-90"
          )}
        />
      )}
      {entry.type !== 'directory' && <span className="w-3 shrink-0" />}
      {getIcon(entry, isExpanded)}
      <span className="truncate">{entry.name}</span>
    </button>
  )

  return (
    <>
      {entry.type === 'file' ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{buttonEl}</ContextMenuTrigger>
          <StyledContextMenuContent>
            <StyledContextMenuItem onSelect={() => onFileClick(entry.path)}>
              <ExternalLink className="h-3.5 w-3.5" />
              Open
            </StyledContextMenuItem>
            {isMarkdown && onOpenInSidebar && (
              <StyledContextMenuItem onSelect={() => onOpenInSidebar(entry.path)}>
                <Eye className="h-3.5 w-3.5" />
                Open in sidebar
              </StyledContextMenuItem>
            )}
          </StyledContextMenuContent>
        </ContextMenu>
      ) : (
        buttonEl
      )}

      {isExpanded && entry.type === 'directory' && (
        <div>
          {isLoading && (
            <div className="text-[10px] text-muted-foreground/40 py-1" style={{ paddingLeft: `${22 + depth * 14}px` }}>
              Loading...
            </div>
          )}
          {children && children.length === 0 && !isLoading && (
            <div className="text-[10px] text-muted-foreground/40 py-1 italic" style={{ paddingLeft: `${22 + depth * 14}px` }}>
              Empty
            </div>
          )}
          {children?.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              onFileClick={onFileClick}
              onOpenInSidebar={onOpenInSidebar}
            />
          ))}
        </div>
      )}
    </>
  )
})

interface WorkingDirectoryTreeProps {
  dirPath: string
  filterQuery?: string
  /** Incremented externally to force a manual refresh */
  refreshToken?: number
}

export function WorkingDirectoryTree({ dirPath, filterQuery, refreshToken }: WorkingDirectoryTreeProps) {
  const [items, setItems] = React.useState<FileEntry[] | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const { onOpenFile } = useAppShellContext()
  const mountedRef = useRef(true)

  const fetchItems = useCallback(() => {
    window.electronAPI.listFiles(dirPath).then((result) => {
      if (mountedRef.current) setItems(result.items)
    }).catch(() => {
      if (mountedRef.current) setItems([])
    })
  }, [dirPath])

  // Initial load (with loading state)
  useEffect(() => {
    mountedRef.current = true
    setIsLoading(true)
    window.electronAPI.listFiles(dirPath).then((result) => {
      if (mountedRef.current) { setItems(result.items); setIsLoading(false) }
    }).catch(() => {
      if (mountedRef.current) { setItems([]); setIsLoading(false) }
    })
    return () => { mountedRef.current = false }
  }, [dirPath])

  // Poll every 3s to pick up file additions without a dedicated watcher IPC
  useEffect(() => {
    const id = setInterval(fetchItems, WORKING_DIR_POLL_MS)
    return () => clearInterval(id)
  }, [fetchItems])

  // Manual refresh via refreshToken
  useEffect(() => {
    if (refreshToken !== undefined) fetchItems()
  }, [refreshToken, fetchItems])

  const handleFileClick = useCallback((path: string) => {
    onOpenFile(path)
  }, [onOpenFile])

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ "Open in sidebar" — push the file as a tab into the per-session    │
  // │ sidebar-docs atom and force-open the preview panel.                │
  // │ Falls back gracefully when no session is focused.                  │
  // └─────────────────────────────────────────────────────────────────────┘
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const setSidebarDocs = useSetAtom(sidebarDocsAtomFamily(focusedSessionId ?? '__none__'))
  const { updateRightSidebar } = useNavigation()
  const handleOpenInSidebar = useCallback((path: string) => {
    if (!focusedSessionId) return
    setSidebarDocs((prev) => openSidebarDocTab(prev, path))
    updateRightSidebar({ type: 'preview' })
  }, [focusedSessionId, setSidebarDocs, updateRightSidebar])

  if (isLoading || items === null) {
    return (
      <div className="px-4 py-2 text-xs text-muted-foreground/40">Loading...</div>
    )
  }

  // Apply filter
  const displayItems = filterQuery
    ? items.filter(item => item.name.toLowerCase().includes(filterQuery.toLowerCase()))
    : items

  if (displayItems.length === 0) {
    return (
      <div className="px-4 py-2 text-xs text-muted-foreground/40 italic">
        {filterQuery ? 'No files match.' : 'Empty directory.'}
      </div>
    )
  }

  return (
    <nav className="grid gap-0.5 px-1">
      {displayItems.map((item) => (
        <TreeNode
          key={item.path}
          entry={item}
          depth={0}
          onFileClick={handleFileClick}
          onOpenInSidebar={handleOpenInSidebar}
        />
      ))}
    </nav>
  )
}
