/**
 * [INPUT]: 依赖 react 的 useState；浏览器 localStorage
 * [OUTPUT]: FavoritesViewMode 类型 + parseViewMode 纯函数 + useFavoritesViewMode hook
 * [POS]: favorites 模块的视图模式状态管理；FavoritesPage 单一消费者，无需跨窗口同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { useState } from 'react'

// ============================================================
// Types
// ============================================================
export type FavoritesViewMode = 'list' | 'card'

const STORAGE_KEY = 'craft-favorites-view-v1'

// ============================================================
// Pure parser — null/未知值 → 'card'（首次默认卡片）
// ============================================================
export function parseViewMode(raw: string | null): FavoritesViewMode {
  if (raw === 'list') return 'list'
  return 'card'
}

// ============================================================
// React hook — localStorage write-through 持久化
// ============================================================
export function useFavoritesViewMode(): [FavoritesViewMode, (m: FavoritesViewMode) => void] {
  const [mode, setMode] = useState<FavoritesViewMode>(() => {
    if (typeof window === 'undefined') return 'card'
    return parseViewMode(window.localStorage.getItem(STORAGE_KEY))
  })

  const setAndPersist = (m: FavoritesViewMode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, m)
    }
    setMode(m)
  }

  return [mode, setAndPersist]
}
