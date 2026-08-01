/**
 * [INPUT]: 无外部依赖（纯函数）
 * [OUTPUT]: formatElapsed —— 毫秒时长 → 紧凑可读串
 * [POS]: chat 模块的时长格式化，供 TurnCard 折叠行的运行计时器使用
 *        （Codex 同款：长任务在摘要行上可见地 tick，而不是看起来卡住）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

/**
 * 毫秒 → 紧凑时长。分级刻意如此：一分钟内只关心秒（"12s"），
 * 超过就要分秒对齐才好比较（"1:05"），过时的负值/非法值归零。
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 1000))
  if (total < 60) return `${total}s`

  const seconds = total % 60
  const minutes = Math.floor(total / 60)
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`

  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
