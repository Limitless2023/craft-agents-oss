/**
 * [INPUT]: 依赖 ../tool-output-preview 的 previewToolOutput 与上限常量
 * [OUTPUT]: 工具输出预览截断逻辑的守护测试
 * [POS]: chat/__tests__ 下的纯函数测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test'
import { previewToolOutput, PREVIEW_MAX_CHARS } from '../tool-output-preview'

describe('previewToolOutput', () => {
  test('取前 N 行并报出剩余行数', () => {
    const out = previewToolOutput('a\nb\nc\nd', { maxLines: 2 })
    expect(out).toEqual({ lines: ['a', 'b'], hiddenLineCount: 2 })
  })

  test('滤掉空行（工具输出常以空行开头，不该占预览额度）', () => {
    const out = previewToolOutput('\n\n  \nreal output\n\nsecond', { maxLines: 2 })
    expect(out).toEqual({ lines: ['real output', 'second'], hiddenLineCount: 0 })
  })

  test('超长行截断加省略号', () => {
    // 长度由常量派生——调 PREVIEW_MAX_CHARS 时测试不该跟着挂
    const long = 'x'.repeat(PREVIEW_MAX_CHARS * 2)
    const out = previewToolOutput(long)
    expect(out!.lines[0]!.length).toBe(PREVIEW_MAX_CHARS)
    expect(out!.lines[0]!.endsWith('…')).toBe(true)
  })

  test('恰好等于上限的行不截断（边界）', () => {
    const exact = 'x'.repeat(PREVIEW_MAX_CHARS)
    const out = previewToolOutput(exact)
    expect(out!.lines[0]).toBe(exact)
    expect(out!.lines[0]!.endsWith('…')).toBe(false)
  })

  test('去掉行首缩进（保留可读性，不浪费横向空间）', () => {
    const out = previewToolOutput('      indented line')
    expect(out!.lines[0]).toBe('indented line')
  })

  test('空内容 / 纯空白 / undefined → null（调用方不渲染预览区）', () => {
    expect(previewToolOutput('')).toBeNull()
    expect(previewToolOutput('   \n\n  ')).toBeNull()
    expect(previewToolOutput(undefined)).toBeNull()
  })
})
