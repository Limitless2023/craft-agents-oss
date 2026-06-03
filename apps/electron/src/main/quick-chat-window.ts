/**
 * quick-chat-window — the always-visible floating QuickChat window.
 *
 * Sits in the bottom-right corner of the primary display as a small
 * always-on-top, visible-on-all-workspaces panel. Two visual states,
 * managed entirely by the renderer:
 *   - "ball": a 60×60 round button. Default state.
 *   - "expanded": a 600×400 mini chat. Triggered by user click.
 *
 * The renderer resizes the parent window by calling
 * `electronAPI.resizeQuickChatWindow(w, h)` on state transitions; the main
 * process side just owns the BrowserWindow lifecycle here.
 *
 * Design notes:
 *   - macOS uses `type: 'panel'` so the window doesn't steal focus and
 *     doesn't appear in the dock or Mission Control. Side effect: it's
 *     still focusable when clicked (the chat needs an input).
 *   - `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` so
 *     it floats over full-screen apps and follows you across spaces.
 *   - We DON'T quit the app when this window closes — its lifecycle is
 *     bound to the main app process, not the other way around.
 *   - The window is created hidden and shown after `did-finish-load` so
 *     the user never sees a flash of unstyled ball.
 */

import { BrowserWindow, screen, app } from 'electron'
import { join } from 'path'

const BALL_WIDTH = 64
const BALL_HEIGHT = 64
const EDGE_MARGIN = 24

const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

let quickWindow: BrowserWindow | null = null

/** Compute the bottom-right anchor for the ball on the primary display. */
function getBottomRightPosition(width: number, height: number): { x: number; y: number } {
  const display = screen.getPrimaryDisplay()
  const workArea = display.workArea
  return {
    x: workArea.x + workArea.width - width - EDGE_MARGIN,
    y: workArea.y + workArea.height - height - EDGE_MARGIN,
  }
}

export function getQuickChatWindow(): BrowserWindow | null {
  return quickWindow && !quickWindow.isDestroyed() ? quickWindow : null
}

export function createQuickChatWindow(workspaceId: string): BrowserWindow {
  if (quickWindow && !quickWindow.isDestroyed()) {
    return quickWindow
  }

  const pos = getBottomRightPosition(BALL_WIDTH, BALL_HEIGHT)
  const isMac = process.platform === 'darwin'

  quickWindow = new BrowserWindow({
    width: BALL_WIDTH,
    height: BALL_HEIGHT,
    x: pos.x,
    y: pos.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // macOS: 'panel' makes the window not steal focus from the active app
    // when summoned, and keeps it out of the dock / Mission Control.
    ...(isMac && { type: 'panel' as const }),
    webPreferences: {
      preload: join(__dirname, 'bootstrap-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Float over full-screen apps and follow across spaces.
  quickWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // Highest level so it sits above other panels.
  quickWindow.setAlwaysOnTop(true, 'floating')

  // Load the SAME renderer bundle as the main window, but with a query flag
  // so App.tsx can branch into QuickChatApp instead of the full AppShell.
  const query: Record<string, string> = { workspaceId, quickChat: 'true' }
  if (VITE_DEV_SERVER_URL) {
    const params = new URLSearchParams(query).toString()
    quickWindow.loadURL(`${VITE_DEV_SERVER_URL}?${params}`)
  } else {
    quickWindow.loadFile(join(__dirname, 'renderer/index.html'), { query })
  }

  quickWindow.once('ready-to-show', () => {
    quickWindow?.show()
  })

  quickWindow.on('closed', () => {
    quickWindow = null
  })

  // Page-title-updated would clobber our blank title — same defense the
  // main window uses.
  quickWindow.on('page-title-updated', (event) => event.preventDefault())

  return quickWindow
}

/**
 * Resize the quick window in-place, keeping its bottom-right anchored to
 * the current position. The renderer calls this when switching between
 * ball ↔ expanded states.
 *
 * `animate: true` on macOS gives a smooth Apple-y transition.
 */
export function resizeQuickChatWindow(width: number, height: number): void {
  if (!quickWindow || quickWindow.isDestroyed()) return
  const bounds = quickWindow.getBounds()
  // Anchor bottom-right corner so the expand grows up + left
  const newX = bounds.x + bounds.width - width
  const newY = bounds.y + bounds.height - height
  quickWindow.setBounds({ x: newX, y: newY, width, height }, true)
}

/** Toggle visibility — called from the menu bar / dock menu later. */
export function toggleQuickChatVisible(): void {
  if (!quickWindow || quickWindow.isDestroyed()) return
  if (quickWindow.isVisible()) quickWindow.hide()
  else quickWindow.show()
}

/** Tear down when the app is quitting. */
export function destroyQuickChatWindow(): void {
  if (quickWindow && !quickWindow.isDestroyed()) {
    quickWindow.destroy()
  }
  quickWindow = null
}

// Hot-reload safety: ensure dev-mode reloads don't leak windows.
if (!app.isPackaged) {
  app.on('before-quit', destroyQuickChatWindow)
}
