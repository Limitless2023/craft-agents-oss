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

## Patching the Official App

We replace **JS bundles + main.cjs + preload** and optionally patch `Info.plist` for file associations. Modifying `Info.plist` requires ad-hoc re-signing.

### Check whether upstream has a new release first:

```bash
# 远端最新 tag（直连服务器，非缓存）；若高于本地基线 v0.10.4 即说明官方发新版了
export all_proxy=socks5://127.0.0.1:7890
git ls-remote --tags --sort=-v:refname origin | head -1
git rev-list --count HEAD..origin/main   # 0 = 已是最新；>0 = 上游有新提交（需先 git fetch）
```

> Baseline as of 2026-06-26: local main is merged up to upstream **v0.10.4** (2026-06) — 0 upstream commits behind, 66 custom commits ahead. v0.10.4 = Pi AI SDK 改名+升级 `@mariozechner/pi-*`→`@earendil-works/pi-*` 0.73.1→0.79.9 (主体改动) + 新增 UI 语言偏好 `preferences-ui-language` + storage 启动迁移 + auto-update 日志改进 (update-quit 走专用 `autoUpdateLog`, #891); Agent SDK 维持 0.3.170, 无新模型 (Fable 5 / Opus 4.8 default 不变)。合并仅 `bun.lock` + `main/index.ts` 自动合并 (main/index.ts 上游改 import/before-quit 日志, 不碰我们的 open-file handler)。bun.lock conflicts on every merge — resolve with `git checkout --theirs bun.lock && bun install`.
>
> **Upgrade gotcha (v0.10.2+):** the full umbrella `build` now fails its `lint` gate — v0.10.2's stricter custom rules `craft-links/no-direct-file-open` (DocsPanel/InfoPopover) and `craft-styles/no-nonstandard-shadows` (FabNewChat) flag our pre-existing custom code. Lint is style-only and doesn't affect artifacts; when backend/main changes need a main rebuild, run the build steps individually (`build:main`, `build:preload`, `build:preload-toolbar`, `build:interceptor`, `build:renderer`, `build:copy`) skipping `lint`. `build:validate` references a non-existent `scripts/validate-assets.ts` — harmless, ignore.

### After an official Craft Agents update:

```bash
# 1. Pull latest upstream & install deps
cd ~/Desktop/Projects/craft-agents-oss
git pull origin main
bun install

# 2. Build the renderer
export https_proxy=http://127.0.0.1:7890   # proxy if needed
export http_proxy=http://127.0.0.1:7890
export all_proxy=socks5://127.0.0.1:7890
bun run --filter '@craft-agent/electron' build:renderer

# 3. Quit Craft Agents (Cmd+Q), then run the patch script
bash patch-app.sh

# 4. Reopen Craft Agents
```

### What patch-app.sh does:
1. Replaces `main.cjs`, `bootstrap-preload.cjs` in the installed app
2. Removes old `main-*.js`, `playground-*.js`, `sonner-*.js` and copies our builds
3. Copies `index.html` directly from build output (avoids fragile hash detection)
4. Adds `.md` file association to `Info.plist` (with UTI declarations)
5. Re-signs the app (ad-hoc) and re-registers with Launch Services

### Important notes:
- **Re-signing is needed** when `Info.plist` is modified (file association step) — the script handles this automatically
- **No separate app** — we patch the official app in-place; reinstalling official version restores original
- Building a standalone "Craft L Agents" app fails on macOS 26 due to strict code signing enforcement on ad-hoc signed Electron apps

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
