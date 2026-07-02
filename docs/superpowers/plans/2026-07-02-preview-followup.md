# Preview Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the right-side Preview panel the same follow-up feature as chat — select text in a previewed `.md` file, attach a note (persistent highlight), and have it sent to the agent with the next message, referencing the file by name.

**Architecture:** Reuse the existing `AnnotatableMarkdownDocument` renderer (selection→chip→island→highlight) in `PreviewPanel`, using the file path as the annotation `messageId`. Persist preview annotations in a new renderer-side jotai atomFamily (localStorage, mirroring `sidebar-docs.ts`) — NOT the backend `sessionCommand` (which rejects non-message annotations). Merge preview follow-ups into ChatDisplay's existing pending-collection + submit path (`formatFollowUpSection` + `onSendMessage`), tagging preview items with a file-name label.

**Tech Stack:** React + jotai (atomFamily + localStorage), `@craft-agent/core` `AnnotationV1`, `@craft-agent/ui` (`AnnotatableMarkdownDocument`, follow-up helpers), `bun test`.

## Global Constraints

- **Renderer-only.** No backend/`sessionCommand`/channels changes. Patch = `build:renderer` + `patch-app.sh`.
- Preview annotation identity: **`messageId` = the file's absolute path**; `sessionId` = focused session.
- Persistence: jotai atomFamily keyed by sessionId, localStorage key `craft-preview-annotations:<sessionId>`, value = `Record<filePath, AnnotationV1[]>`. Mirror `apps/electron/src/renderer/atoms/sidebar-docs.ts` exactly (loadPersisted/persistState + value-or-updater setter). Empty map removes the key.
- "Follow-up sent" is derived (never a boolean flag): an annotation is sent iff `meta.followUp.lastSentAt` is a number AND `meta.followUp.lastSentText` (trimmed) === current note text (trimmed). Marking sent = writing `meta.followUp.{text,lastSentAt,lastSentText}`.
- Selected text is read from the annotation itself via `extractAnnotationSelectedText(annotation, '')` (it lives in `target.selectors[].text-quote.exact`).
- Reuse helpers from `@craft-agent/ui/annotations/follow-up-state`: `getAnnotationNoteText`, `isAnnotationFollowUpSent`, `asRecord`, `normalizeFollowUpText`; and `extractAnnotationSelectedText` from `@craft-agent/ui`.
- New files carry GEB L3 headers; new test files too. Comments 中文 + ASCII 分块.
- Test runner `bun test` (import from `'bun:test'`). No React component test infra — UI wiring verified by `bun run typecheck` + manual.

**New module dir:** `apps/electron/src/renderer/atoms/` (existing) for the store; edits in `right-sidebar/` + `app-shell/`.

---

### Task 1: Preview annotations pure core (TDD)

**Files:**
- Create: `apps/electron/src/renderer/atoms/preview-annotations-core.ts`
- Test: `apps/electron/src/renderer/atoms/preview-annotations-core.test.ts`

**Interfaces:**
- Produces:
  - `type PreviewAnnotationsMap = Record<string, AnnotationV1[]>` (key = filePath)
  - `addPreviewAnnotation(map, filePath, ann): PreviewAnnotationsMap`
  - `removePreviewAnnotation(map, filePath, annId): PreviewAnnotationsMap`
  - `updatePreviewAnnotation(map, filePath, annId, patch: Partial<AnnotationV1>): PreviewAnnotationsMap`
  - `markPreviewFollowUpSent(map, filePath, annId, note, sentAt): PreviewAnnotationsMap`
  - `collectPreviewPendingFollowUps(map): Array<{ filePath: string; annotation: AnnotationV1 }>`

- [ ] **Step 1: Write the failing test**

Create `apps/electron/src/renderer/atoms/preview-annotations-core.test.ts`:

```ts
/**
 * [INPUT]: 依赖 ./preview-annotations-core 的全部导出；@craft-agent/core 的 AnnotationV1
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: preview 标注纯 reducer 的回归测试；bun test 直接运行，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import type { AnnotationV1 } from '@craft-agent/core'
import {
  addPreviewAnnotation,
  removePreviewAnnotation,
  updatePreviewAnnotation,
  markPreviewFollowUpSent,
  collectPreviewPendingFollowUps,
  type PreviewAnnotationsMap,
} from './preview-annotations-core'

function mkAnn(id: string, note: string): AnnotationV1 {
  return {
    id,
    schemaVersion: 1,
    createdAt: 1,
    intent: 'comment',
    body: [{ type: 'highlight' }, { type: 'note', text: note, format: 'plain' }],
    target: {
      source: { sessionId: 's', messageId: '/a.md' },
      selectors: [
        { type: 'text-position', start: 0, end: 4 },
        { type: 'text-quote', exact: 'quote', prefix: '', suffix: '' },
      ],
    },
    style: { color: 'yellow' },
    meta: { followUp: { text: note, createdAt: 1 } },
  }
}

test('add appends under the file path', () => {
  const m = addPreviewAnnotation({}, '/a.md', mkAnn('a1', 'note1'))
  expect(m['/a.md'].map(a => a.id)).toEqual(['a1'])
})

test('remove drops only the matching id, prunes empty file key', () => {
  let m: PreviewAnnotationsMap = addPreviewAnnotation({}, '/a.md', mkAnn('a1', 'n'))
  m = removePreviewAnnotation(m, '/a.md', 'a1')
  expect(m['/a.md']).toBeUndefined()
})

test('update shallow-merges the patch onto the matching annotation', () => {
  let m = addPreviewAnnotation({}, '/a.md', mkAnn('a1', 'n'))
  m = updatePreviewAnnotation(m, '/a.md', 'a1', { style: { color: 'blue' } })
  expect(m['/a.md'][0].style?.color).toBe('blue')
})

test('collectPending returns notes not yet sent, tagged with filePath', () => {
  const m = addPreviewAnnotation({}, '/a.md', mkAnn('a1', 'ask this'))
  const pending = collectPreviewPendingFollowUps(m)
  expect(pending).toEqual([{ filePath: '/a.md', annotation: m['/a.md'][0] }])
})

test('markFollowUpSent removes the item from pending (sent text matches note)', () => {
  let m = addPreviewAnnotation({}, '/a.md', mkAnn('a1', 'ask this'))
  m = markPreviewFollowUpSent(m, '/a.md', 'a1', 'ask this', 999)
  expect(m['/a.md'][0].meta).toBeDefined()
  expect(collectPreviewPendingFollowUps(m)).toEqual([])
})

test('annotation with no note is never pending', () => {
  const noteless = mkAnn('a1', '')
  noteless.body = [{ type: 'highlight' }]
  noteless.meta = undefined
  const m = addPreviewAnnotation({}, '/a.md', noteless)
  expect(collectPreviewPendingFollowUps(m)).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/electron/src/renderer/atoms/preview-annotations-core.test.ts`
Expected: FAIL — cannot resolve `./preview-annotations-core`.

- [ ] **Step 3: Implement the core**

Create `apps/electron/src/renderer/atoms/preview-annotations-core.ts`:

```ts
/**
 * [INPUT]: 依赖 @craft-agent/core 的 AnnotationV1；@craft-agent/ui/annotations/follow-up-state 的 getAnnotationNoteText/isAnnotationFollowUpSent/asRecord
 * [OUTPUT]: PreviewAnnotationsMap 类型 + add/remove/update/markFollowUpSent/collectPending 纯 reducers
 * [POS]: preview 标注 store 的纯逻辑内核（按 filePath 分组）；无 DOM/jotai，bun test 覆盖；被 preview-annotations.ts 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AnnotationV1 } from '@craft-agent/core'
import {
  getAnnotationNoteText,
  isAnnotationFollowUpSent,
  asRecord,
} from '@craft-agent/ui/annotations/follow-up-state'

// filePath -> 该文件的标注列表
export type PreviewAnnotationsMap = Record<string, AnnotationV1[]>

export function addPreviewAnnotation(
  map: PreviewAnnotationsMap,
  filePath: string,
  ann: AnnotationV1,
): PreviewAnnotationsMap {
  const list = map[filePath] ?? []
  return { ...map, [filePath]: [...list, ann] }
}

export function removePreviewAnnotation(
  map: PreviewAnnotationsMap,
  filePath: string,
  annId: string,
): PreviewAnnotationsMap {
  const list = map[filePath]
  if (!list) return map
  const next = list.filter(a => a.id !== annId)
  const copy = { ...map }
  if (next.length === 0) delete copy[filePath]
  else copy[filePath] = next
  return copy
}

export function updatePreviewAnnotation(
  map: PreviewAnnotationsMap,
  filePath: string,
  annId: string,
  patch: Partial<AnnotationV1>,
): PreviewAnnotationsMap {
  const list = map[filePath]
  if (!list) return map
  return {
    ...map,
    [filePath]: list.map(a =>
      a.id === annId ? { ...a, ...patch, updatedAt: Date.now() } : a,
    ),
  }
}

// 标记已发送：写 meta.followUp.{text,lastSentAt,lastSentText}（与聊天 handleSubmit 一致）
export function markPreviewFollowUpSent(
  map: PreviewAnnotationsMap,
  filePath: string,
  annId: string,
  note: string,
  sentAt: number,
): PreviewAnnotationsMap {
  const list = map[filePath]
  if (!list) return map
  return {
    ...map,
    [filePath]: list.map(a => {
      if (a.id !== annId) return a
      const currentMeta = asRecord(a.meta) ?? {}
      const currentFollowUp = asRecord(currentMeta.followUp) ?? {}
      return {
        ...a,
        meta: {
          ...currentMeta,
          followUp: { ...currentFollowUp, text: note, lastSentAt: sentAt, lastSentText: note },
        },
      }
    }),
  }
}

// 收集有备注且未发送的标注（供输入框 pending）
export function collectPreviewPendingFollowUps(
  map: PreviewAnnotationsMap,
): Array<{ filePath: string; annotation: AnnotationV1 }> {
  const out: Array<{ filePath: string; annotation: AnnotationV1 }> = []
  for (const [filePath, list] of Object.entries(map)) {
    for (const annotation of list) {
      if (!getAnnotationNoteText(annotation)) continue
      if (isAnnotationFollowUpSent(annotation)) continue
      out.push({ filePath, annotation })
    }
  }
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/electron/src/renderer/atoms/preview-annotations-core.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Typecheck + commit**

Run: `bun run --filter '@craft-agent/electron' typecheck` — expect clean (or note unrelated pre-existing errors only).

```bash
git add apps/electron/src/renderer/atoms/preview-annotations-core.ts apps/electron/src/renderer/atoms/preview-annotations-core.test.ts
git commit -m "feat(preview-followup): pure core for preview annotation store"
```

---

### Task 2: Preview annotations jotai store + hooks

**Files:**
- Create: `apps/electron/src/renderer/atoms/preview-annotations.ts`

**Interfaces:**
- Consumes: Task 1 core (`PreviewAnnotationsMap`, add/remove/update/markFollowUpSent/collectPreviewPendingFollowUps).
- Produces:
  - `previewAnnotationsAtomFamily(sessionId): WritableAtom<PreviewAnnotationsMap, ...>`
  - `usePreviewAnnotations(sessionId, filePath): [AnnotationV1[], { add: (messageId, ann) => void; remove: (messageId, annId) => void; update: (messageId, annId, patch) => void }]` — the add/remove/update signatures match `AnnotatableMarkdownDocument`'s `onAddAnnotation(messageId, ann)` etc. (messageId === filePath).
  - `usePreviewPendingFollowUps(sessionId): Array<{ filePath: string; annotation: AnnotationV1 }>`
  - `useMarkPreviewFollowUpsSent(sessionId): (items: Array<{ filePath: string; annotationId: string; note: string }>, sentAt: number) => void`

- [ ] **Step 1: Implement the store (mirrors sidebar-docs.ts)**

Create `apps/electron/src/renderer/atoms/preview-annotations.ts`:

```ts
/**
 * [INPUT]: 依赖 jotai(atom/atomFamily/useAtom)、./preview-annotations-core 的纯 reducers、@craft-agent/core 的 AnnotationV1
 * [OUTPUT]: previewAnnotationsAtomFamily + hooks（usePreviewAnnotations/usePreviewPendingFollowUps/useMarkPreviewFollowUpsSent）
 * [POS]: preview follow-up 的会话级持久化（localStorage `craft-preview-annotations:<sessionId>`）；PreviewPanel 写、ChatDisplay 读；仿 sidebar-docs.ts
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { atom, useAtom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { useMemo, useCallback } from 'react'
import type { AnnotationV1 } from '@craft-agent/core'
import {
  addPreviewAnnotation,
  removePreviewAnnotation,
  updatePreviewAnnotation,
  markPreviewFollowUpSent,
  collectPreviewPendingFollowUps,
  type PreviewAnnotationsMap,
} from './preview-annotations-core'

const STORAGE_KEY_PREFIX = 'craft-preview-annotations:'
const EMPTY: PreviewAnnotationsMap = {}

function loadPersisted(sessionId: string): PreviewAnnotationsMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + sessionId)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : EMPTY
  } catch {
    return EMPTY
  }
}

function persistState(sessionId: string, state: PreviewAnnotationsMap): void {
  try {
    if (Object.keys(state).length === 0) localStorage.removeItem(STORAGE_KEY_PREFIX + sessionId)
    else localStorage.setItem(STORAGE_KEY_PREFIX + sessionId, JSON.stringify(state))
  } catch {
    // ignore (quota etc.)
  }
}

export const previewAnnotationsAtomFamily = atomFamily((sessionId: string) => {
  const baseAtom = atom<PreviewAnnotationsMap>(loadPersisted(sessionId))
  return atom(
    (get) => get(baseAtom),
    (get, set, update: PreviewAnnotationsMap | ((prev: PreviewAnnotationsMap) => PreviewAnnotationsMap)) => {
      const prev = get(baseAtom)
      const next = typeof update === 'function' ? update(prev) : update
      set(baseAtom, next)
      persistState(sessionId, next)
    },
  )
})

export function usePreviewAnnotations(sessionId: string, filePath: string) {
  const [map, setMap] = useAtom(previewAnnotationsAtomFamily(sessionId))
  const annotations = useMemo(() => map[filePath] ?? [], [map, filePath])
  // 回调签名对齐 AnnotatableMarkdownDocument：第一个参数是 messageId(===filePath)
  const add = useCallback((_messageId: string, ann: AnnotationV1) =>
    setMap(prev => addPreviewAnnotation(prev, filePath, ann)), [setMap, filePath])
  const remove = useCallback((_messageId: string, annId: string) =>
    setMap(prev => removePreviewAnnotation(prev, filePath, annId)), [setMap, filePath])
  const update = useCallback((_messageId: string, annId: string, patch: Partial<AnnotationV1>) =>
    setMap(prev => updatePreviewAnnotation(prev, filePath, annId, patch)), [setMap, filePath])
  return [annotations, { add, remove, update }] as const
}

export function usePreviewPendingFollowUps(sessionId: string) {
  const [map] = useAtom(previewAnnotationsAtomFamily(sessionId))
  return useMemo(() => collectPreviewPendingFollowUps(map), [map])
}

export function useMarkPreviewFollowUpsSent(sessionId: string) {
  const [, setMap] = useAtom(previewAnnotationsAtomFamily(sessionId))
  return useCallback(
    (items: Array<{ filePath: string; annotationId: string; note: string }>, sentAt: number) => {
      if (items.length === 0) return
      setMap(prev => items.reduce(
        (acc, it) => markPreviewFollowUpSent(acc, it.filePath, it.annotationId, it.note, sentAt),
        prev,
      ))
    },
    [setMap],
  )
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `bun run --filter '@craft-agent/electron' typecheck` — expect clean.
Note: if `@craft-agent/ui/annotations/follow-up-state` subpath import (used in Task 1) fails to resolve, confirm the same import style already works in `app-shell/ChatDisplay.follow-ups.ts` (it imports `normalizeFollowUpText` from that exact path) — mirror it.

```bash
git add apps/electron/src/renderer/atoms/preview-annotations.ts
git commit -m "feat(preview-followup): jotai store + hooks for preview annotations"
```

---

### Task 3: Wire AnnotatableMarkdownDocument into PreviewPanel

**Files:**
- Modify: `apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx` (imports; the non-diff render block ~lines 471-482)

**Interfaces:**
- Consumes: `usePreviewAnnotations` (Task 2); `AnnotatableMarkdownDocument` from `@craft-agent/ui`.
- Produces: selecting text in a preview file shows the ↳Follow-up island + persistent highlights.

- [ ] **Step 1: Add imports**

In `PreviewPanel.tsx`, add `AnnotatableMarkdownDocument` to the existing `@craft-agent/ui` import (currently `import { Markdown, UnifiedDiffViewer } from '@craft-agent/ui'`) → `import { Markdown, UnifiedDiffViewer, AnnotatableMarkdownDocument } from '@craft-agent/ui'`. Add: `import { usePreviewAnnotations } from '../../atoms/preview-annotations'`.

- [ ] **Step 2: Read annotations for the active file**

Inside `PreviewPanelContent` (which has `sessionId` prop and `activeTab`), near where `content` is resolved, add:
```tsx
  const previewFilePath = activeTab?.filePath ?? ''
  const [previewAnnotations, previewAnnoActions] = usePreviewAnnotations(sessionId ?? '', previewFilePath)
```
(Hooks must be called unconditionally at the top level of the component — place this with the other hooks, not inside a conditional. `sessionId`/`activeTab` are already in scope there.)

- [ ] **Step 3: Swap the renderer in the non-diff branch**

Replace the existing non-diff `<Markdown>` block (currently:
```tsx
{!isLoading && !showDiff && (
  <div className="text-sm">
    <Markdown mode="minimal" onFileClick={onOpenFile} onUrlClick={(url) => window.electronAPI.openUrl(url)} hideFirstMermaidExpand={false}>
      {content}
    </Markdown>
  </div>
)}
```
) with:
```tsx
{!isLoading && !showDiff && (
  <div className="text-sm">
    {previewFilePath && sessionId ? (
      <AnnotatableMarkdownDocument
        content={content}
        messageId={previewFilePath}
        sessionId={sessionId}
        annotations={previewAnnotations}
        onAddAnnotation={previewAnnoActions.add}
        onRemoveAnnotation={previewAnnoActions.remove}
        onUpdateAnnotation={previewAnnoActions.update}
        onOpenUrl={(url) => window.electronAPI.openUrl(url)}
        onOpenFile={onOpenFile}
        islandZIndex={420}
      />
    ) : (
      <Markdown mode="minimal" onFileClick={onOpenFile} onUrlClick={(url) => window.electronAPI.openUrl(url)} hideFirstMermaidExpand={false}>
        {content}
      </Markdown>
    )}
  </div>
)}
```
(Keep the exact prop names/values from the current `<Markdown>` for the fallback. Adjust `content`/`isLoading`/`showDiff`/`onOpenFile` to the actual in-scope identifiers if they differ.)

- [ ] **Step 4: Typecheck**

Run: `bun run --filter '@craft-agent/electron' typecheck` — expect clean.

- [ ] **Step 5: Manual verification**

`bun run --filter '@craft-agent/electron' build:renderer`, reload. Open a `.md` in the Preview panel → select text → the ↳Follow-up chip appears → add a note → a numbered highlight persists (still there after closing/reopening the tab). (Sending is Task 5.)

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx
git commit -m "feat(preview-followup): annotatable markdown + persistent highlights in Preview panel"
```

---

### Task 4: file-name label in the follow-up section (TDD)

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.ts` (`PendingFollowUpAnnotation` type ~21-29; `formatFollowUpSection` ~48-66)
- Test: `apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.test.ts` (create if absent, else extend)

**Interfaces:**
- Produces: `PendingFollowUpAnnotation` gains optional `sourceLabel?: string` and `previewFilePath?: string`. `formatFollowUpSection` prefixes the quote with `(sourceLabel) ` when present.

- [ ] **Step 1: Write the failing test**

Create/extend `apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.test.ts`:

```ts
/**
 * [INPUT]: 依赖 ./ChatDisplay.follow-ups 的 formatFollowUpSection + 类型
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: follow-up 拼接纯逻辑回归；bun test，无 DOM
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import { formatFollowUpSection, type PendingFollowUpAnnotation } from './ChatDisplay.follow-ups'

const base = (over: Partial<PendingFollowUpAnnotation>): PendingFollowUpAnnotation => ({
  messageId: 'm1', annotationId: 'a1', note: 'do X', selectedText: 'the passage', createdAt: 1, ...over,
})

test('chat item (no sourceLabel) is unchanged', () => {
  const out = formatFollowUpSection([base({})], { includeTopSeparator: false })
  expect(out).toContain('> [#1] the passage')
  expect(out).toContain('→ do X')
  expect(out).not.toContain('(')
})

test('preview item prefixes the quote with (fileName)', () => {
  const out = formatFollowUpSection([base({ sourceLabel: 'report.md' })], { includeTopSeparator: false })
  expect(out).toContain('> [#1] (report.md) the passage')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `bun test apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.test.ts`
Expected: FAIL — `sourceLabel` not on type / not rendered.

- [ ] **Step 3: Extend the type + formatter**

In `ChatDisplay.follow-ups.ts`, extend the type (append two optional fields):
```ts
export type PendingFollowUpAnnotation = {
  messageId: string
  annotationId: string
  note: string
  selectedText: string
  createdAt: number
  color?: string
  meta?: Record<string, unknown>
  /** Preview follow-ups only: the source doc's display name, prefixed onto the quote. */
  sourceLabel?: string
  /** Preview follow-ups only: absolute file path (routes "mark sent" to the preview store). */
  previewFilePath?: string
}
```
In `formatFollowUpSection`, change the `items.map` quote line to include the label:
```ts
  const items = followUps.map((followUp, idx) => {
    const quoteText = normalizeFollowUpText(followUp.selectedText)
    const labelled = followUp.sourceLabel ? `(${followUp.sourceLabel}) ${quoteText}` : quoteText
    return [
      `> [#${idx + 1}] ${labelled}`,
      `→ ${followUp.note}`,
    ].join('\n')
  })
```

- [ ] **Step 4: Run to verify it passes**

Run: `bun test apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.test.ts`
Expected: PASS (both tests; plus any pre-existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.ts apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.test.ts
git commit -m "feat(preview-followup): optional file-name label in follow-up section"
```

---

### Task 5: Merge preview follow-ups into ChatDisplay pending + submit

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` (imports; `pendingFollowUpAnnotations` useMemo ~1083-1110; `handleSubmit` mark-sent ~1266-1296)

**Interfaces:**
- Consumes: `usePreviewPendingFollowUps`, `useMarkPreviewFollowUpsSent` (Task 2); `extractAnnotationSelectedText`, `getAnnotationNoteText`, `asRecord` (already imported from `@craft-agent/ui`); `PendingFollowUpAnnotation.sourceLabel/previewFilePath` (Task 4).
- Produces: preview follow-ups appear as composer chips and are sent + marked-sent with the next message, labeled by file name.

- [ ] **Step 1: Add imports + hooks**

Add near the other renderer imports:
```ts
import { usePreviewPendingFollowUps, useMarkPreviewFollowUpsSent } from '../../atoms/preview-annotations'
```
Inside the component body (top level, with other hooks), add:
```ts
  const previewPendingRaw = usePreviewPendingFollowUps(session?.id ?? '')
  const markPreviewFollowUpsSent = useMarkPreviewFollowUpsSent(session?.id ?? '')
  const basename = (p: string) => p.split('/').pop() || p
```

- [ ] **Step 2: Merge preview items into `pendingFollowUpAnnotations`**

Change the `pendingFollowUpAnnotations` useMemo to also fold in preview items. Replace its `return pending.sort(...)` tail so the memo builds message items (unchanged) then concatenates mapped preview items, and add `previewPendingRaw` to the deps:
```tsx
    for (const { filePath, annotation } of previewPendingRaw) {
      const note = getAnnotationNoteText(annotation)
      if (!note) continue
      pending.push({
        messageId: filePath,               // filePath 充当 messageId
        annotationId: annotation.id,
        note,
        selectedText: extractAnnotationSelectedText(annotation, ''),  // exact 自带，不需原文
        createdAt: annotation.updatedAt ?? annotation.createdAt,
        color: annotation.style?.color,
        meta: asRecord(annotation.meta) ?? undefined,
        sourceLabel: basename(filePath),
        previewFilePath: filePath,
      })
    }

    return pending.sort((a, b) => a.createdAt - b.createdAt)
  }, [session?.messages, previewPendingRaw])
```
(The message-scanning loop above it is unchanged; just insert this block before the final `return ... sort` and extend the deps array.)

- [ ] **Step 3: Route "mark sent" for preview items in `handleSubmit`**

In `handleSubmit`, the existing block marks sent via `sessionCommand updateAnnotation` for every pending item. Split it so preview items go to the store instead. Replace the `if (session && pendingFollowUpAnnotations.length > 0) { ... }` block's body: keep the existing `Promise.all(...sessionCommand...)` but iterate only message items, and add a store call for preview items:
```tsx
    if (session && pendingFollowUpAnnotations.length > 0) {
      const sentAt = Date.now()
      const messageItems = pendingFollowUpAnnotations.filter(f => !f.previewFilePath)
      const previewItems = pendingFollowUpAnnotations.filter(f => f.previewFilePath)

      // preview follow-ups → 渲染层 store（无会话消息可挂）
      markPreviewFollowUpsSent(
        previewItems.map(f => ({ filePath: f.previewFilePath!, annotationId: f.annotationId, note: f.note })),
        sentAt,
      )

      // message follow-ups → 既有后端标注（不变）
      void Promise.all(messageItems.map((followUp) => {
        const currentMeta = followUp.meta ?? {}
        const currentFollowUpMeta = asRecord(currentMeta.followUp) ?? {}
        return window.electronAPI.sessionCommand(session.id, {
          type: 'updateAnnotation',
          messageId: followUp.messageId,
          annotationId: followUp.annotationId,
          patch: { meta: { ...currentMeta, followUp: { ...currentFollowUpMeta, text: followUp.note, lastSentAt: sentAt, lastSentText: followUp.note } } },
        })
      })).catch((error) => {
        console.error('[ChatDisplay] Failed to mark follow-up annotations as sent:', error)
      })
    }
```
(The compose lines above — `formatFollowUpSection(pendingFollowUpAnnotations, ...)` + `onSendMessage` — are unchanged; preview items flow through them automatically and now carry `sourceLabel`.)

- [ ] **Step 4: Typecheck**

Run: `bun run --filter '@craft-agent/electron' typecheck` — expect clean.

- [ ] **Step 5: Manual verification (end-to-end)**

`bun run --filter '@craft-agent/electron' build:renderer`, reload. In a session with the Preview panel open on a `.md`:
1. Select text → add a follow-up note → highlight appears in the preview.
2. A pending follow-up chip appears in the chat composer (same place as chat follow-ups).
3. Type a message (or none) and send → the sent message contains a **Follow-ups** section with `> [#1] (file.md) …\n→ your note`.
4. After sending, the preview highlight is marked sent (chip disappears from composer); editing the note re-arms it.
5. Close the preview tab with a pending follow-up → chip still present and still sends.

- [ ] **Step 6: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx
git commit -m "feat(preview-followup): send preview follow-ups with next message (file-labeled), mark sent in store"
```

---

### Task 6: Docs (GEB L2/L3 + repo CLAUDE.md)

**Files:**
- Modify: `apps/electron/src/renderer/atoms/CLAUDE.md` (if exists — add the two new files; if absent, create a minimal L2)
- Modify: `CLAUDE.md` (repo root — add a "Preview Follow-up" note under Custom Modifications)

- [ ] **Step 1: Update/create the atoms L2**

If `apps/electron/src/renderer/atoms/CLAUDE.md` exists, add member lines for `preview-annotations-core.ts`(+test) and `preview-annotations.ts`. If it does not exist, create a minimal L2 listing the folder's atom modules (at least the two new ones) with the `> L2 | 父级: ../../CLAUDE.md` header and the `[PROTOCOL]` footer line.

- [ ] **Step 2: Repo CLAUDE.md note**

Under `## Custom Modifications` in the repo root `CLAUDE.md`, add:
```markdown
### Preview Follow-up

Select text in the right-side Preview panel (`.md` files) → attach a note (persistent highlight) → it joins the chat composer's pending follow-ups and is sent with the next message, quote prefixed with the file name. Renderer-only: annotations persist in a jotai store (`craft-preview-annotations:<sessionId>`, keyed by file path used as a pseudo-messageId); reuses `AnnotatableMarkdownDocument` + `formatFollowUpSection`. Known limit: highlights anchor by char offset, so live agent edits to the file can drift them.
```

- [ ] **Step 3: Final check + commit**

Run: `bun test apps/electron/src/renderer/atoms/preview-annotations-core.test.ts apps/electron/src/renderer/components/app-shell/ChatDisplay.follow-ups.test.ts` → all green. `bun run --filter '@craft-agent/electron' typecheck` → clean.

```bash
git add apps/electron/src/renderer/atoms/CLAUDE.md CLAUDE.md
git commit -m "docs(preview-followup): atoms L2 + repo CLAUDE.md note"
```

---

## Notes for the implementer
- **bun-test resolution of the UI subpath (Tasks 1 & 4):** the core imports pure helpers from `@craft-agent/ui/annotations/follow-up-state` (the same subpath `ChatDisplay.follow-ups.ts` already uses, and that module is pure — it only imports the `AnnotationV1` *type*). First run the test as written. If `bun test` cannot resolve that subpath, try importing the same names from the `@craft-agent/ui` barrel. If the barrel drags React and breaks the test, **inline `asRecord` / `getAnnotationNoteText` / `isAnnotationFollowUpSent` verbatim from `packages/ui/src/components/annotations/follow-up-state.ts` into `preview-annotations-core.ts`** (copy exactly — the "sent" semantics MUST stay identical to chat's). Report which path you used.
- **Line numbers are approximate** (repo evolves) — locate anchors by surrounding code (the exact snippets quoted here are from the current tree).
- **Patch/run:** deploy via `bun run --filter '@craft-agent/electron' build:renderer` + `bash patch-app.sh` (renderer-only). `electron` typecheck can be slow; if it hangs >2 min with no output, note it and rely on the shared typecheck + the build.
- **Do not** route preview annotations through `window.electronAPI.sessionCommand` — the backend rejects annotations whose messageId isn't a real session message. Preview annotations live only in the jotai/localStorage store.
