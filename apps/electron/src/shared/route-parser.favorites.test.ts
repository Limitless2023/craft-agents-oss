import { test, expect } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute, isCompoundRoute } from './route-parser'

test('favorites is recognized as a compound route', () => {
  expect(isCompoundRoute('favorites')).toBe(true)
})

test('parseCompoundRoute("favorites") → favorites navigator, no details', () => {
  expect(parseCompoundRoute('favorites')).toEqual({ navigator: 'favorites', details: null })
})

test('buildCompoundRoute round-trips favorites', () => {
  const parsed = parseCompoundRoute('favorites')
  expect(parsed).not.toBeNull()
  expect(buildCompoundRoute(parsed!)).toBe('favorites')
})
