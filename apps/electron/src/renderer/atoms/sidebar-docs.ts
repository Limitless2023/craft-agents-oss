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

export const sidebarDocsAtomFamily = atomFamily((_sessionId: string) =>
  atom<SidebarDocsState>(EMPTY_STATE),
)

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
