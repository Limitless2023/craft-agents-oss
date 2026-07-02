/**
 * [INPUT]: 依赖 ./mention-query 的 extractMentionQuery
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: @ 提及查询提取的回归测试（重点：CJK/多语言）；bun test，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import { extractMentionQuery } from './mention-query'

test('ASCII query still works', () => {
  expect(extractMentionQuery('@abc')).toBe('abc')
})

test('CJK query is captured (the bug: was null → no search)', () => {
  expect(extractMentionQuery('@中文')).toBe('中文')
  expect(extractMentionQuery('@报告文档')).toBe('报告文档')
})

test('CJK after a space / preceding text', () => {
  expect(extractMentionQuery('看这个 @报告')).toBe('报告')
  expect(extractMentionQuery('hello @中文abc123')).toBe('中文abc123')
})

test('other scripts (Japanese kana, accented latin) via \\p{L}', () => {
  expect(extractMentionQuery('@ノート')).toBe('ノート')
  expect(extractMentionQuery('@résumé')).toBe('résumé')
})

test('bare @ returns empty string (not null)', () => {
  expect(extractMentionQuery('@')).toBe('')
})

test('filenames with spaces / dots / slashes preserved', () => {
  expect(extractMentionQuery('@app availability.md')).toBe('app availability.md')
  expect(extractMentionQuery('@docs/plan.md')).toBe('docs/plan.md')
})

test('no @ before caret → null', () => {
  expect(extractMentionQuery('hello world')).toBeNull()
})
