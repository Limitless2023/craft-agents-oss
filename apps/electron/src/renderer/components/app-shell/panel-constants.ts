import { isMac } from '@/lib/platform'

/** Gap between any adjacent panels (sidebar ↔ navigator ↔ content ↔ right sidebar) */
export const PANEL_GAP = 6

/** Padding from window edges to outermost panels (right, bottom, left when sidebar hidden) */
export const PANEL_EDGE_INSET = 6

/** Corner radius for panel edges touching the window boundary (macOS native corners → larger) */
export const RADIUS_EDGE = isMac ? 14 : 8

/** Corner radius for interior corners between panels */
export const RADIUS_INNER = 10

/** Minimum width for any content panel */
export const PANEL_MIN_WIDTH = 440

/** Extra vertical space reserved in panel stack for box-shadows. */
export const PANEL_STACK_VERTICAL_OVERFLOW = 8

/**
 * Shared resize sash geometry.
 *
 * Keep all seams (sidebar, navigator/content, panel/panel) aligned by deriving
 * offsets from these constants instead of hardcoded pixel literals.
 */
// 14 px gives ~7 px of grab zone on each side of the visible seam. The
// previous 8 px (4 px each side) was easy to miss — modern IDEs use 12-16 px
// for resize handles. Visible line stays 2 px so the look is unchanged.
export const PANEL_SASH_HIT_WIDTH = 14
export const PANEL_SASH_LINE_WIDTH = 2

/**
 * When the sash is inserted between two flex items, flex gap would apply twice
 * (item↔sash and sash↔item). Pull it back by half the gap on both sides so
 * the visible distance remains exactly PANEL_GAP.
 */
export const PANEL_SASH_FLEX_MARGIN = -(PANEL_GAP / 2)

/** Half-width helper for centering sash containers on seam coordinates. */
export const PANEL_SASH_HALF_HIT_WIDTH = PANEL_SASH_HIT_WIDTH / 2
