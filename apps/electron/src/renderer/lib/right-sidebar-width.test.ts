/**
 * [INPUT]: 依赖 ./right-sidebar-width 的 clampRightSidebarWidth + autoCollapseLevel + 常量；
 *          依赖 ../components/app-shell/panel-constants 的 PANEL_MIN_WIDTH（同步守护）
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: 右侧栏宽度 clamp / 收起阶梯纯逻辑的回归测试；bun test 直接运行，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import {
  clampRightSidebarWidth,
  autoCollapseLevel,
  RIGHT_SIDEBAR_MIN_WIDTH,
  OTHER_PANEL_MAX_WIDTH,
  MIN_MAIN_CONTENT_WIDTH,
} from './right-sidebar-width'
import { PANEL_MIN_WIDTH } from '../components/app-shell/panel-constants'

// reservedLeft ≈ sidebar(220) + sessionList(300) + gaps(~18) = 538 (both left columns open)
const LEFT = 538

// ============================================================
// 常量同步守护：聊天保底必须等于布局层的面板最小宽度，
// 否则 reserve 按小数算、PanelSlot 按大数拒缩 → flex 行溢出。
// ============================================================
test('MIN_MAIN_CONTENT_WIDTH stays in lockstep with PANEL_MIN_WIDTH', () => {
  expect(MIN_MAIN_CONTENT_WIDTH).toBe(PANEL_MIN_WIDTH)
})

test('wide screen: preview has no absolute cap — chat minimum is the only bound', () => {
  // room = 1920 - 538 - 440(min chat) = 942 → 900 直通；1500 被压到 942
  expect(clampRightSidebarWidth(900, 'preview', 1920, LEFT)).toBe(900)
  expect(clampRightSidebarWidth(1500, 'preview', 1920, LEFT)).toBe(942)
})

test('small screen: preview shrinks so the chat keeps its minimum (the bug)', () => {
  // room = 1200 - 538 - 440 = 222 → capped at 222
  expect(clampRightSidebarWidth(1000, 'preview', 1200, LEFT)).toBe(222)
})

test('hiding the left columns gives the preview more room (dynamic reserve)', () => {
  // same 1200px window but columns hidden → room = 1200 - 0 - 440 = 760
  expect(clampRightSidebarWidth(1000, 'preview', 1200, 0)).toBe(760)
})

test('tiny window floors the panel at the minimum width', () => {
  // room = 900 - 538 - 440 = -78 < MIN → floored at MIN
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
  // 1200 - 0 - 440 = 760
  expect(clampRightSidebarWidth(1000, 'preview', 1200)).toBe(760)
})

// ============================================================
// autoCollapseLevel — 拖宽 Preview 时左侧列逐级让位
// 1920 窗口：reservedFull=544 (base12+左栏226+会话列表306), reservedNavOnly=318
// room(full) = 1920-544-440 = 936; room(navOnly) = 1920-318-440 = 1162
// ============================================================
test('autoCollapseLevel: fits with everything shown → 0 (boundary is strict >)', () => {
  expect(autoCollapseLevel(936, 1920, 544, 318)).toBe(0)
})

test('autoCollapseLevel: crossing the sidebar threshold → 1', () => {
  expect(autoCollapseLevel(937, 1920, 544, 318)).toBe(1)
  expect(autoCollapseLevel(1162, 1920, 544, 318)).toBe(1) // nav 阈值边界仍是 1
})

test('autoCollapseLevel: crossing the nav threshold → 2', () => {
  expect(autoCollapseLevel(1163, 1920, 544, 318)).toBe(2)
})

test('autoCollapseLevel: sidebar already hidden by pref (full === navOnly) → jumps straight to 2', () => {
  expect(autoCollapseLevel(1163, 1920, 318, 318)).toBe(2)
})
