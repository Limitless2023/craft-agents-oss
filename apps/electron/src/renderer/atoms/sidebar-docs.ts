/**
 * sidebar-docs — per-session state for the right-sidebar "doc tabs" pane.
 *
 * A user right-clicks an .md file in the sidebar trees and chooses "Open in
 * sidebar"; the doc opens as a tab inside the right sidebar so it stays
 * visible while they keep chatting. Tabs are scoped per session, so
 * switching sessions doesn't drag unrelated docs along.
 *
 * State shape:
 *   - tabs: ordered list of open docs (filePath only — content is fetched
 *     on demand by the pane component and cached locally there).
 *   - activeIndex: which tab is currently shown. -1 means "no active tab"
 *     and renders nothing; the panel disappears entirely.
 *
 * `atomFamily` keyed by sessionId gives us cheap session-scoped state.
 * Empty array initial value = pane invisible until first "Open in sidebar".
 */

import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'

export interface SidebarDocTab {
  filePath: string
}

export interface SidebarDocsState {
  tabs: SidebarDocTab[]
  activeIndex: number
}

const EMPTY_STATE: SidebarDocsState = { tabs: [], activeIndex: -1 }

const STORAGE_KEY_PREFIX = 'craft-sidebar-docs:'

/** Read persisted tabs for a session from localStorage. Falls back silently. */
function loadPersisted(sessionId: string): SidebarDocsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + sessionId)
    if (!raw) return EMPTY_STATE
    const parsed = JSON.parse(raw) as SidebarDocsState
    // Defensive shape check — corrupt entries shouldn't crash the panel
    if (!Array.isArray(parsed.tabs) || typeof parsed.activeIndex !== 'number') return EMPTY_STATE
    return parsed
  } catch {
    return EMPTY_STATE
  }
}

/** Persist tabs for a session. No-op on storage errors (e.g. quota exceeded). */
function persistState(sessionId: string, state: SidebarDocsState): void {
  try {
    if (state.tabs.length === 0) {
      localStorage.removeItem(STORAGE_KEY_PREFIX + sessionId)
    } else {
      localStorage.setItem(STORAGE_KEY_PREFIX + sessionId, JSON.stringify(state))
    }
  } catch {
    // ignore
  }
}

// ┌─────────────────────────────────────────────────────────────────────┐
// │ atomFamily — per-session sidebar docs state with localStorage sync. │
// │ Hydrates from storage on first read; writes back on every change.  │
// │ Storage key is `craft-sidebar-docs:<sessionId>`.                    │
// └─────────────────────────────────────────────────────────────────────┘
export const sidebarDocsAtomFamily = atomFamily((sessionId: string) => {
  const baseAtom = atom<SidebarDocsState>(loadPersisted(sessionId))
  return atom(
    (get) => get(baseAtom),
    (get, set, update: SidebarDocsState | ((prev: SidebarDocsState) => SidebarDocsState)) => {
      const prev = get(baseAtom)
      const next = typeof update === 'function' ? update(prev) : update
      set(baseAtom, next)
      persistState(sessionId, next)
    },
  )
})

/**
 * Open a doc as a tab. If the same filePath is already open, switch to it
 * instead of creating a duplicate. Returns the updated state for callers
 * that want to react inline (e.g. focus the pane).
 */
export function openSidebarDocTab(
  state: SidebarDocsState,
  filePath: string,
): SidebarDocsState {
  const existing = state.tabs.findIndex((t) => t.filePath === filePath)
  if (existing >= 0) {
    return { ...state, activeIndex: existing }
  }
  const tabs = [...state.tabs, { filePath }]
  return { tabs, activeIndex: tabs.length - 1 }
}

/**
 * Close a tab by index. If the closed tab was the active one, prefer the
 * tab to its left; if there isn't one, fall back to the next tab; if no
 * tabs remain, collapse the pane.
 */
export function closeSidebarDocTab(
  state: SidebarDocsState,
  index: number,
): SidebarDocsState {
  if (index < 0 || index >= state.tabs.length) return state
  const tabs = state.tabs.filter((_, i) => i !== index)
  if (tabs.length === 0) return EMPTY_STATE
  let activeIndex = state.activeIndex
  if (index < activeIndex) {
    activeIndex = activeIndex - 1
  } else if (index === activeIndex) {
    activeIndex = Math.max(0, index - 1)
    if (activeIndex >= tabs.length) activeIndex = tabs.length - 1
  }
  return { tabs, activeIndex }
}
