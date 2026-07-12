/**
 * [INPUT]: 无外部依赖（纯函数 + 常量）
 * [OUTPUT]: clampRightSidebarWidth + autoCollapseLevel + 宽度常量（OTHER_PANEL_MAX_WIDTH / RIGHT_SIDEBAR_MIN_WIDTH / MIN_MAIN_CONTENT_WIDTH）
 * [POS]: 右侧栏（Preview/Info）宽度的单一 clamp 规则；AppShell 拖拽 + 渲染派生共用。
 *        约束 = "给聊天区留够 MIN_MAIN_CONTENT_WIDTH"，而非固定窗口比例——否则小屏上左侧固定列会把聊天压没。
 *        Preview 无绝对上限：聊天保底是唯一规则；拖宽穿越阈值时左侧列按阶梯逐级自动让位（收左栏 → 收会话列表）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ============================================================
// 宽度约束常量
// ============================================================
export const RIGHT_SIDEBAR_MIN_WIDTH = 180
export const OTHER_PANEL_MAX_WIDTH = 480      // Info/docs：文件树/列表，不需过宽
// 右侧栏永远不能把主内容（聊天）压到这个宽度以下。
// 必须等于 panel-constants 的 PANEL_MIN_WIDTH（PanelSlot 用它做 flex minWidth）——
// 否则 reserve 按小数算、布局按大数拒缩，拖到极限时 flex 行溢出。
// 本文件保持零依赖（纯函数可测），同步由测试守护。
export const MIN_MAIN_CONTENT_WIDTH = 440

// ============================================================
// 自动收起阶梯：Preview 意图宽度放不下时，左侧列从左往右逐级让位。
// 0 = 全显示；1 = 收左栏；2 = 连会话列表也收。
// 阈值用"偏好布局"（假设该列显示）计算，与实际收起状态无关 → 无反馈震荡，
// 拖回去自然逐级还原。
// ============================================================
export function autoCollapseLevel(
  intentWidth: number,          // rightSidebarWidth（用户意图）
  innerWidth: number,
  reservedFull: number,         // 左栏 + 会话列表都显示时的左侧占用
  reservedNavOnly: number,      // 仅会话列表显示时的左侧占用
): 0 | 1 | 2 {
  const room = (reserved: number) => innerWidth - reserved - MIN_MAIN_CONTENT_WIDTH
  if (intentWidth > room(reservedNavOnly)) return 2
  if (intentWidth > room(reservedFull)) return 1
  return 0
}

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
  // Preview 不设绝对上限——聊天保底是唯一约束；Info/docs 类面板保留类型上限
  const typeMax = panelType === 'preview' ? Infinity : OTHER_PANEL_MAX_WIDTH
  const roomForPanel = innerWidth - reservedLeftPx - MIN_MAIN_CONTENT_WIDTH
  // 极小窗口下 roomForPanel 可能低于 MIN_WIDTH——用 MIN 兜底，此时聊天被迫更窄（窗口本身太小）。
  const max = Math.max(RIGHT_SIDEBAR_MIN_WIDTH, Math.min(typeMax, roomForPanel))
  return Math.min(Math.max(width, RIGHT_SIDEBAR_MIN_WIDTH), max)
}
