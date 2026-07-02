# 收藏页 列表/卡片 视图切换 — 设计

> 日期: 2026-07-02 · 分支: `feat/favorites-view-mode` · 轻量执行（1 实现 + 1 审查）

## 目标
收藏页（FavoritesPage）支持 **列表 ⇄ 卡片(网格)** 视图切换；选择用 localStorage **记住**；**首次默认卡片**。

## 范围
仅收藏页视图层，**纯 renderer**。不改收藏数据模型、`favorites-store`、跳转/高亮逻辑。

## ① 视图模式状态 — 新建 `apps/electron/src/renderer/components/favorites/favorites-view-mode.ts`
带 GEB L3 头。
```ts
export type FavoritesViewMode = 'list' | 'card'
// 纯函数：null/非法 → 'card'（首次默认卡片），可 bun test
export function parseViewMode(raw: string | null): FavoritesViewMode
// localStorage 键 'craft-favorites-view-v1'；lazy window guard；useState + write-through 持久化
export function useFavoritesViewMode(): [FavoritesViewMode, (m: FavoritesViewMode) => void]
```
单实例足够（收藏页仅一个消费者）——不需 `useSyncExternalStore`/跨窗口同步（YAGNI）。

## ② FavoritesPage 改动 — `FavoritesPage.tsx`
- 页头右侧加**切换控件**：lucide `List` / `LayoutGrid` 两个图标按钮；当前模式高亮（`text-foreground` + `bg-muted`），另一个 ghost；各带 i18n `aria-label`。
- 抽出内部 `FavoriteCard`（DRY）：承载单条的 标题 + 摘要 + 时间 + 取消收藏 + 点击跳转（`openFavorite`），list 与 card 共用同一卡片内容，仅外层容器/尺寸不同。
- `mode === 'list'` → 现有单列 `<ul>`（行为不变）。
- `mode === 'card'` → 响应式网格 `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3`（窄窗自动降列）；卡片纵向、方正紧凑。
- 空状态、`openFavorite`（`requestHighlight` + `navigate`）、`removeFavorite` 全复用。
- 更新 L3 头 `[INPUT]` 增加 `./favorites-view-mode`、lucide `List`/`LayoutGrid`。

## ③ i18n — 全 7 语言（parity + sorted）
- `favorites.viewList` — en: "List view"；zh-Hans: "列表视图"
- `favorites.viewCard` — en: "Card view"；zh-Hans: "卡片视图"
（其余 5 语言本地化或英文兜底，键必须存在且字母序正确。）

## ④ 测试 — 新建 `favorites-view-mode.test.ts`（GEB L3 头）
`parseViewMode`：`null`→`'card'`、`'card'`→`'card'`、`'list'`→`'list'`、`'bogus'`→`'card'`。

## ⑤ 文档
- `favorites/CLAUDE.md`（L2）成员清单加 `favorites-view-mode.ts` + `.test.ts` 两行。
- 仓库 `CLAUDE.md` 收藏小节补一句"收藏页支持 列表/卡片 视图切换（localStorage 记忆，首次默认卡片）"。

## 打补丁
纯 renderer → `bun run --filter '@craft-agent/electron' build:renderer` + `bash patch-app.sh`。

## 明确不做（YAGNI）
不做每卡片缩略图、不做排序/筛选、不做跨窗口同步、不做拖拽排序。
