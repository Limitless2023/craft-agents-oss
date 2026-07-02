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
3. File routing: PDF → system default app, images → in-app preview, markdown/code → in-app preview, folders → Finder

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

**New files** (`apps/electron/src/renderer/components/favorites/`): `favorites-core.ts`(+test), `favorites-store.ts`, `favorites-highlight-store.ts`(+test), `FavoritesPage.tsx`, `CLAUDE.md` (L2)

**Modified files:**
- `packages/ui/src/components/chat/TurnCard.tsx` — heart button in the reply footer (+ `isFavorited`/`onToggleFavorite` props)
- `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` — heart wiring + scroll-to/flash highlight consumer
- `apps/electron/src/renderer/components/app-shell/AppShell.tsx` — Favorites sidebar entry above Settings
- `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` — renders FavoritesPage for the favorites navigator
- `apps/electron/src/shared/{types.ts,routes.ts,route-parser.ts}` + `renderer/lib/nav-helpers.ts` — the `favorites` navigator
- `packages/shared/src/i18n/locales/*.json` — `sidebar.favorites`, `favorites.*`, `common.favorite` (all 7 locales)

**Patching:** renderer-only → `bun run --filter '@craft-agent/electron' build:renderer` + `bash patch-app.sh` (no main/preload/subprocess rebuild).

## Patching the Official App

We replace **JS bundles + main.cjs + preload** and optionally patch `Info.plist` for file associations. Modifying `Info.plist` requires ad-hoc re-signing.

### Check whether upstream has a new release first:

```bash
# 远端最新 tag（直连服务器，非缓存）；若高于本地基线 v0.10.4 即说明官方发新版了
export all_proxy=socks5://127.0.0.1:7890
git ls-remote --tags --sort=-v:refname origin | head -1
git rev-list --count HEAD..origin/main   # 0 = 已是最新；>0 = 上游有新提交（需先 git fetch）
```

> Baseline as of 2026-07-02: local main is merged up to upstream **v0.10.5** (2026-07-01) — 0 upstream commits behind, custom commits ahead (⌘R rename + earlier remixes). v0.10.5 = **Claude Sonnet 5** (`claude-sonnet-5`, 1M context, adaptive thinking) 进模型选择器 + Bedrock US/EU/Global 路由 (`config/models.ts` + `llm-connections.ts`) + Agent SDK `@anthropic-ai/claude-agent-sdk` **0.3.170→0.3.197** (Claude Code v2.1.197 parity); default 仍 Opus 4.8, **Pi SDK 未变** (`@earendil-works/pi-*` 0.79.9), 无 breaking/bugfix。合并**零定制冲突**——v0.10.5 只碰 package.json/bun.lock/models.ts/llm-connections.ts/en.json/tests, 不碰我们任何定制文件; 仅 `bun.lock` 冲突。**新模型入 `config/models.ts` → 必须 `server:build:subprocess`** 让 pi-agent-server 认得 Sonnet 5 (否则选它触发 provider-mismatch 偏移)。checkpoint 分支 `backup/main-pre-v0.10.5` @ 56ae568e。
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
