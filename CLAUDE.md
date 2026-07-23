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

Select text in the right-side Preview panel (`.md` files) → attach a note (persistent highlight) → it joins the chat composer's pending follow-ups and is sent with the next message, quote prefixed with the file name. Renderer-only: annotations persist in a jotai store (`craft-preview-annotations:<sessionId>`, keyed by the file path used as a pseudo-messageId); reuses `AnnotatableMarkdownDocument` + `formatFollowUpSection`. Known limit: highlights anchor by char offset, so live agent edits to the file can drift them.

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

安全红线（收紧于参考实现）：iframe `sandbox="allow-scripts"`（**绝不**加 allow-same-origin——与 MarkdownHtmlBlock 恰相反，后者 same-origin 无脚本，**两组件刻意分离不合并**）；CSP 无任何网络源（比 spec 更严：删掉 CDN 白名单，堵"经 CDN URL 查询串外带"通道）；postMessage 双向校验 source 标识（S7）。红线有测试静态守护（`__tests__/viz-host.test.ts`，12 用例）。G8 追问回传留二期：桥保留 `window.openai/craft.sendFollowUpMessage` API 面，宿主统一回执 unsupported。

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

## Patching the Official App

We replace **JS bundles + main.cjs + preload** and optionally patch `Info.plist` for file associations. Modifying `Info.plist` requires ad-hoc re-signing.

### Check whether upstream has a new release first:

```bash
# 远端最新 tag（直连服务器，非缓存）；若高于本地基线 v0.10.4 即说明官方发新版了
export all_proxy=socks5://127.0.0.1:7890
git ls-remote --tags --sort=-v:refname origin | head -1
git rev-list --count HEAD..origin/main   # 0 = 已是最新；>0 = 上游有新提交（需先 git fetch）
```

> Baseline as of 2026-07-23: local main merged up to upstream **v0.11.2** (2026-07-22) — 0 behind, 129 custom ahead. Merge commit `e192ebeb`, checkpoint 分支 `backup/main-pre-v0.11.2` @ 577f90b5. v0.11.2 = 小版本，**无 SDK 升级**：⭐ **`create_task` 会话工具**（Agent 在看板建未启动任务；session-tools-core 变更 → **必须 `server:build:subprocess`**，已验证 bundle 含 create_task）+ 任意 workspace 互传会话（`hasRemoteWorkspaces` prop 改名 `hasTransferTargets`）+ 空输入 ↑ 召回上一 prompt + **后台完成 chip 默认关闭**（Settings → Appearance 可开回；我们的主题色定制仍在）+ 排队消息中断误判修复。冲突仅 2 文件全加法：`SessionMenu.tsx`（prop 改名 vs 我们 pin/export 参数）、`App.tsx`（import 区，我们 RenameSessionShortcut vs 上游 background-task-chip-state）。合并后测试基线：ui 324 全绿；electron/src 915 pass / 8 fail（仍为 browser-pane-manager 上游既有）。
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
