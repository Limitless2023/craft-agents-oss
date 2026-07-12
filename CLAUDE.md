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

### Preview Width Rule — 聊天保底 + 左侧列收起阶梯

Preview 面板宽度**没有绝对上限**（2026-07-12 删除了 `PREVIEW_MAX_WIDTH = 1000` 魔数）——唯一约束是聊天区保底 `MIN_MAIN_CONTENT_WIDTH = 440`，**必须等于** `panel-constants` 的 `PANEL_MIN_WIDTH`（PanelSlot 的 flex minWidth；两数不等则 reserve 按小数算、布局按大数拒缩 → flex 行溢出，测试有 lockstep 守护）。Info/docs 类面板仍有 `OTHER_PANEL_MAX_WIDTH = 480` 类型上限，下限统一 `180`。Preview 手柄命中区：圆角裁剪独立成视觉层，拖拽手柄留在 `overflow-hidden` 外——否则负 margin 伸进面板缝隙的那半命中区被裁掉，可视缝隙成死区（"拖动条难触发"的根源）。

拖宽 Preview 时左侧列按**阶梯逐级让位**（`autoCollapseLevel`：0=全显示 → 1=收左栏 → 2=连会话列表也收），拖回去逐级还原。阶梯是**纯派生**（无 state/effect/latch）：阈值按"偏好布局"计算，不受实际收起状态反馈，无震荡。关键设计（2026-07-12 修复的死锁）：**拖拽 clamp 对 Preview 用地板占用（仅 inset+gap=12），不用实际占用**——否则意图宽度被掐死在阈值整数上而触发条件是严格大于，阶梯永远跨不过去。显示宽度仍按实际布局 clamp，聊天永远 ≥320。Cmd+B 在收起状态下显式召回左栏 = 左栏赢：Preview 意图被压回放得下的宽度（持久化）。单一真相：`apps/electron/src/renderer/lib/right-sidebar-width.ts`（+test），消费方 `AppShell.tsx`（阶梯派生 + 双 clamp + navigatorWidth/手柄接线）。面板内正文是**居中阅读列**（`PreviewPanel.tsx` 内容 wrapper `max-w-[928px] mx-auto`，正文 880px 与全屏 overlay 严格同宽）——面板拖宽时多余空间变左右留白，窄时 max-w 不生效。手柄命中区全局 `PANEL_SASH_HIT_WIDTH = 20`（每侧 10px，absolute 实现不占布局；再宽会压聊天区滚动条）。**`@container/shell` 必须与 `shellRef` 同元素**（AppShell 外层布局 div）：index.css 的移动端触屏放大（`@container shell ≤768px`，panel-header-btn 44px 等）与 JS `isAutoCompact` 要量同一块地形——曾挂在 PanelStackContainer 面板条上，Preview 拖宽把聊天条压到 <768px 即误触发手机模式（头部图标突然变大）。

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

> Baseline as of 2026-07-12: local main merged up to upstream **v0.11.1** (2026-07-11) — 0 behind, 122 custom ahead. Merge commit `93a334be`, checkpoint 分支 `backup/main-pre-v0.11.1` @ 0009c924. v0.11.1 = 小版本：⭐ **OpenAI GPT-5.6**（Luna/Terra/Sol，OpenAI API key / ChatGPT 账号 / Azure 三连接；新 OpenAI 连接默认 GPT-5.6 Sol）+ **Max thinking level 原生透传**（`THINKING_TO_PI` `max:'xhigh'`→`max:'max'`，Pi 按模型内部 clamp——GPT-5.6 与 adaptive Claude 原生吃 max，老模型各自降顶；对默认 Opus 4.8 无副作用）+ **Pi SDK 0.80.3→0.80.6**（请求级 input-token 分层计价，GPT-5.4/5.5/5.6 长上下文成本更准）。default 仍 Opus 4.8。合并**零定制冲突**——只碰 `constants/thinking-levels/llm-connections.ts` + 一堆 package.json + `bun.lock`，不碰我们任何定制文件；仅 `bun.lock` 冲突（`git checkout --theirs bun.lock && bun install`）。**Pi SDK 升级 → 必须 `server:build:subprocess`**（已验证 bundle 含 38× `gpt-5.6`，非 stale）。checkpoint 分支 `backup/main-pre-v0.11.1` @ 0009c924。
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

# 2. Build the renderer (+ main/preload when backend changed)
export https_proxy=http://127.0.0.1:7890   # proxy if needed
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
bun run --filter '@craft-agent/electron' build:renderer

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
- **Stale `.bun` symlinks block `server:build:subprocess`:** an old isolated-linker install can leave dangling `packages/*/node_modules/*` symlinks pointing at a now-missing `node_modules/.bun/` store, which makes `bun build` fail with `File not found …/node_modules/<pkg>`. Clear them (safe — all dangling) before rebuilding: `find packages/*/node_modules -maxdepth 2 -type l ! -exec test -e {} \; -print -delete`

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
