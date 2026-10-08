import { describe, test, expect } from 'bun:test'
import { isBrowserOpenableFilePath, isVizFilePath, classifyFile } from '../file-classification'

describe('isBrowserOpenableFilePath', () => {
  test('认 .html 与 .htm，大小写不敏感', () => {
    expect(isBrowserOpenableFilePath('/Users/x/report.html')).toBe(true)
    expect(isBrowserOpenableFilePath('/Users/x/report.htm')).toBe(true)
    expect(isBrowserOpenableFilePath('/Users/x/REPORT.HTML')).toBe(true)
  })

  test('其余类型一律否——"在浏览器中打开"对它们没有语义', () => {
    for (const p of ['/a/b.md', '/a/b.pdf', '/a/b.py', '/a/b.json', '/a/b.svg', '/a/b.txt']) {
      expect(isBrowserOpenableFilePath(p)).toBe(false)
    }
  })

  test('扩展名必须在结尾，不能被路径中段的 .html 蒙混', () => {
    expect(isBrowserOpenableFilePath('/a/html/b.py')).toBe(false)
    expect(isBrowserOpenableFilePath('/a/b.html.bak')).toBe(false)
    expect(isBrowserOpenableFilePath('/a/b.htmlx')).toBe(false)
  })

  test('两端空白容忍（markdown 链接目标常带空格）', () => {
    expect(isBrowserOpenableFilePath('  /a/b.html  ')).toBe(true)
  })

  test('viz 产物也算——浏览器里照样能看，只是没有宿主桥', () => {
    const viz = '/w/sessions/s1/.craft/visualizations/chart.html'
    expect(isVizFilePath(viz)).toBe(true)
    expect(isBrowserOpenableFilePath(viz)).toBe(true)
  })

  test('与 classifyFile 不冲突：.html 仍归 code（右键是额外出口，不改左键行为）', () => {
    expect(classifyFile('/a/b.html').type).toBe('code')
  })
})
