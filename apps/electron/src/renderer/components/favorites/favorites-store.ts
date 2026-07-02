/**
 * [INPUT]: 依赖 ./favorites-core 的纯 reducers；依赖 react 的 useSyncExternalStore；浏览器 localStorage
 * [OUTPUT]: getFavorites/toggleFavorite/removeFavorite/isFavorited/subscribeFavorites + useFavorites/useIsFavorited
 * [POS]: favorites 模块的单一真相源；心形按钮(ChatDisplay) 与 FavoritesPage 共享，自动同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useSyncExternalStore } from 'react'
import {
  parseFavorites,
  toggleFavorite as toggleCore,
  removeFavorite as removeCore,
  isFavorited as isFavoritedCore,
  type Favorite,
} from './favorites-core'

export type { Favorite } from './favorites-core'

const STORAGE_KEY = 'craft-favorites-v1'

// ============================================================
// In-memory snapshot (single source of truth) + listeners
// ============================================================
let snapshot: Favorite[] = readFromStorage()
const listeners = new Set<() => void>()

function readFromStorage(): Favorite[] {
  if (typeof window === 'undefined') return []
  return parseFavorites(window.localStorage.getItem(STORAGE_KEY))
}

function commit(next: Favorite[]): void {
  snapshot = next
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  listeners.forEach(l => l())
}

// Cross-window sync: another window edited localStorage
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) {
      snapshot = parseFavorites(e.newValue)
      listeners.forEach(l => l())
    }
  })
}

// ============================================================
// Imperative API
// ============================================================
export function getFavorites(): Favorite[] {
  return snapshot
}

export function isFavorited(messageId: string): boolean {
  return isFavoritedCore(snapshot, messageId)
}

export function toggleFavorite(fav: Favorite): void {
  commit(toggleCore(snapshot, fav))
}

export function removeFavorite(messageId: string): void {
  commit(removeCore(snapshot, messageId))
}

export function subscribeFavorites(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// ============================================================
// React hooks
// ============================================================
export function useFavorites(): Favorite[] {
  return useSyncExternalStore(subscribeFavorites, getFavorites, getFavorites)
}

export function useIsFavorited(messageId: string): boolean {
  return useSyncExternalStore(
    subscribeFavorites,
    () => isFavoritedCore(snapshot, messageId),
    () => false,
  )
}
