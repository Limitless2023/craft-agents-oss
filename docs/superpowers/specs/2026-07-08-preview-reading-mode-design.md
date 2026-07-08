# Preview Reading Mode — Hide/Show Highlight Annotations — Design Spec

**Date:** 2026-07-08
**Status:** Approved (design), pending implementation
**Scope:** Small feature. Add a global "reading mode" toggle to the right-sidebar Preview panel that hides/shows all highlight annotations non-destructively.

## Motivation

The Preview panel's follow-up feature leaves **persistent highlights** (plus follow-up
notes) inline in the markdown. Once a document accumulates several highlights, they
clutter plain reading. Today the only way to remove a highlight is to delete it one at a
time — a **destructive** action that also drops any pending follow-up the highlight carries.

Users want to **temporarily collapse the highlights to read clean text**, then bring them
back — a non-destructive view toggle, not a delete.

## Existing terrain (reuse, do not rebuild)

- **Annotation store** — `atoms/preview-annotations.ts` + `-core.ts`: per-session,
  per-file `AnnotationV1[]` in `previewAnnotationsAtomFamily(sessionId)`, localStorage
  `craft-preview-annotations:<sessionId>`. **Untouched by this feature.**
- **Render branches** — `PreviewPanel.tsx:479-501` already forks:
  - has session+file → `<AnnotatableMarkdownDocument>` (highlights + can add new)
  - else → plain `<Markdown mode="minimal" onFileClick onUrlClick hideFirstMermaidExpand={false}>`
  The plain branch is exactly the clean, highlight-free reading view we want — **reading
  mode reuses it** (no new render code, no new prop on the shared UI component).
- **Header toolbar** — `PreviewPanel.tsx:363-400`: diff toggle / refresh / maximize /
  close, all inside `activeTab && (...)`. New toggle sits here.
- **Follow-up collection** — `collectPreviewPendingFollowUps` (core) reads the store
  directly; it never consults the view. So decoupling is automatic — no code needed to
  "keep sending while hidden."

## Design

### State — one global boolean

- A module-level `previewReadingModeAtom = atom(false)` (single global, **not** an
  atomFamily). One switch for the whole Preview panel: shared across tabs and sessions.
- **Not persisted.** Lives in a jotai atom only (no localStorage). App restart → back to
  default (`false` = highlights shown). Reading mode is a transient view preference, not a
  setting.

### UI — Eye/EyeOff toggle in the header

- Placement: header toolbar, alongside refresh / maximize.
- Icon: `Eye` (currently showing) → click → `EyeOff` (highlighted "active" state) → click → back.
- **Visibility gate:** render the toggle only when `previewAnnotations.length > 0 ||
  readingMode`. A clean document with no highlights shows no button; the moment the active
  tab has ≥1 highlight — or reading mode is currently on — the button appears (so it's
  always possible to turn the mode back off, even after switching to a highlight-free doc).
- `title`: showing → "Hide highlights"; hidden → "Show highlights". (English UI string;
  i18n key optional, follow existing header buttons which use literal `title=`.)

### Render — flip to the plain branch

```tsx
previewFilePath && sessionId && !readingMode
  ? <AnnotatableMarkdownDocument ... />   // normal: highlights + annotate
  : <Markdown mode="minimal" ... />        // reading mode: clean body, zero highlights
```

Toggling remounts `AnnotatableMarkdownDocument`; it re-derives highlight positions from
char offsets on mount — already its behavior on every content change. No new logic.

### Follow-up decoupling (confirmed with user)

Reading mode is **purely visual**. Hiding highlights does **not** affect follow-up
sending: `collectPreviewPendingFollowUps` reads the store, not the view. If the user hides
highlights and then sends a chat message, any noted-but-unsent follow-ups still fire.
Mental model: **hide ≠ cancel.** A view toggle must not reach into the send pipeline.

## Files

### New
- `apps/electron/src/renderer/atoms/preview-reading-mode.ts` (~15 lines)
  - `previewReadingModeAtom = atom(false)`
  - `usePreviewReadingMode(): readonly [boolean, () => void]` — value + toggle
  - L3 header comment; add member line to `atoms/CLAUDE.md`

### Modified
- `apps/electron/src/renderer/components/right-sidebar/PreviewPanel.tsx`
  - import `Eye, EyeOff` from `lucide-react`; import `usePreviewReadingMode`
  - read `[readingMode, toggleReadingMode]` in `PreviewPanelContent`
  - add the toggle button in the header (inside the existing `activeTab && (...)`, gated by
    the visibility rule above)
  - add `!readingMode` to the annotatable-vs-plain render condition (one clause)

No backend, no store-shape change, no protocol/IPC change.

## Edge cases

- **No active tab** → whole `activeTab && (...)` header block is absent → no toggle. ✔
- **Active tab, zero highlights, mode off** → toggle hidden (nothing to hide). ✔
- **Mode on, switch to a highlight-free tab** → toggle still shown (because `readingMode`
  is true) → user can switch it back off. ✔
- **Diff view (`showDiff`)** → the diff branch never renders `AnnotatableMarkdownDocument`,
  so it has no highlights anyway; reading mode is a no-op there. The eye toggle may still
  appear (gated on annotation count, independent of diff) — harmless; toggling just sets
  state for when the user returns to the normal render. Not worth special-casing.

## Testing

- Logic is a single boolean toggle — no dedicated unit test warranted.
- Manual verification (dev mode):
  1. Open a `.md` with ≥1 highlight in the Preview panel → eye toggle appears.
  2. Click → highlights vanish, body renders as clean plain markdown; icon shows EyeOff/active.
  3. Click again → highlights return.
  4. Switch tabs → the mode state is preserved (global).
  5. With a noted-but-unsent highlight hidden, send a chat message → the follow-up still
     sends (decoupling holds).
  6. Restart the app → mode is back to default (shown).

## Non-goals (YAGNI)

- **No bulk delete ("clear").** That's a separate destructive operation; explicitly out of
  scope for this feature (user chose hide over clear).
- **No per-document toggle state.** User chose one global switch.
- **No persistence** to localStorage or settings.
- **No changes** to `AnnotatableMarkdownDocument`, the annotation store, or the follow-up
  pipeline.
