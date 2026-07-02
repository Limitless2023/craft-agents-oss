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

// ────────────────────────────────────────────────────────
// 标记已发送：写 meta.followUp.{text,lastSentAt,lastSentText}（与聊天 handleSubmit 一致）
// ────────────────────────────────────────────────────────
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

// ────────────────────────────────────────────────────────
// 收集有备注且未发送的标注（供输入框 pending）
// ────────────────────────────────────────────────────────
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
