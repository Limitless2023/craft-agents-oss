/**
 * [INPUT]: 无外部依赖（纯函数）
 * [OUTPUT]: previewToolOutput —— 工具输出 → 折叠预览（前 N 行 + 剩余计数）
 * [POS]: chat 模块的工具输出摘要器，供 ActivityRow 在工具行下方渲染
 *        （Claude Code 同款 `⎿ 输出前几行 … +N lines`）。
 *        只做"取头部并截断"，不解析语义——工具输出形态千差万别（stdout/JSON/
 *        文件内容），任何按类型的花哨解析都会在下一个工具上失效。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export interface ToolOutputPreview {
  /** 展示用的行（已截断，不含尾随空白）。 */
  lines: string[]
  /** 未展示的剩余行数（0 表示已全部展示）。 */
  hiddenLineCount: number
}

/** 预览取前 6 行——够看清一段命令输出的要点，又不至于淹没步骤列表。 */
export const PREVIEW_MAX_LINES = 6
/**
 * 每行字符上限。大屏上一行能容纳的字符远多于窄面板，这个上限只是兜底护栏
 * （防止单行超长字符串拖垮渲染）；真正的视觉截断交给 CSS truncate 按实际宽度做。
 */
export const PREVIEW_MAX_CHARS = 400

/**
 * 工具输出 → 预览。无内容（空/纯空白）返回 null，调用方据此不渲染预览区。
 * 空行在取样前先滤掉：工具输出常以空行开头/结尾，占着预览额度却什么都不说。
 */
export function previewToolOutput(
  content: string | undefined,
  opts: { maxLines?: number; maxChars?: number } = {}
): ToolOutputPreview | null {
  if (!content) return null

  const maxLines = opts.maxLines ?? PREVIEW_MAX_LINES
  const maxChars = opts.maxChars ?? PREVIEW_MAX_CHARS

  const meaningful = content
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => line.trim().length > 0)

  if (meaningful.length === 0) return null

  const lines = meaningful.slice(0, maxLines).map(line => {
    const trimmed = line.trimStart()
    return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1).trimEnd()}…` : trimmed
  })

  return { lines, hiddenLineCount: Math.max(0, meaningful.length - lines.length) }
}
