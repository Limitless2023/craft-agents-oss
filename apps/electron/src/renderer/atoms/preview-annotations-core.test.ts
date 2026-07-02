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
