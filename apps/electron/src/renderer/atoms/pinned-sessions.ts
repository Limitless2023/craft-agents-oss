/**
 * pinned-sessions — per-workspace set of session IDs the user has pinned
 * to the top of the sidebar.
 *
 * Stored entirely in localStorage (key `craft-pinned-sessions:<workspaceId>`)
 * rather than on SessionMeta. SessionMeta is owned by upstream and changes
 * frequently between releases — keeping pin state external means we don't
 * have to thread anything through the sync/persistence pipeline, and
 * upstream additions never bring conflicts here.
 *
 * Atom is keyed by workspaceId via atomFamily; the helper functions take
 * a setter so callers can mutate without re-reading the underlying Set.
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

const STORAGE_PREFIX = 'craft-pinned-sessions:'

function load(workspaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + workspaceId)
    if (!raw) return new Set()
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set()
    return new Set(arr.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function persist(workspaceId: string, set: Set<string>): void {
  try {
    if (set.size === 0) {
      localStorage.removeItem(STORAGE_PREFIX + workspaceId)
    } else {
      localStorage.setItem(STORAGE_PREFIX + workspaceId, JSON.stringify(Array.from(set)))
    }
  } catch {
    // ignore quota errors
  }
}

export const pinnedSessionsAtomFamily = atomFamily((workspaceId: string) => {
  const baseAtom = atom<Set<string>>(load(workspaceId))
  return atom(
    (get) => get(baseAtom),
    (get, set, update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const prev = get(baseAtom)
      const next = typeof update === 'function' ? update(prev) : update
      set(baseAtom, next)
      persist(workspaceId, next)
    },
  )
})

/** Toggle a session's pinned state for a workspace. */
export function togglePinnedSession(prev: Set<string>, sessionId: string): Set<string> {
  const next = new Set(prev)
  if (next.has(sessionId)) next.delete(sessionId)
  else next.add(sessionId)
  return next
}
