# CLAUDE.md — craft-agents-oss

## Project Overview

Fork of the official [Craft Agents](https://github.com/nickarora/craft-agents) Electron app. We maintain custom UI modifications on top of the upstream codebase.

## Custom Modifications

### Right Sidebar — Persistent Info Panel

Added a collapsible right sidebar that shows the current session's file tree (same as the Info popover), with one-click fullscreen markdown preview.

**Modified files:**
- `apps/electron/src/shared/types.ts` — added `{ type: 'docs' }` to `RightSidebarPanel`
- `apps/electron/src/shared/route-parser.ts` — URL serialization for `docs` panel
- `apps/electron/src/renderer/contexts/NavigationContext.tsx` — sidebar toggle logic
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — render sidebar + BookOpen button
- `apps/electron/src/renderer/components/app-shell/PanelSlot.tsx` — combine close button with sidebar button

**New files:**
- `apps/electron/src/renderer/components/app-shell/RightSidebar.tsx` — sidebar router
- `apps/electron/src/renderer/components/right-sidebar/DocsPanel.tsx` — Info panel using `SessionFilesSection`

### Finder File Association — Open .md with Craft Agents

Double-clicking `.md` files in Finder opens them in Craft Agents as a preview overlay.

**How it works:**
1. macOS `open-file` event → main process receives file path
2. Main broadcasts via `RPC_CHANNELS.system.OPEN_FILE` (`system:openFile`) to renderer
3. Renderer's `onExternalFileOpen` listener calls `handleOpenFile` → `classifyFile` → markdown preview overlay

**Modified files:**
- `packages/shared/src/protocol/channels.ts` — added `system.OPEN_FILE` channel
- `apps/electron/src/main/index.ts` — `app.on('open-file')` handler + `pendingOpenFile` for cold start
- `apps/electron/src/transport/channel-map.ts` — `onExternalFileOpen: listener(...)` mapping
- `apps/electron/src/shared/types.ts` — `onExternalFileOpen` type definition
- `apps/electron/src/renderer/App.tsx` — `useEffect` listener for external file open events

### Local File Path Links — Click to Open

Clicking local file path links in AI messages (e.g. `[report](/Users/foo/report.pdf)`) now works correctly instead of showing "Invalid URL" error.

**How it works:**
1. `link-target.ts` — paths starting with `/` or `~/` are identified as file links (with `decodeURIComponent` for `%20`/unicode)
2. `useLinkInterceptor.ts` — `handleOpenUrl` intercepts local paths (`/`, `~/`, `file://`) and routes to `handleOpenFile`
3. File routing: PDF → system default app, images → in-app preview, **markdown → Preview 看板（侧边栏 tab，2026-07-12 起默认）**, code/json/text → in-app overlay, folders → Finder
4. Markdown 全屏回落两条路径：Preview 看板 ⤢ 按钮（`handleOpenFile(path, { fullscreen: true })` → `MarkdownPreview.fullscreen` 标记）、无聚焦会话（冷启动 Finder 打开等，看板挂不上）。自动 dock 在 `App.tsx` `FilePreviewRenderer`（markdown 状态到达即 dock + 不渲染 overlay），复用既有 `handleDockToSidebar`

**Modified files:**
- `packages/ui/src/components/markdown/link-target.ts` — absolute path detection + URI decoding
- `apps/electron/src/renderer/hooks/useLinkInterceptor.ts` — local path routing in `handleOpenUrl`, PDF → external open

**Patching notes (Info.plist):**
- `patch-app.sh` adds `CFBundleDocumentTypes` with both `CFBundleTypeExtensions` and `LSItemContentTypes` (UTI: `net.daringfireball.markdown`, `public.plain-text`)
- Modifying `Info.plist` invalidates the Developer ID signature → script re-signs with ad-hoc (`codesign --force --deep --sign -`)
- Script re-registers with Launch Services (`lsregister -f`) so Finder picks up the file association

### Cmd+R — Rename Current Conversation

`Cmd+R` opens the rename dialog for the currently-active conversation, pre-filled with its title (Enter confirms, Esc cancels). Speeds up the frequent "rename the chat I just created" flow.

**How it works:**
1. New action `app.renameChat` (`defaultHotkey: 'mod+r'`, category General) in the centralized keyboard registry.
2. The registry's capture-phase `keydown` listener `preventDefault()`s the match — in dev this suppresses the menu's `CmdOrCtrl+R` reload accelerator (`main/menu.ts`); `Cmd+Shift+R` force-reload is unaffected (matcher checks the Shift modifier). In packaged builds `Cmd+R` was unbound, so zero conflict.
3. A single headless `RenameSessionShortcut` component (mounted once by `App`, inside `ActionRegistryProvider`) owns the dialog and renames the **focused conversation** — `focusedSessionIdAtom` (parsed from the focused panel's route) `?? sessionSelection.selected`, the same "current session" that `AppShell`/`ChatPage` use. Using `selected` alone was the first-Cmd+R bug: the navigator's list selection lags/diverges from the on-screen chat when you create or switch conversations. Target id + original name are snapshotted at open (a background focus change can't retarget an in-flight rename); an unchanged name is skipped. One registration avoids the multi-panel "first-mounted ChatPage wins" race that inlining into `ChatPage` would cause. Reuses `handleRenameSession` + the controlled `RenameDialog` (which now select-all's the title on open).

**New files:**
- `apps/electron/src/renderer/components/app-shell/RenameSessionShortcut.tsx` — headless Cmd+R handler + rename dialog

**Modified files:**
- `apps/electron/src/renderer/actions/definitions.ts` — added `app.renameChat` action (`mod+r`)
- `apps/electron/src/renderer/App.tsx` — import + single-instance render of `RenameSessionShortcut`
- `apps/electron/src/renderer/components/KeyboardShortcutsDialog.tsx` — removed the stale, never-implemented bare-`R` "Rename session" entry (the real `⌘R` now auto-appears in the General section from the registry)

**Design spec:** `docs/superpowers/specs/2026-07-02-cmd-r-rename-session-design.md`

### Message Favorites — Heart button + Favorites sidebar page

Heart "favorite" button under every AI reply + a "Favorites" sidebar entry (above Settings) that lists favorites and jumps back to the original message with a brief highlight. Pure-renderer, localStorage-backed.

**How it works:**
1. Heart in each reply footer toggles favorite state (unique key = `messageId`), persisted in localStorage (`craft-favorites-v1`).
2. "Favorites" sidebar entry → a new `favorites` navigator → `FavoritesPage` lists favorites (newest first, unfavorite inline).
3. Clicking a favorite sets an ephemeral highlight-request signal then navigates to the session; `ChatDisplay` consumes it, scrolls to + flashes the message (~2s `ring-primary`). Chosen over a `?highlight=` route param because compound routes don't carry query params — avoids touching route-parser/NavigationContext core.
4. The Favorites page supports a **list ⇄ card (grid) view toggle** (`favorites-view-mode.ts`), remembered in localStorage (`craft-favorites-view-v1`), first-time default = card.

**New files** (`apps/electron/src/renderer/components/favorites/`): `favorites-core.ts`(+test), `favorites-store.ts`, `favorites-highlight-store.ts`(+test), `FavoritesPage.tsx`, `CLAUDE.md` (L2)

**Modified files:**
- `packages/ui/src/components/chat/TurnCard.tsx` — heart button in the reply footer (+ `isFavorited`/`onToggleFavorite` props)
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` — heart wiring + scroll-to/flash highlight consumer
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — Favorites sidebar entry above Settings
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` — renders FavoritesPage for the favorites navigator
- `apps/electron/src/shared/{types.ts,routes.ts,route-parser.ts}` + `renderer/lib/nav-helpers.ts` — the `favorites` navigator
- `packages/shared/src/i18n/locales/*.json` — `sidebar.favorites`, `favorites.*`, `common.favorite` (all 7 locales)

**Patching:** renderer-only → `bun run --filter '@craft-agent/electron' build:renderer` + `bash patch-app.sh` (no main/preload/subprocess rebuild).

### Preview Follow-up

Select text in the right-side Preview panel (`.md` files) → attach a note (persistent highlight) → it joins the chat composer's pending follow-ups and is sent with the next message, quote prefixed with the file name. Renderer-only: annotations persist in a jotai store (`craft-preview-annotations:<sessionId>`, keyed by the file path used as a pseudo-messageId); reuses `AnnotatableMarkdownDocument` + `formatFollowUpSection`. **锚点自愈（2026-07-25 修复漂移债）**：解析器（`markdown/annotation-resolver.ts`，Preview 文件标注与聊天消息标注共用）此前"偏移在界即信"——文件被改后偏移碰巧在界内会**错位高亮**。现在偏移必须过引文核对（`fullText.slice(start,end) === quote.exact`，创建时本就存了引文+前后 24 字上下文）才可信，对不上走既有 findQuoteRange 重锚（精确→前后文消歧→空白归一化）；彻底找不到 → `AnnotatableMarkdownDocument` 顶部**琥珀色失效提示条**（`OrphanedAnnotationsNotice`，含一键清除；渲染在 contentLayer 外防污染 canonical text 坐标系；block 类标注与 ephemeral 预览排除在失效判定外）。无引文的历史标注保持旧行为。刻意不回写自愈结果——原始引文是标注意图的真相源，每次渲染按它重定位零成本更安全。**回归修正（同日）**：创建端引文原用 `range.toString()`，与 canonical 坐标系在跨节点选择（KaTeX 隐藏层/块边界）下文本不一致 → 新建选择立刻被引文核对否掉 → 错误重锚（"一选择把前面也选上"）。修法：创建时引文改存 `fullText.slice(start,end)`（两坐标系同源，TurnCard 与 AnnotatableMarkdownDocument 两处），解析器核对加空白归一化容差兼容历史 toString 引文。测试：`__tests__/annotation-resolver.test.ts` 上游 5 例 + 新增 3 例（漂移重锚/漂移无引文必失效/历史兼容），i18n +3 键 ×7（`annotations.orphaned*`）。

### Preview Reading Mode — Hide/Show Highlights

An Eye/EyeOff toggle in the right-side Preview panel header hides/shows **all** highlight annotations for the whole panel (global, non-destructive, not persisted — resets to shown on restart). Reuses the panel's existing plain-`<Markdown>` render branch when on; decoupled from the follow-up send pipeline (hiding a noted highlight does not stop it sending — hide ≠ cancel). The toggle only appears when the active document has ≥1 highlight or the mode is already on.

**New files:**
- `apps/electron/src/renderer/atoms/preview-reading-mode.ts` — global `atom(false)` + `usePreviewReadingMode` hook

**Modified files:**
- `apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx` — header Eye/EyeOff button + `!readingMode` render gate

**Design/plan:** `docs/superpowers/specs/2026-07-08-preview-reading-mode-design.md`, `docs/superpowers/plans/2026-07-08-preview-reading-mode.md`

**Patching:** renderer-only → `bun run --filter '@craft-agent/electron' build:renderer` + `bash patch-app.sh`.

### Preview Outline — 右缘悬浮大纲（TOC）

Preview 面板的大纲导航，**双形态**：悬浮态 = 右缘一列层级小横条（H1 最长，scrollspy 加深当前章节），悬停展开为文字大纲浮层；固定态 = 大纲头部 Pin 钉住后变 220px **常驻大纲列**（流内 flex 兄弟，滚动区自动让位，正文照常居中），对照阅读用，偏好持久化（`atoms/preview-outline-pinned.ts`，localStorage `craft-preview-outline-pinned-v1`）。点击平滑跳转、当前项自动滚入视野。**数据从渲染后 DOM 扫 h1-h4**（地图从地形生成，不解析 markdown——setext/代码块歧义不存在，标注/阅读两条渲染分支天然兼容）；跳转与 scrollspy **实时重查 DOM 不持久化元素引用**（永不过期）。标题 ≥2 才显示；diff/加载中/空状态隐藏。新文件 `right-sidebar/OutlineRail.tsx`（hook + 共享列表 + 双形态渲染，自包含），`PreviewPanel.tsx` 滚动区包一层 relative+flex 挂载。renderer-only → `build:renderer` + `bash patch-app.sh`。

### Preview Edit Mode — .md 面板内编辑（显式保存）

Preview 头部 Pencil 进入编辑模式：同一条 880px 阅读列里变成 **CodeMirror 6 md 源码编辑器**（`MarkdownSourceEditor.tsx`：语法高亮、⌘B/⌘I 加粗斜体、列表自动续行、软换行；主题走 CSS 变量自动亮暗；依赖 `@codemirror/*` 6 包 + `@lezer/highlight`），**Save（⌘S）显式落盘 / Cancel（Esc）放弃**，草稿跨 tab 切换保留（内存 Map，不落盘）。刻意选源码编辑而非 WYSIWYG：往返保真——不碰用户未改动的字节，diff/标注/agent 上下文零污染。**保存冲突检测**：写盘前重读磁盘，若 ≠ 进入编辑时的基线快照（agent 并发改过）→ confirm 确认覆盖，绝不静默；保存后缓存视作一次外部编辑（previous=保存前盘上内容 → diff 可回看本次改动）。脏草稿在关 tab（X/中键/⌘W）和 Cancel 时都有 confirm 守护。编辑中隐藏大纲/标注/diff/阅读模式按钮。

**⚠️ 非 renderer-only**：新增 `file:write` IPC——`packages/shared/protocol/channels.ts`（`file.WRITE`）+ `routing.ts`（REMOTE_ELIGIBLE）+ `packages/server-core/handlers/rpc/files.ts`（handler，与 READ 同一套 `validateFilePath` workspace 校验）+ `transport/channel-map.ts` + `shared/types.ts`。patch 时须 `build:main` + `build:preload`（+renderer）再 `patch-app.sh`。通道快照测试 `shared/__tests__/ipc-channels.test.ts` 加通道必须同步更新（2026-07-12 顺带补了 3 个历史漏项：fs:gitStatus/fs:listFiles/system:openFile）。

### Preview Width Rule — 聊天保底 + 左侧列收起阶梯

Preview 面板宽度**没有绝对上限**（2026-07-12 删除了 `PREVIEW_MAX_WIDTH = 1000` 魔数）——唯一约束是聊天区保底 `MIN_MAIN_CONTENT_WIDTH = 440`，**必须等于** `panel-constants` 的 `PANEL_MIN_WIDTH`（PanelSlot 的 flex minWidth；两数不等则 reserve 按小数算、布局按大数拒缩 → flex 行溢出，测试有 lockstep 守护）。Info/docs 类面板仍有 `OTHER_PANEL_MAX_WIDTH = 480` 类型上限，下限统一 `180`。Preview 手柄命中区：圆角裁剪独立成视觉层，拖拽手柄留在 `overflow-hidden` 外——否则负 margin 伸进面板缝隙的那半命中区被裁掉，可视缝隙成死区（"拖动条难触发"的根源）。

拖宽 Preview 时左侧列按**阶梯逐级让位**（`autoCollapseLevel`：0=全显示 → 1=收左栏 → 2=连会话列表也收），拖回去逐级还原。阶梯是**纯派生**（无 state/effect/latch）：阈值按"偏好布局"计算，不受实际收起状态反馈，无震荡。关键设计（2026-07-12 修复的死锁）：**拖拽 clamp 对 Preview 用地板占用（仅 inset+gap=12），不用实际占用**——否则意图宽度被掐死在阈值整数上而触发条件是严格大于，阶梯永远跨不过去。显示宽度仍按实际布局 clamp，聊天永远 ≥320。Cmd+B 在收起状态下显式召回左栏 = 左栏赢：Preview 意图被压回放得下的宽度（持久化）。单一真相：`apps/electron/src/renderer/lib/right-sidebar-width.ts`（+test），消费方 `AppShell.tsx`（阶梯派生 + 双 clamp + navigatorWidth/手柄接线）。面板内正文是**居中阅读列**（`PreviewPanel.tsx` 内容 wrapper `max-w-[928px] mx-auto`，正文 880px 与全屏 overlay 严格同宽）——面板拖宽时多余空间变左右留白，窄时 max-w 不生效。手柄命中区全局 `PANEL_SASH_HIT_WIDTH = 20`（每侧 10px，absolute 实现不占布局；再宽会压聊天区滚动条）。**`@container/shell` 必须与 `shellRef` 同元素**（AppShell 外层布局 div）：index.css 的移动端触屏放大（`@container shell ≤768px`，panel-header-btn 44px 等）与 JS `isAutoCompact` 要量同一块地形——曾挂在 PanelStackContainer 面板条上，Preview 拖宽把聊天条压到 <768px 即误触发手机模式（头部图标突然变大）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

### Kanban Batch Select — 看板批量选择 + "已取消并归档"清理

看板（Board 视图）批量操作：⌘/Ctrl 点击切换选中、Shift 区间选（跨列，平铺视觉序）、列头 ListChecks 菜单"全选本列 / 按状态选择（带计数）"；任一卡片选中即进入选择模式（普通点击变切换、卡片右上角出勾选圆点、Esc 退出），底部浮出操作条：改状态 / 归档 / **已取消并归档**（清理组合）/ 清除。

关键设计：
1. **列 ≠ 状态**（上游 6 状态折叠进 3 列，ToDo 列混装 todo+backlog）→ 列头菜单必须提供按状态拆选；列头菜单**只负责选**，动作统一走操作条（单一心智模型）。
2. **批量改状态同步修正落位**：拖动过的卡片带持久化 `kanbanColumn`，只改状态会赖在原列——`resolveColumnForStatus`（显式 drop-status 列优先 → 内建映射 → 自定义列不动）后补发 `setKanbanColumn`。
3. **清理组合** = `setSessionStatus: cancelled` + `setKanbanColumn: null`（清残留，日后 unarchive 按状态正确落列）+ `archive`（看板消失、列表可找回）。逐 id 循环现成 `sessionCommand`，无新 IPC。
4. 选择区间序与渲染序共用 `bucketTasksByColumn`（抽进 `status-column.ts`），两序永不漂移；选中任务从看板消失时 effect 自动剪除。

**New files:** `kanban/BoardSelectionBar.tsx`（浮动操作条，复用 `SessionStatusMenu`）

**Modified files:** `kanban/{KanbanBoardContainer,KanbanBoard,KanbanColumn,TaskTile}.tsx`（选择态接线 + `ColumnSelectMenu` 列头菜单）、`kanban/status-column.ts`（`bucketTasksByColumn`）、`ui/session-status-menu.tsx`（export `DEFAULT_STATUS_IDS`）、7× i18n（`kanban.select.*` 13 键，锚点插入保持局部字典序）。选择基建复用 `hooks/useMultiSelect.ts` 纯函数（SessionList 同款）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

### Inline Interactive Visualization — 对话内交互可视化（```viz fence）

Agent 回答里内嵌**可交互 HTML 组件**（滑块/按钮/实时联动），沙箱渲染、主题实时跟随、高度自适应。按 spec（`~/.craft-agent/workspaces/my-workspace/sessions/260717-still-swamp/spec-对话内交互可视化.md`）裁剪实现，参考 KouriVar/Craft-Agents `my-changes` 分支（同源 fork，运行时近乎直接移植）。

对 spec 的三处裁剪（评估定稿）：
1. **fence 语法替代 `::inline-vis` 指令**：Agent 写文件到 `<cwd>/.craft/visualizations/<title>.html`，回答中输出 ```viz fence（体=绝对路径一行）。复用 `Markdown.tsx` 现成 fence 路由（与 html-preview 同款），流式/回放天然一致（spec G7 最大坑直接消失），围栏内示例不渲染是 markdown 语义白送的。
2. **复用 `file:read` IPC**：主进程 `validateFilePath` 已有允许根目录 + realpath 符号链接还原（S4）+ 敏感文件黑名单；2MB 上限（S5）与错误分类在前端补。**零新 IPC → renderer-only**。
3. **技能装 `~/.agents/skills/visualize/`**（global 级=最低优先级，workspace/project 同名自然覆盖）：技能加载器无"内置 resources"概念，不新增机制。源文件在仓内 `resources/skills/visualize/`（SKILL.md 从 Codex 原版改写：fence 语法、**无 CDN 全内联**、无 lucide/tooltip 运行时、Maps 断网约束、删 Standalone/Sites），改后 `cp -r resources/skills/visualize ~/.agents/skills/` 重装。

安全红线（收紧于参考实现）：iframe `sandbox="allow-scripts"`（**绝不**加 allow-same-origin——与 MarkdownHtmlBlock 恰相反，后者 same-origin 无脚本，**两组件刻意分离不合并**）；CSP 无任何网络源（比 spec 更严：删掉 CDN 白名单，堵"经 CDN URL 查询串外带"通道）；postMessage 双向校验 source 标识（S7）。红线有测试静态守护（`__tests__/viz-host.test.ts`，12 用例）。

**G8 追问回传（2026-07-23 落地）**：组件调 `window.craft/openai.sendFollowUpMessage({prompt})` → 桥转发（`use-viz-bridge.ts` 加 `onFollowUpRequest` 回调 + `respondFollowUp` 回执；回调经 ref 消费防 listener 重挂）→ `MarkdownVizBlock` 渲染**内嵌确认卡**（组件下方展示完整 prompt + 取消/发送，S6：显式点发送才回执 ok；不用弹窗——packages/ui 无 Dialog 原语且内嵌不打断阅读流、多面板归属明确）→ 确认后走 `ChatDisplay.handleVizFollowUp` = 本会话 `onSendMessage`（与手打消息同一管线）。透传链：ChatDisplay → TurnCard（两接口两渲染点）→ Markdown `onVizFollowUp` prop → viz 块。**回归修正（2026-07-27，"发消息上一条闪烁"）**：`onVizFollowUp` 初版进了 Markdown 组件表 memo 依赖，而它身份随 `onSendMessage` prop 变——发消息即组件表重建 → 所有 fence 块（文档预览/viz/mermaid）整树重挂闪"加载中"。修法与 `firstMermaidCodeRef` 同族：回调经 ref 传递（Markdown 内 `onVizFollowUpRef` + ChatDisplay 内 `onSendMessageRef`）、踢出 memo 依赖。**教训：往 createComponents 加任何回调参数，一律走 ref，不进 memo 依赖。****仅聊天渲染链支持**：Preview 面板/全屏 overlay/画廊/standalone 导出无会话上下文，桥自动回执 unsupported（组件须在无追问下仍可用，SKILL.md "Follow-up actions" 章节已教：至多一个动作按钮、prompt 烘焙当前控件值、禁止自动调用）。i18n +1 键 `viz.followUpExplain` ×7。

**二期扩展（2026-07-17 当天）——文件入口 + 导出**：viz 文件成为"可打开的资产"：
- **全屏活组件 overlay**：`classifyFile` 加了唯一一条**按路径**（非扩展名）的分类规则——`.craft/visualizations/*.html` → `'viz'` 类型 → 链接拦截器路由到 `VizPreviewOverlay`（PreviewOverlay 外壳 + 同一套 `buildVizDocument`/桥）。普通 .html 仍进代码查看器。消息内 viz 块 hover ⤢ → `onFileClick` 走同一管线。
- **导出独立 HTML**：overlay 头部 Download 按钮 → `buildStandaloneVizDocument`（主题按导出时快照**烘焙**、无桥脚本、同一份断网 CSP）写 `<原名>-standalone.html` 到源文件旁（复用我们的 `file:write` IPC）→ Finder 自动显示。浏览器直接可开、可分享。
- **文件树白名单**：会话文件树的点目录过滤对 `.craft` 开例外（`server-core/files.ts`，**main 进程改动**）。
- 桥逻辑抽成 `use-viz-bridge.ts` 供消息块与 overlay 共用（主题推送/resize 接收/S7 校验/follow-up 回执单一实现）。
- **主题语义翻译**（2026-07-17 bug 修复）：Craft 宿主品牌色叫 `--accent`（无 `--primary`），Codex css 主色叫 `--primary`（`--viz-series-*` 派生源）——`withVizSemanticAliases`（viz-host.ts）在**快照层**做 accent→primary 别名，三个注入点自动继承；不改则图表系列色永远默认蓝。

**New files:** `packages/ui/src/components/markdown/{viz-host.ts, viz-assets.ts(生成物，源=resources/skills/visualize/assets/visualize.css), MarkdownVizBlock.tsx, use-viz-bridge.ts, __tests__/viz-host.test.ts}`、`packages/ui/src/components/overlay/VizPreviewOverlay.tsx`、`resources/skills/visualize/{SKILL.md, assets/visualize.css}`

**Modified files:** `packages/ui/src/components/markdown/Markdown.tsx`（'viz' 入 DisablablePreviewBlock + minimal/full 两处路由）、`packages/ui/src/lib/file-classification.ts`（`isVizFilePath` 路径规则 + 'viz' 类型）、`packages/ui/src/{index.ts, components/overlay/index.ts}`（导出）、`apps/electron/src/renderer/hooks/useLinkInterceptor.ts`（VizPreview 状态 + 路由）、`apps/electron/src/renderer/App.tsx`（case 'viz' 渲染 + read/write/reveal 接线）、`packages/server-core/src/handlers/rpc/files.ts`（`.craft` 白名单）、7× i18n（`viz.*` 9 键）。

**Patching:** ⚠ 自二期起**非 renderer-only**（files.ts 进 main.cjs）→ `build:renderer` + `build:main` + `build:preload` + `bash patch-app.sh`；技能变更另需重拷 `~/.agents/skills/visualize/`。

### Viz Gallery — 可视化资产画廊（侧边栏 · 活缩略图网格）

侧边栏 "可视化" 入口（Favorites 下方）→ 全幅画廊页：扫描 workspace 根 + 各会话 workingDirectory 下的 `.craft/visualizations/*.html`（排除 `-standalone` 导出副本），活缩略图网格（半尺寸沙箱 iframe，pointer-events 关、不接主题桥、上限 60），点卡片经 `AppShellContext.onOpenFile` → VizPreviewOverlay 全屏。扫描用现成 `fs:listFiles`（零新 IPC）。导航注册是 Favorites 的孪生（`viz-gallery` navigator，8 处：types/routes/route-parser/nav-helpers/AppShell×3/MainContentPanel）。

**New files:** `renderer/components/viz-gallery/{VizGalleryPage.tsx, viz-gallery-core.ts(+test), CLAUDE.md(L2)}`；`packages/ui/index.ts` 补导出 viz-host 原语（buildVizDocument/readVizTheme/VIZ_IFRAME_SANDBOX/VIZ_MAX_FILE_BYTES）+ `isVizFilePath`。

### Session Export — 会话导出为 Markdown（含活组件）

聊天页标题下拉菜单 "导出为 Markdown"：只序列化用户提问 + 助手最终回复正文（工具步骤折叠成一行计数；刻意不用上游 `formatTurnAsMarkdown`——那是带 JSON dump 的调试视图），写 `<cwd>/.craft/exports/<标题>-<时间戳>.md` 后**立即 dock 进 Preview 面板**。关键组合价值：文档里的 viz fence 在 Preview 渲染时**仍是活的交互组件**（同一 Markdown 管线）。仅聊天页头部菜单显示此项（列表菜单不加载消息，`onExportMarkdown` 可选 prop 缺省即隐藏）。**`file:write` 顺带补了 mkdir -p 父目录**（validateFilePath 校验后，信任边界内；main 进程改动）。

**New files:** `renderer/lib/session-markdown.ts`（buildSessionMarkdown / sessionExportFileName）

**Modified files:** `SessionMenu.tsx`（onExportMarkdown 可选项）、`pages/ChatPage.tsx`（handler + dock 接线）、`server-core/handlers/rpc/files.ts`（WRITE mkdir）。

### Session Cost — 会话费用显性化

模型下拉的 context 页脚（token 计数旁）追加 `· $x.xx`（≥$0.1 两位小数，否则三位）。数据链：`session.tokenUsage.costUsd`（一直存在，此前仅 Kanban 卡片脚注消费）→ ChatDisplay `contextStatus` 透传 → FreeFormInput 渲染。

**Modified files:** `ChatDisplay.tsx`（contextStatus.costUsd 透传）、`input/FreeFormInput.tsx`（类型 + 渲染）。

**Patching（三 feature 合并）:** files.ts 动 main → `build:renderer` + `build:main` + `build:preload` + `bash patch-app.sh`。i18n 新增 14 键 ×7（sidebar.vizGallery / vizGallery.* / sessionMenu.export* / export.*）。

### User Message Copy — 用户消息一键复制

用户消息气泡**下方右对齐**的悬停复制按钮（微信/ChatGPT 惯例：视线和手停在右下；初版放过左缘，被用户否掉——工程省事不敌使用直觉）。hover 整条消息显形（`group/user-msg` 在外层容器，`-mt-2` 贴近气泡）；复制**可见正文** `displayContent`（已剥离 edit_request 隐藏段，不带内部标记）；Copy→Check 2s 视觉与助手回复页脚同款；空正文（纯附件消息）不显示按钮。i18n 复用现成 `common.copy/copied`，零新键。

**Modified files:** `packages/ui/src/components/chat/UserMessageBubble.tsx`（唯一改动）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

### Prompt Rail — 会话指令导航（左缘会话大纲）

聊天区左缘的"我在这个会话发过的指令"导航，是 Preview `OutlineRail` 的**镜像孪生**（右缘扫文档标题 / 左缘列会话指令），双形态一致：悬浮态 = 左缘一列小横条（scrollspy 加深当前条）+ 悬停向右展开 260px 浮层；固定态 = Pin 后变 200px 常驻左列（流内 flex 兄弟，滚动区自动让位），偏好持久化（`atoms/prompt-rail-pinned.ts`，localStorage `craft-prompt-rail-pinned-v1`，与 Preview 大纲的 pin 分开存）。**⌘↑ / ⌘↓ 跳上/下一条指令**（`chat.prevPrompt`/`chat.nextPrompt`，`when: '!inputFocus'` 让输入框内保持原生"移到首/末"语义，与既有 `mod+left/right` 同一范式）。点击/快捷键跳转后目标消息亮 2s ring（复用收藏跳转的高亮机制，本次把它从"仅助手消息"扩到用户消息）。

关键设计（与 OutlineRail 的本质差异）：
1. **数据源是消息数组不是 DOM**——聊天是反向分页的（`TURNS_PER_PAGE=20` 只挂载尾部），扫 DOM 会漏掉全部历史指令；因此 scrollspy 对"未挂载节点"按**已滚过**处理（分页只可能缺前面的）。
2. **跳转白捡**：`ChatDisplay.scrollToMessage` 本就内置"撑开分页 → 双 rAF → 80ms 兜底重试"，只需把它的索引从"仅助手消息"扩成 user+assistant 合并（`assistantTurnIndexByMessageId` 现收两类）。
3. **单一 scrollspy**：⌘↑↓ 的游标与 rail 高亮共用一份定位（rail 经 `onActiveChange` 上报，ChatDisplay 存 ref），避免两套定位漂移；跳转后 600ms 锁忽略上报，否则 smooth 滚动途中的中间态会让连按原地打转。
4. 标题提取 `promptLabel`：剥应用注入的内部标记（edit_request/context 连内容整段剥）→ 其余标签只去尖括号保留文字（用户可能在讲代码）→ 取首个有内容行 → 压空白截断 64 字。
5. 窄面板（`compactMode`）不渲染——没有左缘空间可让。

**New files:** `app-shell/{PromptRail.tsx, prompt-rail-core.ts, __tests__/prompt-rail-core.test.ts}`、`atoms/prompt-rail-pinned.ts`

**Modified files:** `ChatDisplay.tsx`（合并索引 + promptItems 派生 + 跳转/游标/快捷键 handle + 用户消息高亮 + 布局 flex 挂载）、`actions/definitions.ts`（两个 action）、`AppShell.tsx`（useAction 接线）、7× i18n（`promptRail.*` 3 键）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

### Expand Long Responses — 长回复完全展开（设置开关）

上游的助手回复卡片写死 `MAX_HEIGHT = 540`（`TurnCard.tsx`），超出即在卡片内自成滚动区——大屏（外接显示器）上垂直空间充裕时反而割裂阅读（表格表头被卡在卡片外）。新增 **Settings → Appearance →「展开长回复」** 开关：开启后回复不限高、不内滚，由页面主滚动条承载；**默认关 = 保持上游行为**（窄屏/多面板下卡片限高仍有价值）。展开时**一并取消暗色模式的首尾渐隐遮罩**（无溢出还渐隐只会让首尾文字平白变淡）。

偏好走 `atomWithStorage`（`atoms/chat-response-height.ts`，key `craft-expand-long-responses`），与上游 background-finished chip 开关同款：renderer-only、多窗口共享、不走 RPC/磁盘配置。跨包传递：ChatDisplay 读 atom → TurnCard `expandLongResponses` prop → 三处 ResponseCard 渲染点（两处正文 + plan）；`packages/ui` 侧默认 `false`，不影响其他调用方（webui 等）。

**New files:** `atoms/chat-response-height.ts`
**Modified files:** `packages/ui/chat/TurnCard.tsx`（两接口 + 两处限高样式 + 三处透传）、`ChatDisplay.tsx`（读 atom + 透传）、`pages/settings/AppearanceSettingsPage.tsx`（开关）、7× i18n（2 键）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

### Auto-expand Running Turns — 运行时展开工具步骤（+ 运行计时器）

**Settings → Appearance →「运行时展开步骤」**：回合运行中自动展开工具步骤列表，完成瞬间自动收回；折叠行右侧显示**实时计时**（Codex 同款，长任务可见地 tick 而非看起来卡住），完成即消失。默认关 = 保持上游（始终折叠）。

**设计依据（联网查证结论）**：Claude Code 并没有"运行展开/完成收起"的动态行为——它是**静态**的（工具行常驻可见、只截断输出到 3–4 行 + `+N lines`，`Ctrl+O` 是会话级 verbose 开关）。用户"跑时能看、跑完干净"的观感其实来自**终端流式滚动的物理特性**：日志从未被收起，只是被新内容顶出视野。卡片式 GUI 没有这个红利，于是用显式的"运行展开→完成收起"模拟同一种焦点管理。社区在 Claude Code 上同时存在两个反方向诉求（[#25776 要默认展开](https://github.com/anthropics/claude-code/issues/25776) / [#40428 要 compactToolOutput 默认折叠](https://github.com/anthropics/claude-code/issues/40428)），故做成设置项而非改死默认值。

**关键状态机（自动 vs 手动的优先级）**：`autoExpanded = 设置开启 && !isComplete && !hasUserToggled.current`，最终 `isExpanded = autoExpanded || persistedExpanded`。
1. 自动展开是**临时视觉覆盖，不写入持久化状态**（`useTurnCardExpansion` 的 localStorage 不被污染，否则用户下次打开看到的"展开"其实是自动行为的残留）；
2. 完成瞬间 `isComplete` 翻转 → 覆盖自然失效 → 回落到持久状态（默认折叠），这就是"跑完自动收"；
3. 用户本轮一旦手动点过（`hasUserToggled`，`toggleExpanded` 已有此 ref），该轮永久听用户的——绝不出现"我点开它自己合上"。

### Tool Output Preview — 工具步骤输出预览（Claude Code 同款 `⎿`）

**Settings → Appearance →「显示工具输出预览」**：展开的每条工具步骤下方，用 `⎿` + 等宽字体显示输出**前 2 行**（每行截断 120 字），多余的报 `+N 行`；出错时优先显示错误原文（那才是此刻要看的）。不点进详情就知道每步结果。默认关。

与「运行时展开步骤」刻意分成两个开关：展开是"看得见有哪些步骤"，输出预览是"不点进去就知道结果"——两个独立的信息密度旋钮，长会话里未必都想要。截断逻辑是纯函数 `tool-output-preview.ts`（先滤空行再取样——工具输出常以空行开头，占着预览额度却什么都不说），**只做取头部+截断，不按工具类型做语义解析**（输出形态千差万别，花哨解析必然在下一个工具上失效）。

布局改造：`ActivityRow` 从单行变成"行 + 可选预览"的纵向容器（`flex-1 min-w-0` 从行上移到容器，否则宽度算不对），预览缩进 22px 与工具名对齐。开关沿既有 `displayMode` 的传递路径下发（TurnCard → ActivityGroupRow → ActivityRow），memo 比较同步加了 `showToolOutput`（否则拨开关后已渲染的行不更新）。

**New files:** `atoms/chat-activity-expansion.ts`（两个 atom）、`packages/ui/chat/elapsed.ts`(+test)、`packages/ui/chat/tool-output-preview.ts`(+test)
**Modified files:** `packages/ui/chat/TurnCard.tsx`（两 prop + 状态机 + RunningElapsed 组件 + 折叠行渲染）、`ChatDisplay.tsx`（读 atom + 透传 `turn.timestamp`）、`AppearanceSettingsPage.tsx`（开关）、7× i18n（2 键）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

### Preview Panel for Code — 代码文件进 Preview 面板

Preview 面板不再是 `.md` 专属：**代码/文本/JSON 文件点开后默认 dock 进右侧面板**（语法高亮只读视图），与聊天并排对照——agent 写的脚本可以钉成常驻参照物，一边让它改一边看改成什么样（面板本来就有 2s 自动刷新和 diff）。

改造成本远低于预期，因为**面板的地基本来就与扩展名无关**：多 tab、内容缓存、刷新、diff、滚动位置记忆、拖拽排序、⌘R/⌘W 全部零改动；`sidebar-docs` 的 tab 结构只存 filePath，`openSidebarDocTab` 从来就没有 `.md` 校验。真正的关卡只有一处——`App.tsx` 的 `autoDock` 判定写死 `state.type === 'markdown'`。

关键改动：
1. **拆关卡**：`autoDock` 放宽到 markdown/code/text/json 四类（`DOCKABLE_TYPES`），三个 overlay 分支各加 `if (autoDock) return null` 防闪一帧全屏；`useLinkInterceptor` 给 Code/Text/JSON 三个 preview 变体补 `fullscreen?` 字段（此前只有 markdown 有，否则 ⤢ 旁路对代码失效会造成循环 dock）。
2. **渲染分叉**：`PreviewPanel` 以 `isMarkdownTab`（唯一真相）分流——markdown 走既有文档渲染（标注/大纲/阅读模式都挂在这支），**其余走 `ShikiCodeViewer`**。⚠ **代码绝不能走 `AnnotatableMarkdownDocument`**：源码会被 markdown 解析器吃掉（`#` 变标题、缩进变代码块）。标注对代码一并关闭——它锚定在渲染后文本坐标系上，对 shiki 切分过的 span 不可靠。
3. **md 专属 UI 闸门**：大纲（代码扫不出 h1-h4，必然为空）、阅读模式（无标注自然隐藏）、**编辑按钮**（编辑器写死 markdown 高亮，用它编辑 .py 会看到错误着色——待接入 `@codemirror/language-data` 后开放）。**diff 保留**，对代码比对 md 更有价值。
4. 拖入过滤与文件树"Open in fullscreen"菜单项同步放宽到"面板能渲染的文本类文件"（排除图片/PDF）。

**Modified files:** `right-sidebar/PreviewPanel.tsx`、`App.tsx`（autoDock + 三个分支）、`hooks/useLinkInterceptor.ts`（fullscreen 字段）、`right-sidebar/{SessionFilesSection,WorkingDirectoryTree}.tsx`（全屏旁路条件）。

#### 代码引用到对话（一次性，不留高亮）

选中代码 → 浮出「引用到对话」按钮 → 进入输入框上方的 chip（`文件名:行号`）→ 随下条消息发出后清空，**代码上不留任何标记**。与 markdown 的标注追问刻意分家：
- **不进标注体系**：标注要锚点自愈（文件改了要能重定位），而代码经语法高亮切成 span 后锚不稳；一次性引用"问完即弃"，根本不需要重定位——`PreviewPanel` 里"代码关闭标注"那条注释预留的正是这个出口。
- **不持久化**：`atoms/transient-quotes.ts` 是普通 `atomFamily`（无 localStorage），引用不该跨重启复活。走 atom 而非 props 的原因同 preview-annotations：PreviewPanel 与 ChatDisplay 组件树不连通。
- **复用 chip 下游**：合并进 `pendingFollowUpAnnotations`（带 `transientQuoteId` 标记），chip UI / `formatFollowUpSection` / 排序去重全部零改动；`handleSubmit` 三类分流（message → IPC 标记已发、preview → 渲染层 store、transient → 直接清空）。
- **note 允许为空**：代码引用的问题写在输入框正文里，`formatFollowUpSection` 遇空 note 只输出引文行（不留孤零零的 `→`）；chip 标签回落显示 `sourceLabel`。
- **行号从 DOM 读**：`ShikiCodeViewer` 加 `data-line` transformer，**降级分支（高亮未就绪）同步按行拆并带 data-line**——两分支同构，否则行号推算会在加载瞬间失效。
- **可单条丢弃**：chip 上的 ✕ 只给 `removable` 项（= 一次性引用）。标注类 follow-up 不给——那要删的是标注本身（持久、有高亮），语义远重于"丢掉一条引用"，应走标注岛而非输入框。chip 整体是 button，✕ 用 `span[role=button]` + stopPropagation 避免嵌套按钮。

**New files:** `atoms/transient-quotes.ts`、`right-sidebar/CodeQuoteLayer.tsx`
**Modified files:** `packages/ui/code-viewer/ShikiCodeViewer.tsx`（data-line×2 分支）、`ChatDisplay.tsx`（合并+清空）、`ChatDisplay.follow-ups.ts`（transientQuoteId + 空 note）、`PreviewPanel.tsx`（挂载）、7× i18n（`preview.quoteToChat`）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

### Trajectory View — 模型实际收到了什么（读 SDK transcript）

聊天页标题栏右侧 Route 图标（分享按钮左边，与「编辑任务」同一动作区；仅会话已关联 SDK 记录时出现，窄面板下隐藏）→ 全屏只读视图：**上下文构成条**（注入 / 你的输入 / 推理 / 回复 / 工具 各占多少）+ **注入块排行**（哪个自动注入的块最占地方）+ 可展开的逐条明细（按类筛选）。灵感来自 DeepSeek Harness 的 Trajectory view。

**核心判断：不重复记录，只做读取与归因。** craft 的 `session.jsonl` 是"对话当前样子"的快照（每轮全量重写、只有 9 种消息角色），**注入块 / 系统提示 / 压缩细节 / 原始 SDK 事件一律不落盘**；而 **Claude SDK 自己在 `~/.claude/projects/<slug>/<sdkSessionId>.jsonl` 写了一份高保真轨迹**——注入块逐块可见、`compactMetadata` 完整（preTokens/postTokens/cumulativeDroppedTokens）、工具原始出入参俱全。既然数据已在盘上，就没有理由再建一套记录管线。

**两个实测得出的关键细节**：
1. **slug 规则是"斜杠**和**点号都替换为连字符"**——`/Users/x/.craft-agent/…` → `-Users-x--craft-agent-…`（点号产生双连字符）。只替换斜杠会找不到文件。
2. **注入块按内容特征识别而非位置**（`<session_state>` / `<sources>` / `<workspace_capabilities>` / `<working_directory>` / `**USER'S DATE AND TIME`），注入顺序会随版本变。

**诚实的盲区**：Claude 基座系统提示词与工具定义由 SDK 的 `preset:'claude_code'` 持有，本仓库无论如何读不到——UI 里明确标注，不假装完整。

**样本量级**（真实会话验证）：57 条目 / 16191 字符中，**注入占 37%、用户输入仅占 0.6%**——这正是此前完全不可见的部分。

#### DeepSeek Harness 式界面（2026-08-13 二期）

界面按 DeepSeek Harness 的轨迹视图重做：**顶部三泳道时间轴（Input / Model / Tools）+ 中间密集事件流 + 右栏详情/构成 + 底部统计条**。

- **时间轴**：段宽即耗时，三种轴口径切换——`时长`（按真实时间，看耗时花在哪）/ `回合`（每轮等宽，看轮内结构）/ `步骤`（每步等宽，看序列）。一种口径不够是因为一次 40 秒的模型生成会把毫秒级工具挤成一根线，而等宽又看不出谁慢。段与列表行**共用 `entryIndex` 作选中键**，点哪边都选中同一条。**在泳道上拖拽即框选一段时间**（读数条显示时长+条数，✕ 或点空白清除），下方列表窗外条目淡出并自动滚到窗内第一条——看到一段很慢，直接框出来看那几十秒在干嘛。交互由单独一层顶层捕获（段 `pointer-events-none`，命中靠自身几何判定），点选与框选归同一所有者，无 z-index 之争；位移超 4px 才算拖。**双指捏合/滚轮以光标为定点缩放**（最高 500×，双指横扫平移，一键复原），百轮会话不再挤成一片——视口在轴空间（投影后的 [0,1]）上做，三种口径完全同构；段的最小宽度必须加在**屏幕空间**，加在轴空间会随缩放放大到撑满轨道。
- **事件流**：一条目一行，左槽角色标签（SYSTEM/USER/CONTEXT/THINKING/ASSISTANT/TOOL）。工具行把调用与结果压成 `名字 {入参} → 结果`；**已配对的结果不单独成行**。
- **右栏**：未选中时是「上下文构成」（构成条 + 筛选 chip + 注入块排行 + **工具耗时排行** + 盲区声明；前者回答"上下文被谁吃了"，后者回答"时间被谁吃了"，工具排行按框选窗口收窄并标注"本段"），选中后变条目详情（概览/入参/结果/原始/计时四五个页签，按类型动态给）。**左缘可拖宽**（双击复位，宽度持久化）——33K 字符的系统提示词挤在 360px 里没法读。宽度由 `TrajectorySidePanel` 统一持有（两个视图共用槽位，各持一份切换会跳）；拖拽期间直接改 DOM 不过 React（否则每像素重渲染上千行列表），容器宽度进 state 不在渲染时读 ref（首帧 ref 为 null 会把 clamp 永久掐死在最小值）。
- **底部统计**：`N 轮·N 步 | 模型 37.5s · 工具 9.2s (12) | 缓存命中 87% | 输入 231K · 输出 4.3K`。

**第二档（系统提示词）**：SDK transcript 唯一缺的就是系统提示词——那段由 craft 在建请求时拼装，只有它自己知道。`packages/shared/src/sessions/system-prompt-record.ts` 在 `claude-agent.ts` 的 SDK options 构造点补写 sidecar `<会话>/meta/system-prompt.jsonl`：**内容寻址、变了才追加**（稳定不变的提示词一个会话只写一次），进程内缓存指纹 + 重启后比对盘上末行，写失败一律静默（旁路数据绝不能拖垮真实对话）。渲染层 `mergeTrajectory` 把它**置顶**（不按时间插：它是会话级常量，从第一个 token 起就在起作用，只是我们直到某轮才抄下来；按记录时刻插会埋进对话中间且被无时间戳条目拽偏——初版的真 bug），同理不上时间轴泳道。剩余盲区收窄为「Claude Code 基座预设与工具定义」。

**五个实测踩坑（都有测试守护）**：
1. slug 规则是斜杠**和**点号都替换为连字符，只替换斜杠找不到文件；
2. 工具结果也是 `user` 角色，回合分组必须排除它，否则每个工具结果都算一次新提问；
3. 同一 `requestId` 的每个块都带一份**完全相同**的 usage，逐块累加会把 token 放大到块数倍；
4. **只调工具不说话的请求也必须挂 usage**——这是最常见的形态，漏了会让整步 token 凭空消失（测试逮到的真 bug）；
5. 模型段起点要回溯到上一个事件结束，只从首个块时间戳算会让等待时间消失。也因此 UI 明写"时长来自会话时间戳"，含排队与网络往返、非服务端计时。

刻意**不用 `PreviewOverlay`**：它把 children 塞进带渐隐遮罩的文档滚动容器，与"顶栏固定 + 双栏各自滚 + 底部固定"的应用式布局冲突，故自持 portal + 复用 `FullscreenOverlayBaseHeader`。列表未虚拟滚动，超 3000 行截尾并在顶部明示（统计与时间轴仍吃全量）。

**New files:** `lib/trajectory-core.ts`(+test，25 用例)、`components/trajectory/{TrajectoryOverlay,TrajectoryLanes,TrajectoryList,TrajectoryDetail,TrajectoryComposition}.tsx` + `kind-meta.ts` + `CLAUDE.md`(L2)、`packages/shared/src/sessions/system-prompt-record.ts`
**Modified files:** `SessionManager.ts` + `protocol/dto.ts`（会话 DTO 补 `sdkSessionId`/`sdkCwd`）、`shared/agent/claude-agent.ts`（options 构造点记录系统提示词）、`transport/channel-map.ts` + `shared/types.ts`（暴露已有的 `system:homeDir`）、`pages/ChatPage.tsx`（头部按钮 + 挂载）、7× i18n（51 键）。读文件复用 `file:read`，**零新 IPC 通道**。

**入口时有时无的根因（2026-08-14 修复）**：`sdkSessionId` 是**首轮跑完才由 SDK 回传**的，`onSdkSessionIdUpdate` 只写内存与磁盘、**不推事件**；而渲染层那份会话 DTO 是加载时构造的，之后再没刷新过。于是新会话跑完第一轮，盘上有了、界面上那份仍是 `undefined` → 依赖它的 UI 时有时无，要重启 app 才对。修法是走**现成通道**：`handleSessionMetadataChanged` 本就是无脑展开合并（`{...session, ...changes}`），只有 dto.ts 的 `Partial<Pick<...>>` 在收窄类型——把 `sdkSessionId`/`sdkCwd` 加进那个联合，然后在 id 落定与两处清空（resume recovery / branch fork invalidated）时各推一次。清空也必须推，否则界面会留一个指向已失效 transcript 的入口。**教训：凡是"运行中才产生"的会话字段，写盘之外必须显式推给渲染层——DTO 只在加载时构造一次。**

**Patching:** ⚠ 非 renderer-only（SessionManager + claude-agent 进 main.cjs，preload 也变）→ `build:renderer` + `build:main` + `build:preload` + `bash patch-app.sh`。`claude-agent.ts` 不进 subprocess bundle（那是 Pi 路径），无需 `server:build:subprocess`。

### Needs-You Attention Signal — 待你处理的会话，余光可感知

「需要你动手」的状态（待批权限 / 待批计划）从**静态小图标**升级为**会呼吸的图标 + 常驻聚合徽标**。灵感来自 Grok Bot 那个[代码写成的形变图标](https://benji.org/morphing-icons-with-claude)，但**没有照抄形变**——调研后发现真正可迁移的不是动画本身，而是"运动携带信息"这一点。

**调研纠偏（值得记）**：最初的判断是"侧边栏分不出'在等你'和'在跑'"，**读代码后证伪**——`SessionItem` 早就有四个指示器（Spinner / 未读圆点 / 绿色计划闪电 / 琥珀盾牌 `hasPendingPrompt`）。真正的缺口是另外两条：
1. 那些图标**不会动**——静止图标要"识别"（看过去、认出形状），运动才能被"感知"（不看也注意到）；
2. **出了会话列表就完全看不见**——权限请求只在该会话聊天页里呈现（`usePendingPermission`），你在看板/收藏页/别的会话时，`pendingPermissions` 没有任何聚合出口。

**关键设计：聚合徽标只数活的权限请求**，刻意不含"计划待批"（`lastMessageRole === 'plan'`）。后者是持久化状态，几天前废弃的会话会让徽标永远非零——**一个长期不归零的提示比没有提示更糟，它训练你忽略它**。逐会话的图标两种都给（就在眼前，不会误导），只有聚合数字要求这份严格。

其余取舍：动效用**纯 CSS**（侧边栏可能同时几十项，每项一个 JS 循环会拖垮列表；与既有 `Spinner` 的 "pure CSS, no JS state" 一致），幅度克制（缩放 6%、透明度 25%——这是提示不是警报），并在 `prefers-reduced-motion` 下完全关闭（动效是增强，不是信息本身）。`LinkItem.attention` 与既有 `label` 的关键差别是**常驻可见**：`label`（会话总数）悬停才显形，而唯一需要你动手的信号藏在悬停后面等于没有。

**Modified files:** `renderer/index.css`（`animate-attention` + reduced-motion）、`app-shell/SessionItem.tsx`（两个 actionable 图标加动效）、`app-shell/LeftSidebar.tsx`（`LinkItem.attention` 常驻徽标）、`app-shell/AppShell.tsx`（`attentionCount` + 挂到 nav:allSessions）。

**Patching:** renderer-only → `build:renderer` + `bash patch-app.sh`.

## Git Remotes — 上游只读，备份可写

这个仓库有两个远端，职责不对称，**别把它们搞混**：

| 远端 | 指向 | 用途 |
|---|---|---|
| `origin` | `lukilabs/craft-agents-oss` | **官方上游，只读** —— 拉更新用 |
| `myfork` | `Limitless2023/craft-agents-oss` | **你的备份，可写** —— `main` 跟踪它 |

注意 `origin` 是上游而不是你自己的 fork（GitHub 惯例正好相反），这是个真实的坑：`main` 原本跟踪 `origin/main`，一个裸 `git push` 会试图把 150+ 个定制提交推进官方仓库。已做两道防护：

1. `git branch -u myfork/main main` —— 默认推拉都走你的备份，`git status` 也以备份为参照
2. `git remote set-url --push origin DISABLED_upstream_is_read_only` —— 对上游的推送被立刻拦下（fetch 不受影响，上面那套升级命令照常可用）

日常：`git push` 备份自己的工作。升级：照旧 `git pull origin main`（显式写 origin，语义没变）。

## Patching the Official App

We replace **JS bundles + main.cjs + preload** and optionally patch `Info.plist` for file associations. Modifying `Info.plist` requires ad-hoc re-signing.

### Check whether upstream has a new release first:

```bash
# 远端最新 tag（直连服务器，非缓存）；若高于本地基线 v0.10.4 即说明官方发新版了
export all_proxy=socks5://127.0.0.1:7890
git ls-remote --tags --sort=-v:refname origin | head -1
git rev-list --count HEAD..origin/main   # 0 = 已是最新；>0 = 上游有新提交（需先 git fetch）
```

> Baseline as of 2026-08-19: local main merged up to upstream **v0.12.0** (2026-08-18) — 0 behind, 158 custom ahead. Merge commit `568e38b8`, checkpoint 分支 `backup/main-pre-v0.12.0` @ 75a0e84d。**这版基本是一次搬家而非功能版本**：域名迁到 `thecraftagents.com`（应用/下载/自动更新源/分享链接/文档全部换址），文档站从内置 Mintlify 改为纯静态站。唯一实质变化对我们有利——**agent 不再挂载内置 `craft-agents-docs` MCP 服务器**（改为引用公开文档站），每个会话少一条常驻后台连接，`<sources>` 注入块也随之变短。
>
> **合并干净度**：上游真实改动 57 文件 / +621 −322，与定制交集 6 个（`ChatPage.tsx` 只改 2 行文档 URL、`SessionManager.ts` 与 `claude-agent.ts` 都只删 `craft-agents-docs` 相关块，均离定制区很远），**仅 `bun.lock` 真冲突**（`--theirs` + `bun install`）。**模型目录与 Agent/Pi SDK 版本均未变 → 无需 `server:build:subprocess`**（判据见 v0.11.4 那条）。测试基线原样复现：electron/src 972 pass / 8 fail（browser-pane-manager）；ui 340 全绿；shared 2177 pass / 13 fail；server-core 220 全绿。
>
> ⚠️ 副作用：内置文档源被移除（`builtin-sources.ts` −77 行、`session-mcp-server/index.ts` −84 行），**若某些会话手动启用过 `craft` 数据源，合并后会消失**，其他源不受影响。
>
> Baseline as of 2026-08-07: local main merged up to upstream **v0.11.4** (2026-08-06) — 0 behind, 150 custom ahead. Merge commit `ca614481`, checkpoint 分支 `backup/main-pre-v0.11.4` @ 717af162。小版本、**与定制零文件交集**（历次最干净的一次，仅 `bun.lock` 冲突）：**Claude Opus 4.6 回归模型选择器**（被强制迁到 4.8 的连接自动补回 4.6，一次性；默认仍是 4.8，手动删掉后不再回来）+ 修复 **Explore 模式被拦截工具后闷声结束**（v0.11.3 SDK 升级带进来的回归，agent 现在能看到拦截原因并改提方案）。
>
> **⚠️ 无 SDK 变化 ≠ 不用重建子进程**：本次 `config/models.ts` + `models-pi.ts` 变了（模型目录），`pi-agent-server` 自带目录副本——重建前 bundle 里 `opus-4-6` 命中 35 处、重建后 39 处，确属过期。**判据应是"模型目录/Pi SDK 是否变化"，而不是"Agent SDK 版本号是否变化"**。测试基线不变：ui 340 全绿；electron/src 929 pass / 8 fail（browser-pane-manager）；shared 2177 pass / 13 fail（i18n 排序 ×7 + channel routing ×2 + ClaudeEventAdapter ×3，均上游既有）。
>
> 前一基线 (2026-08-04): local main merged up to upstream **v0.11.3** (2026-08-03) — 0 behind, 148 custom ahead. Merge commit `664071d1`, checkpoint 分支 `backup/main-pre-v0.11.3` @ 5360cd3b。**⭐ 两个修复直接命中我们的日常**：输入框不再强制首字母大写（此前破坏拼音/CJK 输入法连续输入）、含空格路径（`%20`）的本地文件链接恢复可用。另有 `archive_session` 会话工具（Agent 可归档他人会话，不能归档自己/跑动中的）+ **Agent SDK 0.3.197→0.3.220**（Claude Code v2.1.220 parity；⚠ 上游把子 Agent 嵌套深度默认从 5 降为 **1**，需要多层派生时用 `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` 调回）+ macOS 自动更新修复 + 新会话不再继承 exclude 过滤器。
>
> **合并要点**：10 文件与定制交集，但**只有 `bun.lock` 真冲突**（`--theirs` + `bun install`）。值得记的一笔：上游 #944 修 `%20` 路径引入了 `decodeFilePath`（无 `%` 零开销、非法编码回退原串），与我们 2026-06 的定制功能等价但更严谨——**已删掉我们那段自行 `decodeURIComponent` 的分支，收敛到上游实现**。这是"定制被上游追平后主动退场"的第一例，以后合并遇到同类情况照此处理。**SDK 升级 → 必须 `server:build:subprocess`**（已验证子进程 bundle 含 archive_session、SDK 0.3.220）。合并后测试：ui 340 全绿；electron/src 929 pass / 8 fail（仍为 browser-pane-manager 上游既有）。
>
> 前一基线 (2026-07-23): local main merged up to upstream **v0.11.2** (2026-07-22) — 0 behind, 129 custom ahead. Merge commit `e192ebeb`, checkpoint 分支 `backup/main-pre-v0.11.2` @ 577f90b5. v0.11.2 = 小版本，**无 SDK 升级**：⭐ **`create_task` 会话工具**（Agent 在看板建未启动任务；session-tools-core 变更 → **必须 `server:build:subprocess`**，已验证 bundle 含 create_task）+ 任意 workspace 互传会话（`hasRemoteWorkspaces` prop 改名 `hasTransferTargets`）+ 空输入 ↑ 召回上一 prompt + **后台完成 chip 默认关闭**（Settings → Appearance 可开回；我们的主题色定制仍在）+ 排队消息中断误判修复。冲突仅 2 文件全加法：`SessionMenu.tsx`（prop 改名 vs 我们 pin/export 参数）、`App.tsx`（import 区，我们 RenameSessionShortcut vs 上游 background-task-chip-state）。合并后测试基线：ui 324 全绿；electron/src 915 pass / 8 fail（仍为 browser-pane-manager 上游既有）。
>
> 前一基线 (2026-07-12): local main merged up to upstream **v0.11.1** (2026-07-11) — 0 behind, 122 custom ahead. Merge commit `93a334be`, checkpoint 分支 `backup/main-pre-v0.11.1` @ 0009c924. v0.11.1 = 小版本：⭐ **OpenAI GPT-5.6**（Luna/Terra/Sol，OpenAI API key / ChatGPT 账号 / Azure 三连接；新 OpenAI 连接默认 GPT-5.6 Sol）+ **Max thinking level 原生透传**（`THINKING_TO_PI` `max:'xhigh'`→`max:'max'`，Pi 按模型内部 clamp——GPT-5.6 与 adaptive Claude 原生吃 max，老模型各自降顶；对默认 Opus 4.8 无副作用）+ **Pi SDK 0.80.3→0.80.6**（请求级 input-token 分层计价，GPT-5.4/5.5/5.6 长上下文成本更准）。default 仍 Opus 4.8。合并**零定制冲突**——只碰 `constants/thinking-levels/llm-connections.ts` + 一堆 package.json + `bun.lock`，不碰我们任何定制文件；仅 `bun.lock` 冲突（`git checkout --theirs bun.lock && bun install`）。**Pi SDK 升级 → 必须 `server:build:subprocess`**（已验证 bundle 含 38× `gpt-5.6`，非 stale）。checkpoint 分支 `backup/main-pre-v0.11.1` @ 0009c924。
>
> 前一基线 (2026-07-08): local main merged up to upstream **v0.11.0** (2026-07-07) — 0 behind, 116 custom ahead. v0.11.0 = 近期最大版本：⭐ **Projects**（`{workspaceRoot}/projects/{slug}/`，绑定会话即注入 `<project_context>` + asset manifest + size-capped MEMORY.md）+ ⭐ **Kanban 看板 (Beta)** + 持久化 **Tasks** + **Conductor** DAG 编排（`task.yaml` 拆子任务、依赖排序、断点续跑）+ 后台 agent 跨轮存活（`CRAFT_KEEP_BG_AGENTS_ALIVE=0` 可关）+ macOS 本地网络权限修复。default 仍 Opus 4.8，claude-agent-sdk 未变，**Pi SDK 0.79.9→0.80.3**（移除 20s SSE 硬超时）。合并**有真实冲突**（非零冲突）——16 文件：`AppShell/SessionItem/SessionList/SessionMenu.tsx`、`route-parser/routes/types.ts`、`ui/index.ts`、7× i18n、`bun.lock`；全部**加法冲突两者都留**（我们的 favorites 导航 + pin-session vs 上游 projects/board/onSetProjectId；`AgentSpinner` 与新 `LoadingIndicator` 是两个独立组件不是重命名）。checkpoint 分支 `backup/main-pre-v0.11.0` @ 7f58c21b。
> **⚠️ Pi SDK jiti/static gotcha（0.80.3 引入，0.80.6 仍在）**：`pi-coding-agent@0.80.x` 精确依赖 **jiti 2.7.0**（`./static` 导出 → `lib/jiti-static.mjs`），但 hoist 的根 jiti 是 2.6.1（无 `./static`），`bun install` 只复用 hoist 版、**漏建嵌套 jiti 2.7.0** → `server:build:subprocess` 报 `Could not resolve "jiti/static"`。修复：`bun install --force` 补齐 `node_modules/@earendil-works/pi-coding-agent/node_modules/jiti@2.7.0` 后再 build subprocess。（v0.11.1 升级已复现并处置。）
>
> 前一基线 (2026-07-02): local main is merged up to upstream **v0.10.5** (2026-07-01) — 0 upstream commits behind, custom commits ahead (⌘R rename + earlier remixes). v0.10.5 = **Claude Sonnet 5** (`claude-sonnet-5`, 1M context, adaptive thinking) 进模型选择器 + Bedrock US/EU/Global 路由 (`config/models.ts` + `llm-connections.ts`) + Agent SDK `@anthropic-ai/claude-agent-sdk` **0.3.170→0.3.197** (Claude Code v2.1.197 parity); default 仍 Opus 4.8, **Pi SDK 未变** (`@earendil-works/pi-*` 0.79.9), 无 breaking/bugfix。合并**零定制冲突**——v0.10.5 只碰 package.json/bun.lock/models.ts/llm-connections.ts/en.json/tests, 不碰我们任何定制文件; 仅 `bun.lock` 冲突。**新模型入 `config/models.ts` → 必须 `server:build:subprocess`** 让 pi-agent-server 认得 Sonnet 5 (否则选它触发 provider-mismatch 偏移)。checkpoint 分支 `backup/main-pre-v0.10.5` @ 56ae568e。
>
> 前一基线 (2026-06-26): v0.10.4 = Pi AI SDK 改名+升级 `@mariozechner/pi-*`→`@earendil-works/pi-*` 0.73.1→0.79.9 + UI 语言偏好 `preferences-ui-language` + storage 启动迁移 + auto-update 日志改进 (#891); Agent SDK 0.3.170。bun.lock conflicts on most merges — resolve with `git checkout --theirs bun.lock && bun install`.
>
> **Upgrade gotcha (v0.10.2+):** the full umbrella `build` now fails its `lint` gate — v0.10.2's stricter custom rules `craft-links/no-direct-file-open` (DocsPanel/InfoPopover) and `craft-styles/no-nonstandard-shadows` (FabNewChat) flag our pre-existing custom code. Lint is style-only and doesn't affect artifacts; when backend/main changes need a main rebuild, run the build steps individually (`build:main`, `build:preload`, `build:preload-toolbar`, `build:interceptor`, `build:renderer`, `build:copy`) skipping `lint`. `build:validate` references a non-existent `scripts/validate-assets.ts` — harmless, ignore.

### After an official Craft Agents update:

```bash
# 1. Pull latest upstream & install deps
cd ~/Desktop/Projects/craft-agents-oss
git pull origin main
bun install

# 2. Build renderer + main + preload —— 自 2026-07-12 起升级后必须全跑：
#    我们的定制已进入 main 进程（file:write handler @ server-core/files.ts、
#    Finder open-file @ main/index.ts）+ preload（channel-map 的 writeFile 绑定）。
#    只 build renderer 会让 patch-app.sh 把「合并前的旧 main.cjs」盖进安装位——
#    丢上游 main 新改动，或（首次 clone 后）丢我们的 file:write → 编辑保存直接报错。
export https_proxy=http://127.0.0.1:7890   # proxy if needed
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
bun run --filter '@craft-agent/electron' build:renderer
bun run --filter '@craft-agent/electron' build:main
bun run --filter '@craft-agent/electron' build:preload
bun run --filter '@craft-agent/electron' build:preload-toolbar

# 2b. If the Pi SDK was upgraded (new models in the catalog), REBUILD the
#     subprocess bundle too — main.cjs and pi-agent-server carry separate SDK
#     copies and must stay in lockstep (see "Pi SDK version skew" below).
bun run server:build:subprocess   # rebuilds packages/{pi-agent-server,session-mcp-server}/dist/index.js

# 3. Quit Craft Agents (Cmd+Q), then run the patch script
#    (patch-app.sh now also syncs resources/<server>/index.js)
bash patch-app.sh

# 4. Reopen Craft Agents
```

### What patch-app.sh does:
1. Replaces `main.cjs`, `bootstrap-preload.cjs` in the installed app
2. Removes old `main-*.js`, `playground-*.js`, `sonner-*.js` and copies our builds
3. Copies `index.html` directly from build output (avoids fragile hash detection)
4. Syncs `@anthropic-ai/claude-agent-sdk` + native binary package
5. **Syncs subprocess server bundles** (`pi-agent-server`, `session-mcp-server`, `bridge-mcp-server`) from `packages/<server>/dist/index.js` → `resources/<server>/index.js`
6. Adds `.md` file association to `Info.plist` (with UTI declarations)
7. Re-signs the app (ad-hoc) and re-registers with Launch Services

### Important notes:
- **Re-signing is needed** when `Info.plist` is modified (file association step) — the script handles this automatically
- **No separate app** — we patch the official app in-place; reinstalling official version restores original
- Building a standalone "Craft L Agents" app fails on macOS 26 due to strict code signing enforcement on ad-hoc signed Electron apps
- **⚠️ Pi SDK version skew (subprocess vs main):** `resources/pi-agent-server/index.js` bundles its *own copy* of the Pi SDK (`@earendil-works/pi-ai` model catalog) — it is **not** rebuilt by `build:renderer` or `build:main`. After a Pi SDK upgrade, `main.cjs` learns new models (e.g. `deepseek-v4-pro/flash`) and the UI offers them, but a **stale `pi-agent-server` subprocess can't resolve them** → it falls back to the default summarization model (`claude-haiku`) under provider `anthropic`, which has no API key → raw `No API key found for anthropic` → the setup screen shows the misleading **"Provider mismatch during setup"**. Fix: `bun run server:build:subprocess` (rebuilds `pi-agent-server` + `session-mcp-server`) **before** `bash patch-app.sh` so the subprocess SDK matches `main.cjs`. Diagnose with `grep -c deepseek-v4-pro "/Applications/Craft Agents.app/Contents/Resources/app/resources/pi-agent-server/index.js"` (0 = stale).
- **Stale `.bun` symlinks block `server:build:subprocess` AND hang `bun test`:** an old isolated-linker install can leave dangling `packages/*/node_modules/*` (and `apps/*/node_modules/*`) symlinks pointing at a now-missing `node_modules/.bun/` store, which makes `bun build` fail with `File not found …/node_modules/<pkg>` — and makes `bun test` **hang indefinitely with zero output** after ENOENT module-resolution errors（2026-07-18 排查：apps/electron 下 57 个 4 月遗留悬空链接，悬空链接截胡解析、不落回根 hoist 包）. Clear them (safe — all dangling): `find apps/*/node_modules packages/*/node_modules -maxdepth 2 -type l ! -exec test -e {} \; -print -delete`
- **`bun test` 目录参数是子串过滤，不是目录**：`bun test apps/electron` 会把 `dist/` 里的构建副本也当测试跑（同名用例 ×2/×3、224 文件），务必用 **`bun test apps/electron/src`** 这类 src 收窄写法。
- **测试基线（2026-07-18，HEAD=viz 三连提交后）**：ui 324 全绿；electron/src 891 pass / **8 fail 全在 `browser-pane-manager.test.ts`（上游既有，pre-viz 同败）**；shared 2160 pass / 13 fail 全部上游既有（i18n 排序 parity ×7——locale 文件上游本就非全排序、我们插键只保持局部有序；channel routing ×2；ClaudeEventAdapter ×3）。判定回归时以此为基线，别把上游债当成自己的锅。

## Commands

```bash
# Typecheck
bun run typecheck

# Build renderer only (for patching)
bun run --filter '@craft-agent/electron' build:renderer

# Dev mode (full hot-reload, no patching needed)
bun run electron:dev
```

## Machine Info

- Apple Silicon (Mac16,8, M4 Pro)
- macOS 26.3.1
- Proxy: http://127.0.0.1:7890 (socks5://127.0.0.1:7890)
