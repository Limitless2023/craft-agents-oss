/**
 * [INPUT]: 依赖 ./favorites-highlight-store 的 requestHighlight/peekHighlight/consumeHighlight/subscribeHighlight/__resetHighlight
 * [OUTPUT]: 无（测试文件）
 * [POS]: favorites-highlight-store 单测；验证 peek/consume/subscribe 语义
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect, beforeEach } from 'bun:test'
import {
  requestHighlight,
  peekHighlight,
  consumeHighlight,
  subscribeHighlight,
  __resetHighlight,
} from './favorites-highlight-store'

beforeEach(() => __resetHighlight())

test('peek returns messageId only for the matching session', () => {
  requestHighlight('s1', 'm1')
  expect(peekHighlight('s1')).toBe('m1')
  expect(peekHighlight('s2')).toBeNull()
})

test('consume clears the pending request for the matching session', () => {
  requestHighlight('s1', 'm1')
  consumeHighlight('s1')
  expect(peekHighlight('s1')).toBeNull()
})

test('consume for a non-matching session does not clear', () => {
  requestHighlight('s1', 'm1')
  consumeHighlight('s2')
  expect(peekHighlight('s1')).toBe('m1')
})

test('subscribe fires on request and can be unsubscribed', () => {
  let calls = 0
  const unsub = subscribeHighlight(() => { calls++ })
  requestHighlight('s1', 'm1')
  expect(calls).toBe(1)
  unsub()
  requestHighlight('s1', 'm2')
  expect(calls).toBe(1)
})
