/**
 * SessionSwitcher — ⌘\ command palette for jumping between sessions.
 *
 * Shows a Dialog with a single search input and a fuzzy-filtered list of
 * sessions (current workspace). Pressing Enter (or clicking a result)
 * navigates the focused panel to that session — reusing the same
 * `navigateToSessionInPanel` logic AppShell already exposes via context.
 *
 * Why a Dialog instead of a popover anchored to a button: ⌘\ is a global
 * shortcut, the entry point is the keyboard, not a visible UI affordance.
 * A centered modal also gives the result list room to breathe (up to ~12
 * rows visible at once) which a tight popover can't match.
 *
 * Ranking: substring match on title || preview, then most-recently-active
 * (lastMessageAt desc) so recent work shows up first.
 */

import * as React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { atom } from 'jotai'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { sessionMetaMapAtom, windowWorkspaceIdAtom, type SessionMeta } from '@/atoms/sessions'

/**
 * Global open/close signal so a keyboard handler anywhere can fire ⌘\
 * without prop drilling. Kept tiny — just the boolean.
 */
export const sessionSwitcherOpenAtom = atom(false)

interface SessionSwitcherProps {
  /** Called when the user picks a session. */
  onSelect: (sessionId: string) => void
}

export function SessionSwitcher({ onSelect }: SessionSwitcherProps) {
  const [open, setOpen] = useAtom(sessionSwitcherOpenAtom)
  const metaMap = useAtomValue(sessionMetaMapAtom)
  const workspaceId = useAtomValue(windowWorkspaceIdAtom)
  const [query, setQuery] = React.useState('')
  const [selectedIdx, setSelectedIdx] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const listRef = React.useRef<HTMLDivElement>(null)

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ Reset transient state every time the dialog opens.                  │
  // │ Auto-focus the input so the user can type immediately.              │
  // └─────────────────────────────────────────────────────────────────────┘
  React.useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIdx(0)
    // Dialog mount animation needs a tick before focus sticks
    const id = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(id)
  }, [open])

  // Filter + rank sessions for the current workspace.
  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    const all: SessionMeta[] = []
    for (const meta of metaMap.values()) {
      if (workspaceId && meta.workspaceId !== workspaceId) continue
      if (meta.hidden || meta.isArchived) continue
      all.push(meta)
    }
    const filtered = q.length === 0
      ? all
      : all.filter((m) => {
          const title = (m.name || m.preview || '').toLowerCase()
          return title.includes(q)
        })
    // Most-recently-active first; empty timestamps drop to the end
    filtered.sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
    // Cap so the dialog doesn't render thousands of rows on empty query
    return filtered.slice(0, 100)
  }, [metaMap, workspaceId, query])

  // Clamp selected index when results shrink (e.g. typing narrows list)
  React.useEffect(() => {
    if (selectedIdx >= results.length) setSelectedIdx(Math.max(0, results.length - 1))
  }, [results.length, selectedIdx])

  // Scroll the selected row into view on arrow nav
  React.useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector('[data-selected="true"]')
    if (el && 'scrollIntoView' in el) {
      ;(el as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIdx])

  const handleKey = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        if (results.length === 0) return
        setSelectedIdx((i) => (i < results.length - 1 ? i + 1 : 0))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        if (results.length === 0) return
        setSelectedIdx((i) => (i > 0 ? i - 1 : results.length - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const picked = results[selectedIdx]
        if (!picked) return
        onSelect(picked.id)
        setOpen(false)
      } else if (e.key === 'Escape') {
        // Dialog handles ESC via Radix, but ensure we don't leave stale state
        setOpen(false)
      }
    },
    [results, selectedIdx, onSelect, setOpen],
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="p-0 max-w-[560px] gap-0 overflow-hidden"
        // Suppress the default close button — the keyboard flow + click
        // outside both handle dismissal; the X duplicates affordance.
        showCloseButton={false}
      >
        {/* Input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border/50">
          <Search className="w-4 h-4 text-muted-foreground/60 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Jump to session…"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground/50"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="text-[10px] text-muted-foreground/50 px-1.5 py-0.5 rounded-[4px] bg-foreground/[0.05]">
            ESC
          </kbd>
        </div>

        {/* Result list */}
        <div ref={listRef} className="max-h-[420px] overflow-y-auto py-1">
          {results.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-muted-foreground/60">
              {query.trim() ? 'No sessions match' : 'No sessions yet'}
            </div>
          )}
          {results.map((m, idx) => {
            const isSelected = idx === selectedIdx
            const title = m.name || m.preview?.slice(0, 60) || 'Untitled'
            const subtitle = m.name && m.preview ? m.preview.slice(0, 80) : ''
            return (
              <div
                key={m.id}
                data-selected={isSelected}
                onClick={() => {
                  onSelect(m.id)
                  setOpen(false)
                }}
                onMouseEnter={() => setSelectedIdx(idx)}
                className={cn(
                  'px-4 py-2 cursor-pointer flex flex-col gap-0.5',
                  isSelected && 'bg-foreground/[0.05]',
                )}
              >
                <span className="text-[13px] truncate">{title}</span>
                {subtitle && (
                  <span className="text-[11px] text-muted-foreground/60 truncate">{subtitle}</span>
                )}
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
