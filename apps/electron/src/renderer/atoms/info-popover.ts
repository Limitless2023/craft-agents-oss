/**
 * info-popover — cross-component signal to open the floating Info popover.
 *
 * `infoPopoverOpenAtom` is the single source of truth for the popover's
 * visibility. AppShell owns the actual mount; consumers (e.g. PreviewPanel's
 * empty-state "Browse files" button) set this atom to true and the popover
 * opens anchored to the Info icon in the toolbar.
 *
 * Using an atom rather than passing a callback through context keeps the
 * Preview tree decoupled from AppShell's button render path.
 */

import { atom } from 'jotai'

export const infoPopoverOpenAtom = atom(false)
