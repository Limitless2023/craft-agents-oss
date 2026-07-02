/**
 * [INPUT]: 依赖 ./ChatDisplay.follow-ups 的 formatFollowUpSection + 类型
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: follow-up 拼接纯逻辑回归；bun test，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import { formatFollowUpSection, type PendingFollowUpAnnotation } from './ChatDisplay.follow-ups'

const base = (over: Partial<PendingFollowUpAnnotation>): PendingFollowUpAnnotation => ({
  messageId: 'm1', annotationId: 'a1', note: 'do X', selectedText: 'the passage', createdAt: 1, ...over,
})

test('chat item (no sourceLabel) is unchanged', () => {
  const out = formatFollowUpSection([base({})], { includeTopSeparator: false })
  expect(out).toContain('> [#1] the passage')
  expect(out).toContain('→ do X')
  expect(out).not.toContain('(')
})

test('preview item prefixes the quote with (fileName)', () => {
  const out = formatFollowUpSection([base({ sourceLabel: 'report.md' })], { includeTopSeparator: false })
  expect(out).toContain('> [#1] (report.md) the passage')
})
