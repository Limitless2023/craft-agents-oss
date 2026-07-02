/**
 * [INPUT]: 依赖 ./favorites-view-mode 的 parseViewMode 纯函数
 * [OUTPUT]: 无（测试文件，不对外暴露）
 * [POS]: favorites-view-mode 纯逻辑的 TDD 验证；bun test 直接运行，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import { test, expect } from 'bun:test'
import { parseViewMode } from './favorites-view-mode'

test('parseViewMode: null → card (首次默认卡片)', () => {
  expect(parseViewMode(null)).toBe('card')
})

test('parseViewMode: "card" → card', () => {
  expect(parseViewMode('card')).toBe('card')
})

test('parseViewMode: "list" → list', () => {
  expect(parseViewMode('list')).toBe('list')
})

test('parseViewMode: 未知值 → card (兜底)', () => {
  expect(parseViewMode('bogus')).toBe('card')
})
