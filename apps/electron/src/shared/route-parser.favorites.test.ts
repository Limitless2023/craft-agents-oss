/**
 * [INPUT]: 依赖 ./route-parser 的 parseCompoundRoute, buildCompoundRoute, isCompoundRoute, parseRouteToNavigationState
 * [OUTPUT]: 无对外导出；仅测试断言
 * [POS]: shared/route-parser 的 favorites 分支回归测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { test, expect } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute, isCompoundRoute, parseRouteToNavigationState } from './route-parser'

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

test('parseRouteToNavigationState("favorites") → favorites navigator', () => {
  expect(parseRouteToNavigationState('favorites')).toEqual({ navigator: 'favorites' })
})
