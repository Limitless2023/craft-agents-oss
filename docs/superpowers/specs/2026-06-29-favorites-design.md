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
  sessionId: string      // 跳回原对话用
  workspaceId: string    // 会话 workspace 作用域
  sessionTitle: string   // 列表展示标题
  contentSnapshot: string// 收藏瞬间的回复 markdown：列表摘要 + 原对话已删的兜底
  createdAt: number      // 排序（倒序）
}
```

**唯一键 = `messageId`** → "是否已收藏" = store 里有没有这个 id；toggle = 有则删、无则增。
**消除所有去重/特殊分支**——这是本设计的"好品味"核心。

### 3.1 Store 模块（新建）

`apps/electron/src/renderer/components/favorites/favorites-store.ts`

```ts
// 单一真相源：localStorage + 内存快照 + 订阅
getSnapshot(): Favorite[]
isFavorited(messageId: string): boolean
toggle(fav: Favorite): void          // 有则 remove，无则 add
remove(messageId: string): void
subscribe(cb: () => void): () => void // 含跨窗口 storage 事件
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
- `onToggleFavorite` 在此构造完整 `Favorite` 负载：`messageId`(=`response.messageId`)、
  `sessionId`(=`session.id`)、`workspaceId`、`sessionTitle`、`contentSnapshot`(=`response.text`)、`createdAt`。

### 4.3 侧边栏入口 — `apps/electron/src/renderer/components/app-shell/AppShell.tsx`

- `LeftSidebar` links 数组中，Settings 项在 2625–2631、其上分隔线在 2623。**在分隔线正上方插入「收藏」LinkItem**：
  `{ id: "nav:favorites", title: t("sidebar.favorites"), icon: Heart, variant: isFavoritesNavigation(navState) ? "default" : "ghost", onClick: handleFavoritesClick }`。
- 新增 `handleFavoritesClick = useCallback(() => navigate(routes.view.favorites()), [navigate])`（仿 1872 行 `handleSettingsClick`），并在导航 useMemo（~2119）引用。

### 4.4 导航类型 — `apps/electron/src/shared/types.ts`

- 新增 `interface FavoritesNavigationState { navigator: 'favorites' }` 与守卫
  `isFavoritesNavigation(s): s is FavoritesNavigationState`，并入 `NavigationState` 联合（872–877）。
- `SessionsNavigationState` 增加可选 `highlightMessageId?: string`（见 §5）。

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
- **点击卡片 = 跳回原对话**：`navigate(routes.view.allSessions(sessionId) + '?highlight=' + messageId)`。
  用 `allSessions` 视图（含全部会话，必能命中）。
- 空状态：友好文案 + 提示「在任意回复下点心形即可收藏」。

## 5. 跳回原对话 + 定位高亮（方案 A 核心数据流）

复用既有基建，新增极少：

1. **携带参数**：收藏页跳转时拼 `?highlight=<messageId>`。`route-parser` 已解析 query 到 `parsed.params`（348–372）。
2. **透传**：`NavigationContext` 把 `params.highlight` 填入 `SessionsNavigationState.highlightMessageId`，
   `MainContentPanel` 作为 prop 传给 `ChatDisplay`。（现状：view 路由不读 query param → 本功能补这一段。）
3. **滚动**：`ChatDisplay` 用 `useEffect` 监听 `highlightMessageId`，调用**已存在**的
   `scrollToFollowUpTurn({ messageId })`（1410–1450，自带分页懒加载 + 居中 `scrollIntoView`）。
4. **高亮**：复用现有 ring 样式模式（搜索命中用 `ring-2 ring-info`，见 1623–1624）。对目标 turn 容器（1677）
   施加临时 `ring-2 ring-red-400 transition-all duration-500`，`setTimeout` ~2s 后清除 → 自然淡出。**无需新建动画 keyframe。**
5. **一次性语义**：应用高亮后，用 replace 导航去掉 `?highlight=` query，避免刷新/返回时重复触发（用 ref 守卫亦可）。

边界：`assistantTurnIndexByMessageId` 查不到（消息/会话已删）→ 静默不滚动；
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

**新建：** `favorites/favorites-store.ts`、`favorites/FavoritesPage.tsx`
**改：** `TurnCard.tsx`、`ChatDisplay.tsx`、`AppShell.tsx`、`types.ts`、`route-parser.ts`、`routes.ts`、`MainContentPanel.tsx`、i18n 文案文件
