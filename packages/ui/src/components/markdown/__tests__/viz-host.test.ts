/**
 * [INPUT]: 依赖 ../viz-host 的全部导出
 * [OUTPUT]: viz-host 纯逻辑层的单测——安全红线静态守护（S1 沙箱 flag、S2 断网 CSP、
 *          S5 大小上限）+ fence 解析 + 错误分类 + 文档组装
 * [POS]: markdown/__tests__ 的可视化运行时守护测试；红线断言故意写死字面量，
 *        谁改松安全常量谁就得先来这里改测试（评审可见）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test'
import {
  buildVizDocument,
  clampVizHeight,
  classifyVizReadError,
  parseVizFence,
  safeInlineScript,
  withVizSemanticAliases,
  VIZ_CSP,
  VIZ_IFRAME_SANDBOX,
  VIZ_MAX_FILE_BYTES,
  VIZ_MAX_HEIGHT,
  VIZ_MIN_HEIGHT,
} from '../viz-host'

// ============================================================================
// 安全红线（S1/S2/S5）
// ============================================================================

describe('安全红线', () => {
  test('S1: sandbox 仅 allow-scripts，绝无 allow-same-origin', () => {
    expect(VIZ_IFRAME_SANDBOX).toBe('allow-scripts')
  })

  test('S2: CSP 彻底断网——无任何 http(s) 源，connect/frame/object 全关', () => {
    expect(VIZ_CSP).not.toMatch(/https?:\/\//)
    expect(VIZ_CSP).toContain("default-src 'none'")
    expect(VIZ_CSP).toContain("connect-src 'none'")
    expect(VIZ_CSP).toContain("frame-src 'none'")
    expect(VIZ_CSP).toContain("object-src 'none'")
    expect(VIZ_CSP).toContain("base-uri 'none'")
    expect(VIZ_CSP).toContain("form-action 'none'")
  })

  test('S5: 文件上限恒为 2MB', () => {
    expect(VIZ_MAX_FILE_BYTES).toBe(2 * 1024 * 1024)
  })
})

// ============================================================================
// fence 体解析
// ============================================================================

describe('parseVizFence', () => {
  test('第一个非空行为绝对路径', () => {
    expect(parseVizFence('/Users/me/.craft/visualizations/compound.html')).toEqual({
      file: '/Users/me/.craft/visualizations/compound.html',
    })
  })

  test('允许 file: 前缀与前后空白/空行', () => {
    expect(parseVizFence('\n  file: /tmp/a.html  \n')).toEqual({ file: '/tmp/a.html' })
    expect(parseVizFence('FILE:/tmp/b.html')).toEqual({ file: '/tmp/b.html' })
  })

  test('多余行忽略（前向兼容）', () => {
    expect(parseVizFence('/tmp/a.html\ntitle: whatever')).toEqual({ file: '/tmp/a.html' })
  })

  test('相对路径 / 空体 → null（渲染层给错误卡片而非崩溃）', () => {
    expect(parseVizFence('.craft/visualizations/a.html')).toBeNull()
    expect(parseVizFence('~/x.html')).toBeNull()
    expect(parseVizFence('')).toBeNull()
    expect(parseVizFence('   \n  ')).toBeNull()
  })
})

// ============================================================================
// 高度 clamp（G5）与错误分类
// ============================================================================

describe('clampVizHeight', () => {
  test('区间内取整、区间外收敛、非法输入 null', () => {
    expect(clampVizHeight(300.2)).toBe(301)
    expect(clampVizHeight(1)).toBe(VIZ_MIN_HEIGHT)
    expect(clampVizHeight(999_999)).toBe(VIZ_MAX_HEIGHT)
    expect(clampVizHeight('300')).toBeNull()
    expect(clampVizHeight(Number.NaN)).toBeNull()
    expect(clampVizHeight(Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('withVizSemanticAliases', () => {
  test('宿主 --accent 翻译为沙箱 --primary（--viz-series-1 的来源）', () => {
    expect(withVizSemanticAliases({ accent: 'purple' })).toEqual({ accent: 'purple', primary: 'purple' })
  })

  test('已有 primary 时不覆盖；无 accent 时不凭空造', () => {
    expect(withVizSemanticAliases({ accent: 'purple', primary: 'red' }).primary).toBe('red')
    expect(withVizSemanticAliases({ foreground: '#111' })).toEqual({ foreground: '#111' })
  })
})

describe('classifyVizReadError', () => {
  test('三类归档，未知落 read-failed', () => {
    expect(classifyVizReadError('Access denied: path outside allowed directories')).toBe('access-denied')
    expect(classifyVizReadError('ENOENT: no such file or directory')).toBe('not-found')
    expect(classifyVizReadError('Failed to read file: something odd')).toBe('read-failed')
  })
})

// ============================================================================
// 文档组装
// ============================================================================

describe('buildVizDocument', () => {
  const theme = { mode: 'dark' as const, tokens: { background: '#111', foreground: '#eee' } }

  test('片段被包成完整文档：CSP meta + 主题变量 + 桥脚本齐备', () => {
    const doc = buildVizDocument('<div id="root">hi</div>', theme)
    expect(doc).toStartWith('<!doctype html>')
    expect(doc).toContain('http-equiv="Content-Security-Policy"')
    expect(doc).toContain('data-theme="dark"')
    expect(doc).toContain('--background: #111;')
    expect(doc).toContain('craft-widget-host')
    expect(doc).toContain('<div id="root">hi</div>')
  })

  test('自带 <html> 的容错路径：注入 head 而非二次包裹', () => {
    const doc = buildVizDocument('<html><head><title>x</title></head><body>y</body></html>', theme)
    expect(doc.match(/<html/gi)?.length).toBe(1)
    expect(doc).toContain('Content-Security-Policy')
    expect(doc).toContain('</body>')
  })

  test('safeInlineScript 防 </script> 提前闭合', () => {
    expect(safeInlineScript('a</script><script>alert(1)</script>')).not.toContain('</script>')
  })
})
