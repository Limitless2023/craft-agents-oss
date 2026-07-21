/**
 * [INPUT]: 依赖 ../viz-gallery-core 的全部导出
 * [OUTPUT]: viz-gallery 纯逻辑层单测（根目录去重、收录过滤、显示名）
 * [POS]: viz-gallery/__tests__ 的守护测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test'
import { collectVizRoots, entryDisplayName, isGalleryVizFile } from '../viz-gallery-core'

describe('collectVizRoots', () => {
  test('去重（含尾斜杠归一）、去空、保持顺序，workspace 根在前', () => {
    expect(
      collectVizRoots('/ws', ['/ws/', '/ws/proj-a', undefined, '/ws/proj-a', '/ws/proj-b'])
    ).toEqual(['/ws', '/ws/proj-a', '/ws/proj-b'])
  })

  test('workspace 根缺失时仅收会话目录', () => {
    expect(collectVizRoots(undefined, ['/a'])).toEqual(['/a'])
  })
})

describe('isGalleryVizFile', () => {
  test('收 .html/.htm，排除 -standalone 导出副本与非 html', () => {
    expect(isGalleryVizFile('compound.html')).toBe(true)
    expect(isGalleryVizFile('Sim.HTM')).toBe(true)
    expect(isGalleryVizFile('compound-standalone.html')).toBe(false)
    expect(isGalleryVizFile('notes.md')).toBe(false)
  })
})

describe('entryDisplayName', () => {
  test('去扩展名', () => {
    expect(entryDisplayName('compound-lab.html')).toBe('compound-lab')
  })
})
