/**
 * [INPUT]: 依赖 ./right-sidebar-width 的 clampRightSidebarWidth + 常量
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: 右侧栏宽度 clamp 纯逻辑的回归测试；bun test 直接运行，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import {
  clampRightSidebarWidth,
  RIGHT_SIDEBAR_MIN_WIDTH,
  PREVIEW_MAX_WIDTH,
  OTHER_PANEL_MAX_WIDTH,
} from './right-sidebar-width'

test('preview panel is capped at PREVIEW_MAX_WIDTH on a wide window', () => {
  // 1920 * 0.6 = 1152 > 1000 → fixed cap wins
  expect(clampRightSidebarWidth(1000, 'preview', 1920)).toBe(PREVIEW_MAX_WIDTH)
  expect(clampRightSidebarWidth(5000, 'preview', 1920)).toBe(PREVIEW_MAX_WIDTH)
})

test('preview panel is capped at 60% window on a narrow window (the bug case)', () => {
  // stale stored 1000 on a 1512 screen → floor(1512*0.6)=907
  expect(clampRightSidebarWidth(1000, 'preview', 1512)).toBe(907)
})

test('width never drops below the minimum', () => {
  expect(clampRightSidebarWidth(50, 'preview', 1920)).toBe(RIGHT_SIDEBAR_MIN_WIDTH)
  expect(clampRightSidebarWidth(0, 'docs', 1920)).toBe(RIGHT_SIDEBAR_MIN_WIDTH)
})

test('non-preview panels are capped at OTHER_PANEL_MAX_WIDTH', () => {
  expect(clampRightSidebarWidth(1000, 'docs', 1920)).toBe(OTHER_PANEL_MAX_WIDTH)
  expect(clampRightSidebarWidth(300, undefined, 1920)).toBe(300)
})

test('non-preview also respects the 60% window floor on tiny windows', () => {
  // 700 * 0.6 = 420 < 480 → window fraction wins
  expect(clampRightSidebarWidth(480, 'docs', 700)).toBe(420)
})
