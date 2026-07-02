# 左侧导航栏「空间压力」自动收起 — 设计

> 日期: 2026-07-02 · 分支: `feat/favorites`衍生 `tweak/preview-max-width` · 轻量执行（1 实现 + 1 审查）

## 目标
当 Preview 打开、且"显示左侧导航栏会导致 preview 无法达到用户拖定的意图宽度并保证聊天 ≥320px"时，**自动收起最左侧导航栏**腾出空间；压力解除（窗口变大 / 关闭 Preview）则**自动恢复**。全程不改用户持久化的 `sidebarVisible` 偏好；Cmd+B 改为按"当前实际可见"翻转，不与自动行为打架。

## 范围
纯 renderer，改动集中在 `AppShell.tsx` + `right-sidebar-width.ts` 的一个纯函数。**不动会话列表**（仅收最左导航栏）。**不动** reserve-clamp（它仍是最终地板；本优化让系统在压力下先牺牲左栏、再牺牲 preview 宽度）。

## ① 纯函数 `isUnderSpacePressure` — `apps/electron/src/renderer/lib/right-sidebar-width.ts`
新增导出（更新该文件 L3 头 `[OUTPUT]`）：
```ts
// 显示左栏时 preview 能否达到意图宽度还留够聊天？留不下 = 有压力。
export function isUnderSpacePressure(
  intentWidth: number,              // rightSidebarWidth（用户意图）
  innerWidth: number,
  reservedLeftWithSidebar: number,  // 含左栏在内的左侧占用（sidebar+nav+gaps）
): boolean {
  const roomForPreview = innerWidth - reservedLeftWithSidebar - MIN_MAIN_CONTENT_WIDTH
  return intentWidth > roomForPreview
}
```
配单测 `right-sidebar-width.test.ts` 追加：意图能放下→false；放不下→true；边界。

## ② AppShell 状态 + 有效可见度
在 `reservedLeftWidth` 计算区（~622）附近重构为三层：
```ts
const [leftSidebarAutoHidden, setLeftSidebarAutoHidden] = React.useState(false)
// 用户偏好层（忽略自动收起）：想不想显示左栏
const sidebarShownByPref = !effectiveSidebarAndNavigatorHidden && isSidebarVisible
// 实际布局层：偏好 且 未被自动收起
const sidebarShownEffective = sidebarShownByPref && !leftSidebarAutoHidden

// 两个 reserved：一个"假设左栏显示"用于判压力，一个"实际"用于 clamp/布局
const navWidth = (isFavoritesNavigation(navState) || effectiveSidebarAndNavigatorHidden) ? 0 : sessionListWidth
const gaps = (w: number) => (w > 0 ? PANEL_GAP : 0)
const reservedLeftWithSidebar =
  (sidebarShownByPref ? sidebarWidth : 0) + navWidth + PANEL_EDGE_INSET + PANEL_GAP
  + gaps(sidebarShownByPref ? sidebarWidth : 0) + gaps(navWidth)
const reservedLeftWidth = // 实际（供 displayedRightSidebarWidth 用）
  (sidebarShownEffective ? sidebarWidth : 0) + navWidth + PANEL_EDGE_INSET + PANEL_GAP
  + gaps(sidebarShownEffective ? sidebarWidth : 0) + gaps(navWidth)
```
（`displayedRightSidebarWidth` 与拖拽 clamp 继续用 `reservedLeftWidth`，不变。）

## ③ 边沿触发 effect（避免抖动 / 不与手动打架）
```ts
const pressure =
  isRightSidebarOpen && rightSidebarPanel?.type === 'preview' && sidebarShownByPref &&
  isUnderSpacePressure(rightSidebarWidth, windowWidth, reservedLeftWithSidebar)
const prevPressureRef = React.useRef(false)
React.useEffect(() => {
  const prev = prevPressureRef.current
  if (pressure && !prev) setLeftSidebarAutoHidden(true)      // 上升沿：自动收
  else if (!pressure && prev) setLeftSidebarAutoHidden(false) // 下降沿：自动还原
  prevPressureRef.current = pressure
}, [pressure])
```
仅在上升沿收起 → 用户在压力期间手动叫回后不会被立刻再收（直到压力解除并重新出现）。

## ④ 布局接线
- 传给 `PanelStackContainer` 的左栏宽度（~line 2685）由 `sidebarShownEffective` 决定：
  `sidebarWidth={sidebarShownEffective ? sidebarWidth : 0}`（复用既有 0 宽折叠动画）。
- 确保 `reservedLeftWidth`（②）用于 `displayedRightSidebarWidth`（~623）与拖拽 clamp（~1358）——已是现状，仅换成新的 `reservedLeftWidth` 定义。

## ⑤ Cmd+B 语义（按实际可见翻转）
定位现有切换左栏的快捷键处理（grep `sidebarVisible` / `setIsSidebarVisible` / Cmd/⌘+B keydown）。改为：
```ts
if (sidebarShownEffective) {
  setIsSidebarVisible(false)          // 当前可见 → 隐藏
} else {
  setIsSidebarVisible(true)
  setLeftSidebarAutoHidden(false)     // 当前隐藏（无论谁收的）→ 显示并清除自动收起
}
```

## ⑥ 边界
- compact（<768，`effectiveSidebarAndNavigatorHidden`）本就整体隐藏左栏 → `sidebarShownByPref=false` → pressure=false，本逻辑不介入。
- 非 preview 面板（docs/info）→ pressure=false，不自动收。
- 用户偏好本就隐藏左栏 → `sidebarShownByPref=false` → 不介入。

## ⑦ 测试 & 打补丁
- `bun test` isUnderSpacePressure；`bun run typecheck`；i18n 无新增键。
- 纯 renderer → `build:renderer` + `patch-app.sh`。

## 明确不做（YAGNI）
不做左栏收起动画定制、不做"记住自动收起状态"、不自动收会话列表、不加设置开关。
