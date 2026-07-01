# Cmd+R → Rename Current Conversation — Design Spec

**Date:** 2026-07-02
**Status:** Approved (design), pending implementation
**Scope:** Small feature. Add a `Cmd+R` keyboard shortcut that renames the currently-active conversation via the existing rename dialog.

## Motivation

The user renames freshly-created conversations very frequently. Today renaming requires
either right-click → Rename (context menu) or opening the session-info popover and editing
the title inline — both are multi-step and mouse-driven. A single global keystroke removes
that friction.

## Existing terrain (reuse, do not rebuild)

- **Rename handler** — `App.tsx:1194` `handleRenameSession(sessionId, name)`:
  optimistic `updateSessionById` + `window.electronAPI.sessionCommand(id, { type: 'rename', name })`.
  Already the single source of truth for renaming; server persists + broadcasts `title_generated`.
- **Rename dialog** — `components/ui/rename-dialog.tsx` `RenameDialog`: fully *controlled*
  (`open / onOpenChange / title / value / onValueChange / onSubmit / placeholder?`).
  Enter submits; `useRegisterModal` wires Esc / Cmd+W / X to close.
- **Shortcut registry** — `renderer/actions/`. Declare actions in `actions/definitions.ts`
  (`{ id, label, defaultHotkey: 'mod+r', category }`); attach handlers with
  `useAction(id, handler, { enabled }, deps)`. A single capture-phase document `keydown`
  listener (`actions/registry.tsx`) matches the hotkey, calls `preventDefault()` +
  `stopPropagation()`, then runs the first enabled handler.
- **Current session** — `sessionSelection.selected` (`App.tsx:690`) is the conversation shown
  in the main content area; its meta (`name`) comes from `sessionAtomFamily` / `sessionMetaMapAtom`.

## Cmd+R conflict — resolved

- **Packaged build:** Cmd+R is unbound (no-op). Zero conflict.
- **Dev build only:** `main/menu.ts:146-159` binds `CmdOrCtrl+R` to `webContents.reload()`
  (inside the `!app.isPackaged` block). The registry's capture-phase `preventDefault()`
  overrides it — the same mechanism the preview-overlay Cmd+R handler (`App.tsx:1716-1743`)
  already uses successfully to suppress dev reload.
- **`Cmd+Shift+R` (force reload, dev only) stays intact:** `mod+n` and `mod+shift+n` coexist
  correctly in the registry today, proving `matchesHotkey` distinguishes the Shift modifier.
  `mod+r` therefore never matches `Cmd+Shift+R`.

## Design

### 1. New action — `actions/definitions.ts`

Add under the **General** category, adjacent to `app.newChat`:

```ts
'app.renameChat': {
  id: 'app.renameChat',
  label: 'Rename Chat',
  description: 'Rename the current conversation',
  defaultHotkey: 'mod+r',
  category: 'General',
},
```

No `when` clause: unlike `Cmd+A` / `Cmd+←`, `Cmd+R` has no text-editing meaning inside inputs,
so it should fire even while the chat input is focused (rename-right-after-typing is the common
flow). Availability is gated by the handler's `enabled` guard instead.

### 2. New component — `components/app-shell/RenameSessionShortcut.tsx`

A single-purpose, always-mounted component (rendered inside `<ActionRegistryProvider>` in
`App.tsx`'s subtree — NOT inside the collapsible sidebar, so a hidden navigator can't kill it).

Props (passed from `App`, avoids guessing which atom is authoritative):
- `currentSessionId: string | null`
- `currentName: string`
- `onRename: (sessionId: string, name: string) => void`  // = `handleRenameSession`

Behavior:
- Local state: `open: boolean`, `value: string`.
- `useAction('app.renameChat', openDialog, { enabled: !!currentSessionId }, [currentSessionId, currentName])`
  where `openDialog` seeds `value` with `currentName` and sets `open = true`.
- Renders `<RenameDialog open value onValueChange title={t('common.rename')} onSubmit={submit} onOpenChange={setOpen} />`.
- `submit`: if `currentSessionId` and trimmed `value` non-empty → `onRename(currentSessionId, value.trim())`, then close.

### 3. Surface in the shortcuts reference

`KeyboardShortcutsDialog.tsx:45` currently hardcodes a **never-implemented** bare
`R → renameSession` entry. Update the shortcuts reference to show `Cmd+R → Rename Chat` and
remove the stale bare-`R` entry. If a newer shortcuts page reads `actionsByCategory` from
`definitions.ts` (the file exports `actionList` "for shortcuts page"), the new action appears
automatically — in that case just delete the stale hardcode.

### 4. GEB documentation sync

- L3 header on the new `RenameSessionShortcut.tsx`.
- Update `components/app-shell/CLAUDE.md` (L2) member list.
- Add a "Cmd+R Rename Conversation" entry to the repo-root `CLAUDE.md` Custom Modifications section.

## Explicitly out of scope (YAGNI)

- No batch/multi-select rename.
- No change to SessionList's existing right-click rename dialog (it serves list items; the
  shortcut reuses the same `RenameDialog` component but owns its own instance/state).
- No auto-select-all of the input text (matches the existing dialog's focus behavior).

## Acceptance criteria

1. Packaged build: `Cmd+R` opens the rename dialog pre-filled with the current conversation's
   title; Enter renames; Esc cancels. Title updates in sidebar + main view.
2. Dev build: `Cmd+R` renames (does **not** reload the window); `Cmd+Shift+R` still force-reloads.
3. With no active conversation, `Cmd+R` is a no-op (handler disabled).
4. `typecheck:all` passes; shortcuts reference shows the new binding and no longer shows the
   stale bare-`R` entry.
