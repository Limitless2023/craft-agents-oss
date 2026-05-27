/**
 * useLinkInterceptor - Centralized hook for intercepting file/URL open requests.
 *
 * Replaces the old handleOpenFile/handleOpenUrl in App.tsx that always opened externally.
 * Now classifies file types and decides whether to show an in-app preview overlay
 * or fall back to opening in the default external application.
 *
 * Architecture:
 *   Markdown click → PlatformContext → App.tsx → useLinkInterceptor
 *     ├── canPreview? → set previewState (renders overlay in App.tsx)
 *     └── can't preview? → electronAPI.openFile (opens externally)
 *
 * Uses refs for options to keep returned callbacks referentially stable,
 * preventing unnecessary re-renders of consumers (AppShellContext, PlatformProvider).
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { classifyFile, shouldRevealInFinder, type FilePreviewType } from '@craft-agent/ui'
import { getLanguageFromPath } from '@/lib/file-utils'

// ── Preview state types ────────────────────────────────────────────────────────
// Each variant carries the data needed to render its specific overlay.
// For text-based files (code, markdown, json, text), content starts as null
// while the file is being read, then gets populated.

// `refreshNonce` is bumped by refreshPreview() and used as a React `key` on the
// image/PDF overlays so they fully remount and their internal load caches get
// cleared. Text-based previews don't need this because their content is owned
// by this hook and gets re-set on refresh.
interface ImagePreview {
  type: 'image'
  filePath: string
  refreshNonce?: number
}

interface PDFPreview {
  type: 'pdf'
  filePath: string
  refreshNonce?: number
}

interface CodePreview {
  type: 'code'
  filePath: string
  content: string | null
  language: string
  error?: string
}

interface MarkdownPreview {
  type: 'markdown'
  filePath: string
  content: string | null
  error?: string
}

interface JSONPreview {
  type: 'json'
  filePath: string
  content: string | null
  error?: string
}

interface TextPreview {
  type: 'text'
  filePath: string
  content: string | null
  error?: string
}

export type FilePreviewState =
  | ImagePreview
  | PDFPreview
  | CodePreview
  | MarkdownPreview
  | JSONPreview
  | TextPreview

// ── Hook options ───────────────────────────────────────────────────────────────
// Callbacks injected by App.tsx so the hook doesn't depend on window.electronAPI directly.

/** Subset of FileSearchResult used by the fuzzy resolver. */
interface SearchResult {
  path: string
  type: 'file' | 'directory'
  relativePath: string
}

interface LinkInterceptorOptions {
  /** Open file in default external application (e.g., VS Code) */
  openFileExternal: (path: string) => Promise<void>
  /** Open URL in default browser */
  openUrl: (url: string) => Promise<void>
  /** Reveal file in system file manager */
  showInFolder: (path: string) => Promise<void>
  /** Read file as UTF-8 text (for code, markdown, json, text previews) */
  readFile: (path: string) => Promise<string>
  /** Read file as data URL (for image previews) */
  readFileDataUrl: (path: string) => Promise<string>
  /** Read file as binary (Uint8Array) for PDF previews via react-pdf */
  readFileBinary: (path: string) => Promise<Uint8Array>
  /**
   * Optional getter for the active session's working directory.
   * Used to resolve relative file paths (e.g. bare filenames from AI tables
   * like `swiss-layout-lock.md`) against the right cwd at click time.
   */
  getWorkingDirectory?: () => string | undefined
  /**
   * Optional fuzzy file search. When the initial relative-path resolution
   * misses (e.g. the agent works inside a sub-cwd that the session doesn't
   * track), we BFS the cwd subtree for the file. Wire to `fs:search` IPC.
   */
  searchFiles?: (basePath: string, query: string) => Promise<SearchResult[]>
}

// ── Hook return type ───────────────────────────────────────────────────────────

interface LinkInterceptorResult {
  /** Replacement for App.tsx handleOpenFile — classifies and routes */
  handleOpenFile: (path: string) => void
  /** Replacement for App.tsx handleOpenUrl — always opens externally */
  handleOpenUrl: (url: string) => void
  /** Open file directly in external app, bypassing classification/preview */
  openFileExternal: (path: string) => void
  /** Current preview state, drives which overlay renders in App.tsx */
  previewState: FilePreviewState | null
  /** Close the preview overlay */
  closePreview: () => void
  /** Open the currently previewed file in external app */
  openCurrentExternal: () => void
  /** Reveal the currently previewed file in system file manager */
  revealCurrentInFinder: () => void
  /**
   * Re-load the currently previewed file from disk.
   * Triggered by ⌘R / Ctrl+R while the overlay is open. For text-based
   * previews (markdown/code/json/text) this re-reads via `readFile` and
   * replaces `content`. For image/PDF this bumps `refreshNonce` so the
   * overlay remounts and its internal load cache is dropped.
   */
  refreshPreview: () => void
  /** Read file as data URL — passed to image overlays as their loader */
  readFileDataUrl: (path: string) => Promise<string>
  /** Read file as binary — passed to PDF overlays for react-pdf */
  readFileBinary: (path: string) => Promise<Uint8Array>
}

// ── Hook implementation ────────────────────────────────────────────────────────

export function useLinkInterceptor(options: LinkInterceptorOptions): LinkInterceptorResult {
  const [previewState, setPreviewState] = useState<FilePreviewState | null>(null)

  // Use refs for options so callbacks remain referentially stable.
  // Without this, every render creates a new options object → new callbacks → cascading
  // re-renders of AppShellContext and PlatformProvider consumers.
  const optionsRef = useRef(options)
  useEffect(() => { optionsRef.current = options }, [options])

  // Also track previewState in a ref for the openCurrentExternal/revealCurrentInFinder
  // callbacks, so they don't need previewState in their dependency array.
  const previewStateRef = useRef(previewState)
  useEffect(() => { previewStateRef.current = previewState }, [previewState])

  /**
   * Main entry point for file link clicks.
   * Classifies the file by extension, then either opens a preview overlay
   * or falls back to opening externally.
   *
   * For text-based files (code, markdown, json, text), reads the content BEFORE
   * showing the overlay — local filesystem reads are near-instant, so no loading
   * state is needed. This avoids null-content issues in overlay components
   * (e.g., @uiw/react-json-view crashes on null value).
   */
  const handleOpenFile = useCallback(async (path: string) => {
    // ┌───────────────────────────────────────────────────────────────────┐
    // │ Resolve relative paths against active session's working directory │
    // │                                                                   │
    // │ Bare filenames from AI tables (e.g. `swiss-layout-lock.md`) have  │
    // │ no directory context. Without resolving, fs.readFile would fail   │
    // │ or fall back to process.cwd(). Absolute paths and ~/ stay as-is.  │
    // └───────────────────────────────────────────────────────────────────┘
    const isRelative =
      !path.startsWith('/') &&
      !path.startsWith('~/') &&
      !path.startsWith('file:')
    const cwd = optionsRef.current.getWorkingDirectory?.()
    const requestedRelative = path.replace(/^\.\//, '')
    let resolvedPath = path
    if (isRelative && cwd) {
      const sep = cwd.endsWith('/') ? '' : '/'
      resolvedPath = `${cwd}${sep}${requestedRelative}`
    }

    const classification = classifyFile(resolvedPath)

    if (!classification.canPreview || !classification.type) {
      // ┌─────────────────────────────────────────────────────────────────┐
      // │ Archives / installers (.zip, .dmg, .pkg, etc.) — reveal in     │
      // │ Finder rather than launching Archive Utility / Installer.app.  │
      // │ Matches the typical "find this file to upload/share" intent.   │
      // └─────────────────────────────────────────────────────────────────┘
      if (shouldRevealInFinder(resolvedPath)) {
        optionsRef.current.showInFolder(resolvedPath)
        return
      }
      // Folder or other unrecognized file — open in default external app
      // (shell.openPath on a directory opens it in Finder/Explorer)
      optionsRef.current.openFileExternal(resolvedPath)
      return
    }

    const type = classification.type

    // PDF: open with system default app (e.g. Preview.app) instead of in-app overlay
    if (type === 'pdf') {
      optionsRef.current.openFileExternal(resolvedPath)
      return
    }

    // Images: show in-app preview overlay
    if (type === 'image') {
      setPreviewState({ type, filePath: resolvedPath })
      return
    }

    // For text-based files: read content first, then show overlay with content ready.
    // Local filesystem reads are near-instant — no loading state needed.
    let firstError: unknown
    try {
      const content = await optionsRef.current.readFile(resolvedPath)
      const state = buildInitialTextState(type, resolvedPath)
      setPreviewState({ ...state, content } as FilePreviewState)
      return
    } catch (err) {
      firstError = err
    }

    // ┌───────────────────────────────────────────────────────────────────┐
    // │ Fuzzy fallback — agent often works inside a sub-cwd that the      │
    // │ session doesn't track (e.g. cwd is .../ppt-skills/ but agent      │
    // │ operates in .../ppt-skills/guizang-ppt-skill-remix/). BFS the cwd │
    // │ subtree for the requested relative path and retry if we find one. │
    // └───────────────────────────────────────────────────────────────────┘
    const fuzzy = isRelative && cwd
      ? await fuzzyResolvePath(optionsRef.current.searchFiles, cwd, requestedRelative)
      : null

    if (fuzzy) {
      try {
        const content = await optionsRef.current.readFile(fuzzy)
        const state = buildInitialTextState(type, fuzzy)
        setPreviewState({ ...state, content } as FilePreviewState)
        return
      } catch {
        // Even the fuzzy match couldn't be read — fall through.
      }
    }

    // ┌─────────────────────────────────────────────────────────────────┐
    // │ Last resort — show the preview overlay with the read error so   │
    // │ the user sees *why* it failed. Don't silently bounce them to    │
    // │ the parent folder; that's good UX for non-preview routes (zip   │
    // │ etc.) but here the user explicitly clicked something the app    │
    // │ classified as a previewable text file. Surface the diagnostic.  │
    // └─────────────────────────────────────────────────────────────────┘
    const errorMsg = firstError instanceof Error ? firstError.message : 'Failed to read file'
    const state = buildInitialTextState(type, resolvedPath)
    setPreviewState({ ...state, content: '', error: errorMsg } as FilePreviewState)
  }, []) // Stable: uses optionsRef

  /** Open file directly in external app, bypassing classification/preview.
   * Used by overlay header badges — when already viewing a file, "Open" should launch the editor. */
  const openFileExternal = useCallback((path: string) => {
    optionsRef.current.openFileExternal(path)
  }, []) // Stable: uses optionsRef

  /** URLs open externally, but local file paths are routed to handleOpenFile.
   * Markdown links like [report](/Users/foo/report.pdf) or [doc](file:///path)
   * arrive here as "URLs" but are actually local paths that should preview in-app. */
  const handleOpenUrl = useCallback((url: string) => {
    // Local absolute paths (e.g. /Users/foo/bar.pdf)
    if (url.startsWith('/')) {
      handleOpenFile(url)
      return
    }

    // Home-relative paths (e.g. ~/Desktop/bar.pdf)
    if (url.startsWith('~/')) {
      handleOpenFile(url)
      return
    }

    // file:// protocol (e.g. file:///Users/foo/bar.pdf)
    if (url.startsWith('file://')) {
      try {
        const localPath = decodeURIComponent(new URL(url).pathname)
        handleOpenFile(localPath)
      } catch {
        // Malformed file:// URL — fall through to external open
        optionsRef.current.openUrl(url)
      }
      return
    }

    optionsRef.current.openUrl(url)
  }, [handleOpenFile]) // Depends on handleOpenFile (stable via optionsRef)

  const closePreview = useCallback(() => {
    setPreviewState(null)
  }, [])

  /** Open the currently previewed file in external app (from overlay header) */
  const openCurrentExternal = useCallback(() => {
    const state = previewStateRef.current
    if (state) {
      optionsRef.current.openFileExternal(state.filePath)
    }
  }, []) // Stable: uses refs

  /** Reveal the currently previewed file in system file manager (from overlay header) */
  const revealCurrentInFinder = useCallback(() => {
    const state = previewStateRef.current
    if (state) {
      optionsRef.current.showInFolder(state.filePath)
    }
  }, []) // Stable: uses refs

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ refreshPreview — re-load the currently previewed file from disk.    │
  // │                                                                     │
  // │ ⌘R / Ctrl+R while the overlay is open routes here. Two paths:       │
  // │   - text-based (markdown / code / json / text): re-call readFile    │
  // │     and replace `content`. On error, surface it in the overlay's    │
  // │     existing error field instead of replacing valid content.        │
  // │   - image / pdf: bump `refreshNonce`. App.tsx uses it as a React    │
  // │     `key` on the overlay so it remounts, clearing the internal data │
  // │     cache and forcing the loader to refetch from disk.              │
  // └─────────────────────────────────────────────────────────────────────┘
  const refreshPreview = useCallback(async () => {
    const state = previewStateRef.current
    if (!state) return

    if (state.type === 'image' || state.type === 'pdf') {
      setPreviewState({
        ...state,
        refreshNonce: (state.refreshNonce ?? 0) + 1,
      } as FilePreviewState)
      return
    }

    // Text-based: re-read and update content. Keep the old content visible
    // until the new read resolves so the overlay doesn't flash blank.
    try {
      const content = await optionsRef.current.readFile(state.filePath)
      // Bail if the user closed the overlay or navigated to a different file
      // while the read was in flight.
      const current = previewStateRef.current
      if (!current || current.filePath !== state.filePath || current.type !== state.type) return
      setPreviewState({ ...current, content, error: undefined } as FilePreviewState)
    } catch (err) {
      const current = previewStateRef.current
      if (!current || current.filePath !== state.filePath || current.type !== state.type) return
      const errorMsg = err instanceof Error ? err.message : 'Failed to refresh file'
      setPreviewState({ ...current, error: errorMsg } as FilePreviewState)
    }
  }, []) // Stable: uses refs

  /** Stable reference to readFileDataUrl for overlay components */
  const readFileDataUrl = useCallback((path: string) => {
    return optionsRef.current.readFileDataUrl(path)
  }, []) // Stable: uses optionsRef

  /** Stable reference to readFileBinary for PDF overlay */
  const readFileBinary = useCallback((path: string) => {
    return optionsRef.current.readFileBinary(path)
  }, []) // Stable: uses optionsRef

  return {
    handleOpenFile,
    handleOpenUrl,
    openFileExternal,
    previewState,
    closePreview,
    openCurrentExternal,
    revealCurrentInFinder,
    refreshPreview,
    readFileDataUrl,
    readFileBinary,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * BFS the session cwd for `requestedRelative`. Returns the absolute path of
 * the best match (file, exact suffix, shortest path) or null if none found.
 *
 * Use case: agent operates inside a sub-directory the session doesn't track,
 * so `cwd + relative` misses. e.g. agent works in
 *   /ppt-skills/guizang-ppt-skill-remix/
 * but session cwd is /ppt-skills/, and emits `test-deck-enterprise/index.html`.
 * Searching for that relative path under cwd finds the real location.
 *
 * Ranking:
 *   1. Filter to type='file' with exact suffix match (path === requested OR
 *      path ends with `/requested`).
 *   2. Prefer the shortest relativePath (closer to root, less likely a copy).
 */
async function fuzzyResolvePath(
  searchFiles: ((basePath: string, query: string) => Promise<Array<{ path: string; type: 'file' | 'directory'; relativePath: string }>>) | undefined,
  cwd: string,
  requestedRelative: string,
): Promise<string | null> {
  if (!searchFiles) return null
  try {
    const results = await searchFiles(cwd, requestedRelative)
    const exactSuffix = results.filter(r =>
      r.type === 'file' && (
        r.relativePath === requestedRelative ||
        r.relativePath.endsWith(`/${requestedRelative}`)
      )
    )
    if (exactSuffix.length === 0) return null
    exactSuffix.sort((a, b) => a.relativePath.length - b.relativePath.length)
    return exactSuffix[0].path
  } catch {
    return null
  }
}

/**
 * Build the initial preview state for text-based file types.
 * Content is null initially (loading), and gets populated after async read.
 */
function buildInitialTextState(type: FilePreviewType, path: string): FilePreviewState {
  switch (type) {
    case 'code':
      return { type: 'code', filePath: path, content: null, language: getLanguageFromPath(path) }
    case 'markdown':
      return { type: 'markdown', filePath: path, content: null }
    case 'json':
      return { type: 'json', filePath: path, content: null }
    case 'text':
      return { type: 'text', filePath: path, content: null }
    default:
      // Should never happen — image/pdf are handled before this function is called
      return { type: 'text', filePath: path, content: null }
  }
}
