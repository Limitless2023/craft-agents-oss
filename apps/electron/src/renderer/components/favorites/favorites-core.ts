/**
 * [INPUT]: 无外部依赖（纯函数模块）
 * [OUTPUT]: Favorite 类型 + parse/toggle/remove/isFavorited/sortByCreatedDesc 纯函数
 * [POS]: favorites 模块的纯逻辑内核，被 favorites-store 消费；无 DOM，可 bun test
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ============================================================
// Types
// ============================================================
export interface Favorite {
  /** 唯一键：一条回复一条收藏 */
  messageId: string
  sessionId: string
  sessionTitle: string
  /** 收藏瞬间的回复 markdown：列表摘要 + 原对话已删的兜底 */
  contentSnapshot: string
  createdAt: number
}

// ============================================================
// Pure reducers — 无副作用，全部返回新数组
// ============================================================
export function parseFavorites(raw: string | null): Favorite[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Favorite[]) : []
  } catch {
    return []
  }
}

export function isFavorited(list: Favorite[], messageId: string): boolean {
  return list.some(f => f.messageId === messageId)
}

export function toggleFavorite(list: Favorite[], fav: Favorite): Favorite[] {
  return isFavorited(list, fav.messageId)
    ? removeFavorite(list, fav.messageId)
    : [...list, fav]
}

export function removeFavorite(list: Favorite[], messageId: string): Favorite[] {
  return list.filter(f => f.messageId !== messageId)
}

export function sortByCreatedDesc(list: Favorite[]): Favorite[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt)
}
