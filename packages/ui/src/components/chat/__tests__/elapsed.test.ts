/**
 * [INPUT]: 依赖 ../elapsed 的 formatElapsed
 * [OUTPUT]: 运行计时格式化的守护测试
 * [POS]: chat/__tests__ 下的纯函数测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test'
import { formatElapsed } from '../elapsed'

describe('formatElapsed', () => {
  test('一分钟内只报秒', () => {
    expect(formatElapsed(0)).toBe('0s')
    expect(formatElapsed(999)).toBe('0s')
    expect(formatElapsed(12_000)).toBe('12s')
    expect(formatElapsed(59_999)).toBe('59s')
  })

  test('超过一分钟分秒对齐（补零便于比较）', () => {
    expect(formatElapsed(60_000)).toBe('1:00')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(3_599_000)).toBe('59:59')
  })

  test('超过一小时报时分秒', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00')
    expect(formatElapsed(3_723_000)).toBe('1:02:03')
  })

  test('负值与非法值归零（时钟漂移/缺失起点时不显示垃圾）', () => {
    expect(formatElapsed(-5000)).toBe('0s')
    expect(formatElapsed(Number.NaN)).toBe('0s')
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe('0s')
  })
})
