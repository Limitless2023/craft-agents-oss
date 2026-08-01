/**
 * [INPUT]: 依赖 ../prompt-rail-core 的 promptLabel / PROMPT_LABEL_MAX
 * [OUTPUT]: 指令导航标题提取的守护测试
 * [POS]: app-shell/__tests__ 下 PromptRail 纯逻辑测试
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { describe, expect, test } from 'bun:test'
import { promptLabel, PROMPT_LABEL_MAX } from '../prompt-rail-core'

describe('promptLabel', () => {
  test('取首个有内容的行，压掉多余空白', () => {
    expect(promptLabel('  修复一下\n\n还有别的事  ')).toBe('修复一下')
    expect(promptLabel('多个   空格    压成一个')).toBe('多个 空格 压成一个')
  })

  test('剥离内部隐藏标记（用户从未见过它们）', () => {
    expect(promptLabel('<edit_request>path=a.ts</edit_request>\n把这里改成绿色')).toBe('把这里改成绿色')
    expect(promptLabel('<context>x</context> 正文在这')).toBe('正文在这')
  })

  test('跳过纯装饰行（分隔线/裸标记）', () => {
    expect(promptLabel('---\n\n### \n真正的指令')).toBe('真正的指令')
  })

  test('剥 markdown 标记，只留人读的字', () => {
    expect(promptLabel('**Follow-ups**')).toBe('Follow-ups')
    expect(promptLabel('### 调研一下 `mintlify` 的定价')).toBe('调研一下 mintlify 的定价')
    expect(promptLabel('- 看下 [这个页面](https://x.com/docs) 的结构')).toBe('看下 这个页面 的结构')
    expect(promptLabel('> 引用式指令')).toBe('引用式指令')
    expect(promptLabel('~~作废~~ 改成这样')).toBe('作废 改成这样')
  })

  test('不误伤单词内下划线（标识符原样保留）', () => {
    expect(promptLabel('把 snake_case_name 改掉')).toBe('把 snake_case_name 改掉')
  })

  test('超长截断并加省略号', () => {
    const long = 'A'.repeat(200)
    const out = promptLabel(long)
    expect(out.length).toBe(PROMPT_LABEL_MAX)
    expect(out.endsWith('…')).toBe(true)
  })

  test('空内容 / 纯装饰 → 空串（调用方据此过滤）', () => {
    expect(promptLabel('')).toBe('')
    expect(promptLabel('\n\n   \n')).toBe('')
    expect(promptLabel('---')).toBe('')
  })
})
