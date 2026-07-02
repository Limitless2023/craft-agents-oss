# 收藏功能 (Message Favorites) — 设计文档

> 日期: 2026-06-29 · 分支: `feat/message-favorites` · 方案 A（跳回原对话 + 定位高亮）

## 1. 背景与目标

为每条 AI/agent 回复增加「收藏」（心形）按钮：点击即高亮为已收藏（实心红心），再点取消。
左侧栏在 Settings 上方新增「收藏」入口，点进去看到全部收藏记录；点击一条记录 →
**跳回原对话并滚动定位 + 短暂高亮**那条回复。

设计基线：**纯 renderer 层实现**，打补丁只需 `build:renderer` + `patch-app.sh`，
不碰 `main.cjs` / preload / 子进程，不在 `shared/protocol/channels.ts` 增加上游合并冲突面。

## 2. 范围

**做：** 心形按钮 + toggle、侧边栏入口、收藏页列表、点击跳回原对话+定位高亮、localStorage 持久化、i18n。

**不做（YAGNI）：** 分类/标签、搜索、跨设备同步、导出、主进程存储/RPC 通道。需要再议。

## 3. 数据模型与存储

存储介质：**renderer localStorage**，单键 `craft-favorites-v1`，值为 `Favorite[]`。
（Electron localStorage 落在 userData，重启与官方更新后保留。）

```ts
interface Favorite {
  messageId: string      // 唯一键：一条回复一条收藏
  sessionId: string      // 跳回原对话用（navigate(allSessions(sessionId)) 只需它）
  sessionTitle: string   // 列表展示标题
  contentSnapshot: string// 收藏瞬间的回复 markdown：列表摘要 + 原对话已删的兜底
  createdAt: number      // 排序（倒序）
}
```
> 规划期精简：去掉 `workspaceId`（跳转仅用 `sessionId`，YAGNI）。

**唯一键 = `messageId`** → "是否已收藏" = store 里有没有这个 id；toggle = 有则删、无则增。
**消除所有去重/特殊分支**——这是本设计的"好品味"核心。

### 3.1 Store 模块（新建）

`apps/electron/src/renderer/components/favorites/favorites-store.ts`

```ts
// 单一真相源：localStorage + 内存快照 + 订阅
getFavorites(): Favorite[]
isFavorited(messageId: string): boolean
toggleFavorite(fav: Favorite): void        // 有则 remove，无则 add
removeFavorite(messageId: string): void
subscribeFavorites(cb: () => void): () => void // 含跨窗口 storage 事件
// 纯逻辑拆到 favorites-core.ts（parse/toggle/remove/isFavorited/sort），bun test 覆盖
```

React 侧用 `useSyncExternalStore(subscribe, getSnapshot)` 暴露 `useFavorites()` /
`useIsFavorited(messageId)`。心形按钮与收藏页共享同一 store → 自动同步。

## 4. 组件与改动清单

### 4.1 心形按钮 — `packages/ui/src/components/chat/TurnCard.tsx`

- 工具栏在 2509–2576 行；左侧按钮组（Copy/Markdown）2516–2550，**心形加在 Markdown 按钮（2539–2549）右侧**。
- TurnCard 属于共享 UI 库，**不直接依赖 renderer 的 store**。新增两个 props，保持纯组件：
  - `isFavorited?: boolean`
  - `onToggleFavorite?: () => void`
- lucide `Heart`：未收藏 = 描边灰心（与 Copy/Markdown 同款 ghost）；已收藏 = **实心红心**（`fill-current text-red-500`）。icon + 文案「收藏」。
- 仅在 `response?.messageId` 存在且 `!response.isStreaming` 时渲染（流式中不显示）。

### 4.2 接线 — `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`

- TurnCard 渲染在 1710–1838 行。ChatDisplay 订阅 store（唯一集成点），按 turn 计算 `isFavorited`。
- `onToggleFavorite` 在此构造 `Favorite` 负载：`messageId`(=`response.messageId`)、
  `sessionId`(=`session.id`)、`sessionTitle`(=`session.title`)、`contentSnapshot`(=`response.text`)、`createdAt`。

### 4.3 侧边栏入口 — `apps/electron/src/renderer/components/app-shell/AppShell.tsx`

- `LeftSidebar` links 数组中，Settings 项在 2625–2631、其上分隔线在 2623。**在分隔线正上方插入「收藏」LinkItem**：
  `{ id: "nav:favorites", title: t("sidebar.favorites"), icon: Heart, variant: isFavoritesNavigation(navState) ? "default" : "ghost", onClick: handleFavoritesClick }`。
- 新增 `handleFavoritesClick = useCallback(() => navigate(routes.view.favorites()), [navigate])`（仿 1872 行 `handleSettingsClick`），并在导航 useMemo（~2119）引用。

### 4.4 导航类型 — `apps/electron/src/shared/types.ts`

- 新增 `interface FavoritesNavigationState { navigator: 'favorites' }` 与守卫
  `isFavoritesNavigation(s): s is FavoritesNavigationState`，并入 `NavigationState` 联合（872–877）。
- 会话态 `SessionsNavigationState` **不改**——高亮走独立信号 store（见 §5，规划期从 query-param 方案修订而来）。

### 4.5 路由 — `route-parser.ts` / `routes.ts`

- `routes.ts`（仿 settings 180–184）新增 `routes.view.favorites()` → `'favorites'`。
- `route-parser.ts`：`COMPOUND_ROUTE_PREFIXES`（63–64）加 `'favorites'`；`parseCompoundRoute`（~97–109）
  与 `buildCompoundRoute`（~262–265）各加一处 favorites 分支（无 subpage，最简）。

### 4.6 主内容区 — `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`

- 仿 `isSettingsNavigation` 块（237–244）新增：
  `if (isFavoritesNavigation(navState)) return wrapWithStoplight(<Panel variant="grow"><FavoritesPage/></Panel>)`。

### 4.7 收藏页（新建）— `apps/electron/src/renderer/components/favorites/FavoritesPage.tsx`

- `useFavorites()` 取列表，按 `createdAt` 倒序。
- 每张卡片：`sessionTitle` + 内容摘要（`contentSnapshot` 截断）+ 相对时间 + 取消收藏按钮（实心红心，点击 `remove`）。
- **点击卡片 = 跳回原对话**：`requestHighlight(sessionId, messageId)` + `navigate(routes.view.allSessions(sessionId))`（干净路由，不带 query）。
  用 `allSessions` 视图（含全部会话，必能命中）。
- 空状态：友好文案 + 提示「在任意回复下点心形即可收藏」。

## 5. 跳回原对话 + 定位高亮（方案 A 核心数据流）

> **规划期修订**：原设计走 `?highlight=` query-param，但探查发现复合路由（`allSessions/session/{id}`）
> 的 `parseCompoundRoute` 只 `split('/')` 不剥离 `?`，会把 details id 污染成 `{id}?highlight={mid}`；
> 且 `ParsedCompoundRoute` 无 `params` 字段（query 仅在 action 分支解析）、`navigate` 无 `{replace}`。
> 硬走它需改 `route-parser.ts` + `NavigationContext.tsx` 两个上游核心文件。改用**独立高亮信号 store**——
> 只碰 `ChatDisplay` + 新 store + 收藏页，UX 不变，blast radius 更小、更贴合"纯 renderer"基线。

新建 `favorites-highlight-store.ts`（**临时/非持久化**，仿 store 模式的模块单例）：
`requestHighlight(sessionId, messageId)` / `peekHighlight(sessionId)` / `consumeHighlight(sessionId)` / `subscribeHighlight(cb)`。

数据流（复用既有基建，新增极少）：

1. **请求**：收藏页点击卡片 → `requestHighlight(sessionId, messageId)`，随后 `navigate(routes.view.allSessions(sessionId))`。
2. **消费**：`ChatDisplay` 本就持有 `session.id`。用 `useEffect`（依赖 `assistantTurnIndexByMessageId`）
   `peek` 本会话的待高亮 messageId；当消息已加载（map 命中）时 `consume` 并设 `highlightMessageId` state。
   订阅 `subscribeHighlight` 以覆盖"会话已挂载"场景。
3. **滚动**：抽出 `scrollToMessage(messageId)`（从 `scrollToFollowUpTurn` 提取——其 `annotationId` 不参与滚动，
   1410–1450 自带分页懒加载 + 居中 `scrollIntoView`），`scrollToFollowUpTurn` 改为委托它（DRY）。
4. **高亮**：复用现有 ring 样式（搜索命中用 `ring-2 ring-info`，见 assistant wrapper 1699–1709，已带 `transition-all duration-200`）。
   对目标 turn 施加 `ring-2 ring-primary ring-offset-2 ring-offset-background`，`setTimeout` ~2s 后清 state → 自然淡出。**无需新建动画 keyframe。**
5. **一次性语义**：`consume` 后 `pending` 即清空 → 刷新/返回不再触发；不改 URL、不碰导航栈。

边界：`assistantTurnIndexByMessageId` 查不到（消息/会话已删）→ effect 静默等待；
卡片仍可读 `contentSnapshot`（兜底，不让点击"死掉"）。

## 6. i18n

新增文案走现有 i18n：`sidebar.favorites`（收藏/Favorites）、收藏页标题、空状态、取消收藏 tooltip、
心形按钮 label（收藏/Favorite）。中英双语。

## 7. 错误处理与边界

- localStorage 读到坏 JSON → `try/catch` 回退空数组，不崩。
- 同一 messageId 重复 toggle → 由唯一键天然幂等。
- 流式回复无 `messageId` → 不显示心形。
- 原会话被删 → 列表项保留（快照可读），跳转静默失败。

## 8. 打补丁影响

**纯 renderer 改动** → `bun run --filter '@craft-agent/electron' build:renderer` + `bash patch-app.sh`。
不重建 `main.cjs`/preload/子进程，不动 `channels.ts`。与既有"快速迭代"工作流一致。

## 9. 测试

- Store 单测：`toggle` 幂等、`isFavorited`、坏 JSON 回退、跨实例订阅。
- 手动验收：①回复下心形点击高亮/取消 ②侧边栏入口位置在 Settings 上方 ③收藏页倒序与取消
  ④点击卡片跳回并滚动+高亮目标回复 ⑤2s 后高亮淡出 ⑥刷新不重复高亮 ⑦原会话删后兜底。

## 10. 受影响文件汇总

**新建（`apps/electron/src/renderer/components/favorites/`）：**
`favorites-core.ts`(+test)、`favorites-store.ts`、`favorites-highlight-store.ts`(+test)、`FavoritesPage.tsx`、`CLAUDE.md`(L2)

**改：**
- 心形：`packages/ui/src/components/chat/TurnCard.tsx`、`apps/electron/.../ChatDisplay.tsx`
- 导航器：`apps/electron/src/shared/types.ts`、`route-parser.ts`、`routes.ts`、`app-shell/AppShell.tsx`、`app-shell/MainContentPanel.tsx`
- 高亮：`ChatDisplay.tsx`（抽 `scrollToMessage` + 消费 effect + ring）
- i18n：`packages/shared/src/i18n/locales/en.json`、`zh-Hans.json`（扁平点分键）
- 文档：`craft-agents-oss/CLAUDE.md`（新增 Message Favorites 小节）

**不改（相较原 §5 query-param 方案）：** `NavigationContext.tsx`、会话态 `SessionsNavigationState`、`ChatPage.tsx`。
