/**
 * [INPUT]: 无外部依赖（模块单例 + 监听器集合）
 * [OUTPUT]: requestHighlight/peekHighlight/consumeHighlight/subscribeHighlight (+ __resetHighlight 测试用)
 * [POS]: favorites 模块的临时（非持久化）跳转高亮信号；FavoritesPage 请求、ChatDisplay 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 临时信号：让某会话挂载/渲染时滚动+闪烁某条消息（一次性，consume 后清空）
interface HighlightRequest { sessionId: string; messageId: string }

let pending: HighlightRequest | null = null
const listeners = new Set<() => void>()

export function requestHighlight(sessionId: string, messageId: string): void {
  pending = { sessionId, messageId }
  listeners.forEach(l => l())
}

export function peekHighlight(sessionId: string): string | null {
  return pending && pending.sessionId === sessionId ? pending.messageId : null
}

export function consumeHighlight(sessionId: string): void {
  if (pending && pending.sessionId === sessionId) pending = null
}

export function subscribeHighlight(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// test-only
export function __resetHighlight(): void {
  pending = null
  listeners.clear()
}
