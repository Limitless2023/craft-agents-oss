/**
 * [INPUT]: 无外部依赖（纯函数 + 常量）
 * [OUTPUT]: clampRightSidebarWidth + 宽度常量（PREVIEW_MAX_WIDTH / OTHER_PANEL_MAX_WIDTH / RIGHT_SIDEBAR_MIN_WIDTH / RIGHT_SIDEBAR_MAX_WINDOW_FRACTION）
 * [POS]: 右侧栏（Preview/Info）宽度的单一 clamp 规则；AppShell 拖拽 + 渲染派生共用，杜绝"存了却不按当前窗宽重算"
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ============================================================
// 宽度约束常量
// ============================================================
export const RIGHT_SIDEBAR_MIN_WIDTH = 180
export const PREVIEW_MAX_WIDTH = 1000        // Preview：宽阅读栏
export const OTHER_PANEL_MAX_WIDTH = 480      // Info/docs：文件树/列表，不需过宽
// 面板永不超过窗口的这个比例，保证聊天区始终留有余量（小屏兜底）
export const RIGHT_SIDEBAR_MAX_WINDOW_FRACTION = 0.6

// ============================================================
// 单一真相：给定"意图宽度 + 面板类型 + 当前窗宽"，返回可用宽度
// 同时受 类型上限 与 窗口比例上限 约束，下限 MIN_WIDTH
// ============================================================
export function clampRightSidebarWidth(
  width: number,
  panelType: string | undefined,
  innerWidth: number,
): number {
  const typeMax = panelType === 'preview' ? PREVIEW_MAX_WIDTH : OTHER_PANEL_MAX_WIDTH
  const max = Math.min(typeMax, Math.floor(innerWidth * RIGHT_SIDEBAR_MAX_WINDOW_FRACTION))
  return Math.min(Math.max(width, RIGHT_SIDEBAR_MIN_WIDTH), max)
}
