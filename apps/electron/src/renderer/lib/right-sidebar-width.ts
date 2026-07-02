/**
 * [INPUT]: 无外部依赖（纯函数 + 常量）
 * [OUTPUT]: clampRightSidebarWidth + 宽度常量（PREVIEW_MAX_WIDTH / OTHER_PANEL_MAX_WIDTH / RIGHT_SIDEBAR_MIN_WIDTH / MIN_MAIN_CONTENT_WIDTH）
 * [POS]: 右侧栏（Preview/Info）宽度的单一 clamp 规则；AppShell 拖拽 + 渲染派生共用。
 *        约束 = "给聊天区留够 MIN_MAIN_CONTENT_WIDTH"，而非固定窗口比例——否则小屏上左侧固定列会把聊天压没。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ============================================================
// 宽度约束常量
// ============================================================
export const RIGHT_SIDEBAR_MIN_WIDTH = 180
export const PREVIEW_MAX_WIDTH = 1000        // Preview：宽阅读栏
export const OTHER_PANEL_MAX_WIDTH = 480      // Info/docs：文件树/列表，不需过宽
// 右侧栏永远不能把主内容（聊天）压到这个宽度以下
export const MIN_MAIN_CONTENT_WIDTH = 320

// ============================================================
// 单一真相：给定 意图宽度 + 面板类型 + 当前窗宽 + 左侧已占用宽度，返回可用宽度。
// reservedLeftPx = 左侧栏 + 会话列表 + 列间距等（随隐藏/折叠动态变化，由调用方按实际布局算好）。
// 上限 = min(类型上限, 窗宽 − 左侧占用 − 最小聊天宽)，下限 MIN_WIDTH。
// ============================================================
export function clampRightSidebarWidth(
  width: number,
  panelType: string | undefined,
  innerWidth: number,
  reservedLeftPx = 0,
): number {
  const typeMax = panelType === 'preview' ? PREVIEW_MAX_WIDTH : OTHER_PANEL_MAX_WIDTH
  const roomForPanel = innerWidth - reservedLeftPx - MIN_MAIN_CONTENT_WIDTH
  // 极小窗口下 roomForPanel 可能低于 MIN_WIDTH——用 MIN 兜底，此时聊天被迫更窄（窗口本身太小）。
  const max = Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(typeMax, roomForPanel))
  return Math.min(Math.max(width, RIGHT_SIDEBAR_MIN_WIDTH), max)
}
