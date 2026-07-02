/**
 * [INPUT]: 依赖 ./right-sidebar-width 的 clampRightSidebarWidth + isUnderSpacePressure + 常量
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: 右侧栏宽度 clamp 纯逻辑的回归测试；bun test 直接运行，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import {
  clampRightSidebarWidth,
  isUnderSpacePressure,
  RIGHT_SIDEBAR_MIN_WIDTH,
  PREVIEW_MAX_WIDTH,
  OTHER_PANEL_MAX_WIDTH,
} from './right-sidebar-width'

// reservedLeft ≈ sidebar(220) + sessionList(300) + gaps(~18) = 538 (both left columns open)
const LEFT = 538

test('wide screen with both columns open still allows the full preview cap', () => {
  // room = 1920 - 538 - 320(min chat) = 1062 > 1000 → type cap wins
  expect(clampRightSidebarWidth(1000, 'preview', 1920, LEFT)).toBe(PREVIEW_MAX_WIDTH)
})

test('small screen: preview shrinks so the chat keeps its 320px minimum (the bug)', () => {
  // room = 1200 - 538 - 320 = 342 → capped at 342, not 60%*1200=720
  expect(clampRightSidebarWidth(1000, 'preview', 1200, LEFT)).toBe(342)
})

test('hiding the left columns gives the preview more room (dynamic reserve)', () => {
  // same 1200px window but columns hidden → room = 1200 - 0 - 320 = 880
  expect(clampRightSidebarWidth(1000, 'preview', 1200, 0)).toBe(880)
})

test('tiny window floors the panel at the minimum width', () => {
  // room = 900 - 538 - 320 = 42 < MIN → floored at MIN
  expect(clampRightSidebarWidth(1000, 'preview', 900, LEFT)).toBe(RIGHT_SIDEBAR_MIN_WIDTH)
})

test('width never drops below the minimum', () => {
  expect(clampRightSidebarWidth(50, 'preview', 1920, LEFT)).toBe(RIGHT_SIDEBAR_MIN_WIDTH)
})

test('non-preview panels are capped at OTHER_PANEL_MAX_WIDTH', () => {
  expect(clampRightSidebarWidth(1000, 'docs', 1920, LEFT)).toBe(OTHER_PANEL_MAX_WIDTH)
  expect(clampRightSidebarWidth(300, undefined, 1920, LEFT)).toBe(300)
})

test('reservedLeft defaults to 0 when omitted', () => {
  // 1200 - 0 - 320 = 880
  expect(clampRightSidebarWidth(1000, 'preview', 1200)).toBe(880)
})

// ============================================================
// isUnderSpacePressure — 左栏显示时 preview 能否达到意图宽度？
// room = innerWidth - reservedLeftWithSidebar - 320(min chat)
// ============================================================
test('isUnderSpacePressure: fits with sidebar → no pressure', () => {
  // room = 1920 - 538 - 320 = 1062; intentWidth=600 ≤ 1062 → false
  expect(isUnderSpacePressure(600, 1920, 538)).toBe(false)
})

test('isUnderSpacePressure: does not fit → pressure', () => {
  // room = 1200 - 538 - 320 = 342; intentWidth=343 > 342 → true
  expect(isUnderSpacePressure(343, 1200, 538)).toBe(true)
})

test('isUnderSpacePressure: boundary (exact fit) → no pressure (strict >)', () => {
  // room = 1200 - 538 - 320 = 342; intentWidth=342 → 342 > 342 = false
  expect(isUnderSpacePressure(342, 1200, 538)).toBe(false)
})
