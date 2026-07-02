import { test, expect } from 'bun:test'
import {
  parseFavorites,
  toggleFavorite,
  removeFavorite,
  isFavorited,
  sortByCreatedDesc,
  type Favorite,
} from './favorites-core'

const mk = (messageId: string, createdAt: number): Favorite => ({
  messageId,
  sessionId: 's1',
  sessionTitle: 'Session 1',
  contentSnapshot: 'snapshot ' + messageId,
  createdAt,
})

test('parseFavorites returns [] for null / bad JSON', () => {
  expect(parseFavorites(null)).toEqual([])
  expect(parseFavorites('not json')).toEqual([])
  expect(parseFavorites('{"not":"array"}')).toEqual([])
})

test('parseFavorites round-trips a valid array', () => {
  const list = [mk('m1', 1)]
  expect(parseFavorites(JSON.stringify(list))).toEqual(list)
})

test('toggleFavorite adds when absent, removes when present (keyed by messageId)', () => {
  const empty: Favorite[] = []
  const added = toggleFavorite(empty, mk('m1', 1))
  expect(added.map(f => f.messageId)).toEqual(['m1'])
  const removed = toggleFavorite(added, mk('m1', 2))
  expect(removed).toEqual([])
})

test('isFavorited reflects presence by messageId', () => {
  const list = [mk('m1', 1)]
  expect(isFavorited(list, 'm1')).toBe(true)
  expect(isFavorited(list, 'm2')).toBe(false)
})

test('removeFavorite drops only the matching id', () => {
  const list = [mk('m1', 1), mk('m2', 2)]
  expect(removeFavorite(list, 'm1').map(f => f.messageId)).toEqual(['m2'])
})

test('sortByCreatedDesc orders newest first, without mutating input', () => {
  const list = [mk('m1', 1), mk('m2', 3), mk('m3', 2)]
  expect(sortByCreatedDesc(list).map(f => f.messageId)).toEqual(['m2', 'm3', 'm1'])
  expect(list.map(f => f.messageId)).toEqual(['m1', 'm2', 'm3']) // input untouched
})
