# favorites/
> L2 | 父级: ../../CLAUDE.md

消息收藏功能（纯 renderer）。

成员清单
favorites-core.ts: 纯 reducers（parse/toggle/remove/isFavorited/sortByCreatedDesc）+ Favorite 类型；无 DOM，bun test 覆盖
favorites-core.test.ts: favorites-core 单测
favorites-store.ts: localStorage(`craft-favorites-v1`) 绑定 + useSyncExternalStore hooks（useFavorites/useIsFavorited）；单一真相源
favorites-highlight-store.ts: 临时跳转高亮信号（request/peek/consume/subscribe）；非持久化
favorites-highlight-store.test.ts: 高亮信号单测
FavoritesPage.tsx: 收藏页视图，列出/取消/点击跳回原对话（requestHighlight + navigate）

法则: 唯一键 messageId · localStorage 纯前端 · 跳转高亮走信号 store 不碰路由核心

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
