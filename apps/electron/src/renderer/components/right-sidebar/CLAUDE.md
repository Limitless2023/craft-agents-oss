# right-sidebar/
> L2 | 父级: apps/electron/src/renderer/components — 右侧栏（Info/Preview）面板族

## 成员清单

- **PreviewPanel.tsx**: `preview` 面板——.md 多标签阅读器；per-session 状态（sidebarDocsAtomFamily）、内容缓存、⌘R 刷新、diff 视图、标注（Preview Follow-up）、阅读模式（隐藏高亮）、880px 居中阅读列、右缘 OutlineRail 大纲、**编辑模式**（Pencil→textarea，⌘S 显式保存 + 磁盘冲突检测 + 脏草稿关 tab 守护，走 `file:write` IPC）
- **MarkdownSourceEditor.tsx**: CodeMirror 6 md 源码编辑器（语法高亮/⌘S/Esc/⌘B ⌘I/列表续行/软换行），主题全走 CSS 变量自动亮暗；非受控挂载按 filePath key 重建，变更经 onChange 上报草稿；被 PreviewPanel 编辑模式消费。**保真原则：源码编辑不碰未改动字节**（vs WYSIWYG 全文规范化）
- **OutlineRail.tsx**: Preview 大纲，双形态——悬浮态（收起层级小横条，悬停展开浮层）/ 固定态（钉住后为 220px 常驻大纲列，滚动区 flex 自动让位）；Pin/PinOff 在大纲头部切换，偏好持久化（preview-outline-pinned atom）；点击跳转 + scrollspy + 当前项自动滚入视野；数据从渲染后 DOM 扫 h1-h4（不解析 markdown），跳转/定位实时重查 DOM 不持久化引用
- **DocsPanel.tsx**: `docs`（Info）面板——当前会话文件树（复用 SessionFilesSection），一键全屏 markdown 预览
- **InfoPopover.tsx**: Preview 激活时点 Info 图标弹出的悬浮文件树——不切走 Preview 即可挑下一个 .md
- **SessionFilesSection.tsx**: 会话文件树核心区块，DocsPanel/InfoPopover 共用；.md 右键菜单 = Open（默认→Preview 看板）/ Open in fullscreen（显式全屏旁路）/ Show in file manager
- **WorkingDirectoryTree.tsx**: 工作目录树渲染；.md 右键菜单同上（Open / Open in fullscreen）
- **session-files-watch.ts**: 会话文件变更监听（驱动 Preview diff 的 previous 快照等）
- **__tests__/**: 本目录单测

## 依赖要点

Preview 宽度体系（无上限 + 收起阶梯 + 聊天保底 440）的单一真相在 `@/lib/right-sidebar-width.ts`，由 AppShell 消费——本目录不管宽度，只管内容渲染。

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
