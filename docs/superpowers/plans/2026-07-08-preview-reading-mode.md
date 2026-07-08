# Preview Reading Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global, non-destructive "reading mode" toggle to the right-sidebar Preview panel that hides/shows all highlight annotations.

**Architecture:** One module-level jotai `atom<boolean>` holds the panel-wide toggle. `PreviewPanel` reads it via a hook, renders an Eye/EyeOff button in its header, and — when the mode is on — falls through to its existing plain `<Markdown>` render branch instead of `<AnnotatableMarkdownDocument>`. No new prop on the shared UI component, no store-shape change, no backend.

**Tech Stack:** React, jotai (atoms), lucide-react (icons), TypeScript, Bun (typecheck/build).

## Global Constraints

- **Renderer-only.** No backend, protocol/IPC, or annotation-store change.
- **Non-destructive & decoupled.** Hiding highlights must NOT touch the follow-up send pipeline (`collectPreviewPendingFollowUps`). Hide ≠ cancel.
- **Not persisted.** State lives in a jotai `atom` only — no localStorage. App restart → default `false` (highlights shown).
- **Global single atom** — `atom(false)`, NOT an `atomFamily`. One switch for the whole Preview panel (shared across tabs and sessions).
- **Reuse the plain-Markdown branch** already present in `PreviewPanel.tsx` — do not add a "hide" prop to `AnnotatableMarkdownDocument`.
- **GEB docs:** every new file gets an L3 header (`[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`); update `atoms/CLAUDE.md` (L2) and the root `CLAUDE.md` Custom Modifications section.
- Spec: `docs/superpowers/specs/2026-07-08-preview-reading-mode-design.md`.

---

## File Structure

- **New:** `apps/electron/src/renderer/atoms/preview-reading-mode.ts` — the global reading-mode atom + `usePreviewReadingMode` hook. Sole responsibility: hold and toggle the panel-wide "hide highlights" boolean.
- **Modify:** `apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx` — consume the hook, add the header toggle button, gate the annotatable-vs-plain render on `!readingMode`.
- **Modify (docs):** `apps/electron/src/renderer/atoms/CLAUDE.md`, root `CLAUDE.md`.

Note on testing: the feature is a single boolean view toggle with no meaningful pure logic to unit-test (per the spec's explicit decision). The automated gate per code task is `bun run typecheck:electron`; correctness is confirmed by the manual dev-mode walkthrough in Task 3. Do not fabricate a trivial unit test — it would violate YAGNI and the spec.

---

### Task 1: Reading-mode state module

**Files:**
- Create: `apps/electron/src/renderer/atoms/preview-reading-mode.ts`
- Modify: `apps/electron/src/renderer/atoms/CLAUDE.md`

**Interfaces:**
- Consumes: nothing (leaf module; depends only on `jotai` + `react`).
- Produces:
  - `previewReadingModeAtom: PrimitiveAtom<boolean>` (jotai, initial `false`)
  - `usePreviewReadingMode(): readonly [boolean, () => void]` — returns `[hidden, toggle]`; `toggle` is a stable `useCallback` that flips the atom.

- [ ] **Step 1: Create the atom module**

Create `apps/electron/src/renderer/atoms/preview-reading-mode.ts` with exactly:

```ts
/**
 * [INPUT]: 依赖 jotai 的 atom/useAtom；react 的 useCallback
 * [OUTPUT]: previewReadingModeAtom（全局单例 boolean）+ usePreviewReadingMode hook
 * [POS]: Preview 面板「阅读模式」视图开关（隐藏/显示高亮批注）；全局非持久，PreviewPanel 消费；与 preview-annotations 存储解耦
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { atom, useAtom } from 'jotai'
import { useCallback } from 'react'

// ────────────────────────────────────────────────────────
// 全局单例：整个 Preview 面板共用一个开关（跨 tab、跨会话）。
// 非持久（不写 localStorage）——阅读模式是临时视图偏好，
// app 重启回到默认 false（显示高亮）。故意用普通 atom 而非 atomFamily。
// ────────────────────────────────────────────────────────
export const previewReadingModeAtom = atom(false)

export function usePreviewReadingMode(): readonly [boolean, () => void] {
  const [hidden, setHidden] = useAtom(previewReadingModeAtom)
  const toggle = useCallback(() => setHidden((v) => !v), [setHidden])
  return [hidden, toggle] as const
}
```

- [ ] **Step 2: Update `atoms/CLAUDE.md` member list**

In `apps/electron/src/renderer/atoms/CLAUDE.md`, add one member line under the member list (place it right after the `preview-annotations.ts` line). Insert exactly:

```
preview-reading-mode.ts: Preview 面板「阅读模式」全局开关（隐藏/显示高亮批注），普通 atom(false) + usePreviewReadingMode hook，非持久，与 preview-annotations 存储解耦
```

- [ ] **Step 3: Typecheck**

Run: `cd ~/Desktop/Projects/craft-agents-oss && bun run typecheck:electron`
Expected: PASS (exit 0, no errors). This confirms the new module's types resolve.

- [ ] **Step 4: Commit**

```bash
cd ~/Desktop/Projects/craft-agents-oss
git add apps/electron/src/renderer/atoms/preview-reading-mode.ts apps/electron/src/renderer/atoms/CLAUDE.md
git commit -m "feat(preview): add global reading-mode atom + hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire the toggle into PreviewPanel

**Files:**
- Modify: `apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx`
- Modify: root `CLAUDE.md`

**Interfaces:**
- Consumes: `usePreviewReadingMode` from `../../atoms/preview-reading-mode` (Task 1) → `[readingMode, toggleReadingMode]`.
- Produces: no new exports; user-visible header toggle + reading-mode render behavior.

- [ ] **Step 1: Add the lucide icons to the existing import**

In `PreviewPanel.tsx`, the icon import (currently line 24) reads:

```ts
import { FileText, X, RotateCw, FolderSearch, Maximize2, GitCompare } from 'lucide-react'
```

Replace it with:

```ts
import { FileText, X, RotateCw, FolderSearch, Maximize2, GitCompare, Eye, EyeOff } from 'lucide-react'
```

- [ ] **Step 2: Import the hook**

Immediately after the existing line (currently line 27):

```ts
import { usePreviewAnnotations } from '../../atoms/preview-annotations'
```

add:

```ts
import { usePreviewReadingMode } from '../../atoms/preview-reading-mode'
```

- [ ] **Step 3: Read the hook inside `PreviewPanelContent`**

Find this block (currently around lines 91-94):

```ts
  // ── 注解 hook：无条件调用（React rules of hooks）──────────────────────────
  // previewFilePath 随 activeTab 变化；hook 内部 useMemo 保证引用稳定
  const previewFilePath = activeTab?.filePath ?? ''
  const [previewAnnotations, previewAnnoActions] = usePreviewAnnotations(sessionId, previewFilePath)
```

Add one line directly below it:

```ts
  // 阅读模式：全局视图开关，隐藏所有高亮批注（纯视觉，不影响追问发送）
  const [readingMode, toggleReadingMode] = usePreviewReadingMode()
```

- [ ] **Step 4: Add the Eye/EyeOff toggle button in the header**

In the header action group, find the refresh button (currently lines 379-385):

```tsx
              <button
                onClick={() => setRefreshNonce((n) => n + 1)}
                className="p-1 rounded-[6px] transition-colors text-muted-foreground/50 hover:text-foreground"
                title="Refresh (⌘R)"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>
```

Insert this block **immediately before** the refresh button (so order is: diff? → eye? → refresh → maximize):

```tsx
              {/* Reading mode — hide/show all highlight annotations for the
                 whole Preview panel. Non-destructive, global, not persisted.
                 Only rendered when there's something to hide (active tab has
                 highlights) or the mode is already on (so it can be turned
                 back off after switching to a highlight-free doc). */}
              {(previewAnnotations.length > 0 || readingMode) && (
                <button
                  onClick={toggleReadingMode}
                  className={`p-1 rounded-[6px] transition-colors ${
                    readingMode ? 'text-foreground bg-foreground/10' : 'text-muted-foreground/50 hover:text-foreground'
                  }`}
                  title={readingMode ? 'Show highlights' : 'Hide highlights'}
                >
                  {readingMode ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
```

- [ ] **Step 5: Gate the annotatable render on `!readingMode`**

Find the render condition (currently line 479):

```tsx
                {previewFilePath && sessionId ? (
```

Replace with:

```tsx
                {previewFilePath && sessionId && !readingMode ? (
```

This makes reading mode fall through to the existing plain `<Markdown mode="minimal" …>` branch (the `else` already present at lines 493-500) — clean body, zero highlights.

- [ ] **Step 6: Typecheck**

Run: `cd ~/Desktop/Projects/craft-agents-oss && bun run typecheck:electron`
Expected: PASS (exit 0, no errors).

- [ ] **Step 7: Update root `CLAUDE.md` Custom Modifications**

In the root `CLAUDE.md`, under the `## Custom Modifications` section, add a new `###` subsection after the "Preview Follow-up" entry. Insert exactly:

```markdown
### Preview Reading Mode — Hide/Show Highlights

An Eye/EyeOff toggle in the right-side Preview panel header hides/shows **all** highlight annotations for the whole panel (global, non-destructive, not persisted — resets to shown on restart). Reuses the panel's existing plain-`<Markdown>` render branch when on; decoupled from the follow-up send pipeline (hiding a noted highlight does not stop it sending — hide ≠ cancel). The toggle only appears when the active document has ≥1 highlight or the mode is already on.

**New files:**
- `apps/electron/src/renderer/atoms/preview-reading-mode.ts` — global `atom(false)` + `usePreviewReadingMode` hook

**Modified files:**
- `apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx` — header Eye/EyeOff button + `!readingMode` render gate

**Design/plan:** `docs/superpowers/specs/2026-07-08-preview-reading-mode-design.md`, `docs/superpowers/plans/2026-07-08-preview-reading-mode.md`

**Patching:** renderer-only → `bun run --filter '@craft-agent/electron' build:renderer` + `bash patch-app.sh`.
```

- [ ] **Step 8: Commit**

```bash
cd ~/Desktop/Projects/craft-agents-oss
git add apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx CLAUDE.md
git commit -m "feat(preview): hide/show highlights toggle in Preview header

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Verify in the running app, then ship

**Files:** none (verification + deploy only).

**Interfaces:** consumes the finished feature from Tasks 1-2.

- [ ] **Step 1: Launch dev mode (hot reload)**

Run: `cd ~/Desktop/Projects/craft-agents-oss && bun run electron:dev`
Expected: the app builds and opens; no console errors mentioning `preview-reading-mode` or `PreviewPanel`.

- [ ] **Step 2: Manual walkthrough (from the spec's Testing section)**

Confirm each, in order:
1. Open a `.md` with ≥1 highlight in the Preview panel (right-click a `.md` in the file tree → "Open in sidebar", or drag one in). → the Eye toggle appears in the header.
2. Click the Eye → highlights vanish, body renders as clean plain markdown; icon switches to EyeOff with the active (`bg-foreground/10`) style.
3. Click EyeOff → highlights return; icon back to Eye.
4. Open a second highlighted `.md` in another tab, turn reading mode on, switch tabs → the mode stays on for both (global switch).
5. With reading mode ON, switch to a `.md` that has no highlights → the toggle is still shown (because the mode is on) and can be turned back off.
6. Turn reading mode on with a noted-but-unsent highlight, type a message in the chat composer and send → the follow-up still sends (decoupling holds; check the sent message contains the quoted follow-up).
7. Quit and relaunch dev → reading mode is back to default (highlights shown).

If any check fails, stop and fix before shipping. Re-run `bun run typecheck:electron` after any fix.

- [ ] **Step 3: Build renderer + patch the installed app**

Only after all manual checks pass. Quit dev mode first, then:

```bash
cd ~/Desktop/Projects/craft-agents-oss
export all_proxy=socks5://127.0.0.1:7890
export https_proxy=http://127.0.0.1:7890
export http_proxy=http://127.0.0.1:7890
# quit the installed Craft Agents if running
osascript -e 'quit app "Craft Agents"' 2>/dev/null || true
bun run --filter '@craft-agent/electron' build:renderer
bash patch-app.sh
open -a "Craft Agents"
```

Expected: `build:renderer` succeeds (vite "✓ built"); `patch-app.sh` prints "=== Done! ==="; the app relaunches. Repeat check #1-2 once in the installed app to confirm the patched bundle carries the toggle.

- [ ] **Step 4: Finish the branch**

The work is on branch `feat/preview-reading-mode`. Use the superpowers:finishing-a-development-branch skill to decide merge vs PR vs cleanup (the repo's pattern is a `--no-ff` merge to `main` — mirror the existing "Merge feat/…" commits).

---

## Self-Review

**Spec coverage:**
- State = one global non-persisted `atom(false)` → Task 1. ✔
- `usePreviewReadingMode` hook → Task 1. ✔
- Eye/EyeOff header toggle, active-state styling, visibility gate (`annotations>0 || readingMode`), title text → Task 2 Step 4. ✔
- Render flips to plain Markdown when on → Task 2 Step 5. ✔
- Follow-up decoupling (no code touches the pipeline) → guaranteed by not modifying it; verified Task 3 Step 2 #6. ✔
- Not persisted, resets on restart → Task 1 (plain atom) + verified Task 3 Step 2 #7. ✔
- GEB docs (L3 header, atoms/CLAUDE.md, root CLAUDE.md) → Task 1 Steps 1-2 + Task 2 Step 7. ✔
- Edge cases (no tab, clean doc, mode-on-clean-doc, diff view) → covered by the visibility gate + the existing `activeTab &&` wrapper; diff is a no-op (its branch has no annotations). ✔

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every command has expected output. ✔

**Type consistency:** `previewReadingModeAtom` / `usePreviewReadingMode` / `[readingMode, toggleReadingMode]` used identically in Tasks 1 and 2. `previewAnnotations` (from the existing `usePreviewAnnotations`) reused for the visibility gate — already in scope at the button site. ✔
