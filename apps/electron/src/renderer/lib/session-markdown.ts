/**
 * [INPUT]: 依赖 @craft-agent/ui 的 groupMessagesByTurn（消息→回合分组，与聊天渲染同源），
 *          ../../shared/types 的 Message 类型
 * [OUTPUT]: 对外提供 buildSessionMarkdown（会话→干净 markdown 文档）、
 *          sessionExportFileName（标题→安全文件名+时间戳）
 * [POS]: renderer/lib 的会话导出序列化层（纯函数可单测）。刻意不用上游
 *        formatTurnAsMarkdown（那是调试视图，带工具 JSON dump）——导出目标是
 *        "可读文档资产"：只留用户提问与助手最终回复正文（viz fence 原样保留，
 *        导出的 md 在 Preview 面板打开时交互组件仍是活的），工具步骤折叠成一行计数
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { groupMessagesByTurn } from '@craft-agent/ui'
import type { Message } from '../../shared/types'

export interface SessionMarkdownLabels {
  /** 用户回合的标题（如"提问"）。 */
  user: string
  /** 助手回合的标题（如"回答"）。 */
  assistant: string
  /** 文档头部来源说明（如"导出自 Craft Agents"）。 */
  exportedFrom: string
  /** 工具步骤省略提示（传入计数，返回整句）。 */
  activitiesOmitted: (count: number) => string
}

/**
 * 把会话消息序列化为干净的 markdown 文档。
 * 只输出：用户消息正文 + 助手最终回复正文（`isIntermediate` 旁白、tool 调用、
 * 系统消息一律不入文档，tool 折叠为一行计数提示）。
 */
export function buildSessionMarkdown(
  title: string,
  messages: Message[],
  labels: SessionMarkdownLabels
): string {
  const turns = groupMessagesByTurn(messages)
  const lines: string[] = []
  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`> ${labels.exportedFrom} · ${new Date().toLocaleString()}`)

  for (const turn of turns) {
    if (turn.type === 'user') {
      const text = turn.message.content?.trim()
      if (!text) continue
      lines.push('', '---', '')
      lines.push(`### 🧑 ${labels.user}`)
      lines.push('', text)
      continue
    }
    if (turn.type === 'assistant') {
      const text = turn.response?.text?.trim()
      const toolCount = turn.activities.filter(a => a.type === 'tool').length
      if (!text && toolCount === 0) continue
      lines.push('')
      lines.push(`### 🤖 ${labels.assistant}`)
      lines.push('')
      if (toolCount > 0) {
        lines.push(`> ⚙️ ${labels.activitiesOmitted(toolCount)}`, '')
      }
      if (text) lines.push(text)
    }
  }

  lines.push('')
  return lines.join('\n')
}

/** 标题 → 安全文件名（去非法字符、限长、加时间戳，CJK 保留）。 */
export function sessionExportFileName(title: string, now: Date = new Date()): string {
  const safe = title
    .replace(/[/\\:*?"<>|\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 50) || 'session'
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${safe}-${stamp}.md`
}
