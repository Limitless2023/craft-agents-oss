# atoms/

> L2 | 父级: ../../CLAUDE.md

会话 UI 状态原子家族。jotai atoms + hooks，localStorage 持久化，跨组件共享。

成员清单

preview-annotations-core.ts: 标注核心逻辑（add/remove/update/markSent/collectPending），纯 reducers，由 preview-annotations.ts 消费

preview-annotations-core.test.ts: reducers 单测（6 cases）

preview-annotations.ts: 标注 jotai atomFamily + 3 hooks（usePreviewAnnotations/usePreviewPendingFollowUps/useMarkPreviewFollowUpsSent），localStorage `craft-preview-annotations:<sessionId>` 持久化

preview-reading-mode.ts: Preview 面板「阅读模式」全局开关（隐藏/显示高亮批注），普通 atom(false) + usePreviewReadingMode hook，非持久，与 preview-annotations 存储解耦

browser-pane.ts: 浏览器 overlay 状态

info-popover.ts: Info panel 展开/收起状态

messaging.ts: 即时消息（toast/notifications）原子

panel-stack.ts: 右侧面板栈（Docs/Info/Browser），URL 序列化

pinned-sessions.ts: 固定会话列表

sessions.ts: 当前会话状态（selectedSessionId 等）

sidebar-docs.ts: 侧边栏文档面板持久化

…其余原子见目录。

法则: 成员完整·localStorage 只用于会话级跨启动数据·jotai 管理所有 UI 状态·无直接 DOM 操作

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
