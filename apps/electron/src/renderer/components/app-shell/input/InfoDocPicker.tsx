/**
 * InfoDocPicker — ⌘I-triggered floating picker for inserting Info-doc references.
 *
 * Behavior:
 *   - Opens at the cursor position when ⌘I (or Ctrl+I) is pressed in the
 *     chat input. Focus shifts to the picker's own filter input so typing
 *     doesn't pollute the chat message.
 *   - BFS-searches the session working directory via `fs:search` IPC,
 *     debounced. Empty filter returns the first ~50 files near the root.
 *   - Up/Down navigate, Enter/Tab select, Esc closes.
 *   - On select, the parent inserts the chosen entry as a markdown link
 *     `[name](relativePath)` at the chat input's saved cursor position.
 *
 * Why a self-contained picker instead of reusing InlineMentionMenu:
 *   `@` mentions rely on the trigger character staying in the chat input as
 *   an anchor so the filter can be parsed from the text. `⌘I` inserts no
 *   character — there's no anchor in the input. So the picker owns its own
 *   filter field, decoupled from the chat input's text.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import { FadingText } from '@/components/ui/fading-text'

// ── Visual constants — match InlineMentionMenu for consistency ─────────────────
const CONTAINER_STYLE = 'fixed z-dropdown overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const LIST_STYLE = 'max-h-[240px] overflow-y-auto py-1'
const ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-2 rounded-[6px] mx-1 px-2 py-1.5 text-[13px]'
const ITEM_SELECTED = 'bg-foreground/5'

export interface InfoDocResult {
  name: string
  path: string
  relativePath: string
  type: 'file' | 'directory'
}

export interface InfoDocPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (file: InfoDocResult) => void
  /** Session working directory — picker searches its subtree. */
  basePath?: string
  /** Anchor position from getCaretRect() at the moment ⌘I was pressed. */
  position: { x: number; y: number } | null
  maxWidth?: number
}

export function InfoDocPicker({
  open,
  onOpenChange,
  onSelect,
  basePath,
  position,
  maxWidth = 320,
}: InfoDocPickerProps) {
  const [filter, setFilter] = React.useState('')
  const [results, setResults] = React.useState<InfoDocResult[]>([])
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // ┌─────────────────────────────────────────────────────────────────┐
  // │ Reset state + focus + initial fetch when picker opens.          │
  // │ Empty filter returns "top" files in cwd (BFS up to 50 results). │
  // └─────────────────────────────────────────────────────────────────┘
  React.useEffect(() => {
    if (!open) return
    setFilter('')
    setSelectedIndex(0)
    if (!basePath) {
      setResults([])
      return
    }
    setLoading(true)
    window.electronAPI
      .searchFiles(basePath, '')
      .then((items) => {
        setResults(items.filter((i) => i.type === 'file'))
        setLoading(false)
      })
      .catch(() => {
        setResults([])
        setLoading(false)
      })
    // Focus internal input on the next tick so the popover has rendered
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [open, basePath])

  // Debounced search when filter changes
  React.useEffect(() => {
    if (!open || !basePath) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setLoading(true)
      window.electronAPI
        .searchFiles(basePath, filter)
        .then((items) => {
          setResults(items.filter((i) => i.type === 'file'))
          setSelectedIndex(0)
          setLoading(false)
        })
        .catch(() => {
          setResults([])
          setLoading(false)
        })
    }, 150)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [filter, basePath, open])

  // Close on click outside
  React.useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onOpenChange])

  // Scroll selected item into view
  React.useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('[data-selected="true"]')
    if (el && 'scrollIntoView' in el) {
      ;(el as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  const handleKey = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown':
          if (results.length === 0) return
          e.preventDefault()
          setSelectedIndex((i) => (i < results.length - 1 ? i + 1 : 0))
          break
        case 'ArrowUp':
          if (results.length === 0) return
          e.preventDefault()
          setSelectedIndex((i) => (i > 0 ? i - 1 : results.length - 1))
          break
        case 'Enter':
        case 'Tab':
          if (results.length === 0) return
          e.preventDefault()
          if (results[selectedIndex]) {
            onSelect(results[selectedIndex])
            onOpenChange(false)
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    },
    [results, selectedIndex, onSelect, onOpenChange],
  )

  if (!open || !position) return null

  // Anchor above the caret (matches InlineMentionMenu positioning)
  const bottomPosition =
    typeof window !== 'undefined' ? window.innerHeight - Math.round(position.y) + 8 : 0

  return (
    <div
      ref={containerRef}
      data-info-doc-picker
      className={cn(CONTAINER_STYLE)}
      style={{
        left: Math.round(position.x) - 10,
        bottom: bottomPosition,
        width: maxWidth,
        maxWidth,
      }}
    >
      {/* Header: filter input — owns focus while picker is open */}
      <div className="px-2 py-1.5 border-b border-foreground/5">
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Find a doc to reference…"
          className="w-full text-[13px] bg-foreground/[0.03] rounded-[6px] px-2 py-1 outline-none focus:bg-foreground/[0.05] placeholder:text-muted-foreground/50"
          // Disable autoComplete/spellcheck — this is a filter, not prose
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {/* Results list */}
      <div ref={listRef} className={LIST_STYLE}>
        {loading && results.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-muted-foreground/60">Searching…</div>
        )}
        {!loading && results.length === 0 && (
          <div className="px-3 py-2 text-[12px] text-muted-foreground/60">
            {basePath ? 'No files match' : 'No working directory'}
          </div>
        )}
        {results.map((item, idx) => {
          const isSelected = idx === selectedIndex
          const parentDir = getParentDir(item.relativePath)
          return (
            <div
              key={item.path}
              data-selected={isSelected}
              onClick={() => {
                onSelect(item)
                onOpenChange(false)
              }}
              onMouseEnter={() => setSelectedIndex(idx)}
              className={cn(ITEM_STYLE, isSelected && ITEM_SELECTED)}
            >
              <FileIcon className="shrink-0 text-muted-foreground" />
              <span className="shrink-0 truncate">{item.name}</span>
              {parentDir && (
                <FadingText
                  className="text-[11px] text-muted-foreground min-w-0 opacity-50"
                  fadeWidth={20}
                >
                  {parentDir}
                </FadingText>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getParentDir(relativePath: string): string {
  const i = relativePath.lastIndexOf('/')
  return i > 0 ? relativePath.slice(0, i) : ''
}

// Generic file icon (document with folded corner) — matches FileMenuIcon
// styling in mention-menu.tsx but kept local to avoid coupling.
function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}
