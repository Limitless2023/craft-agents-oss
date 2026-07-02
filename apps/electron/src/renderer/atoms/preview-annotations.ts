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
