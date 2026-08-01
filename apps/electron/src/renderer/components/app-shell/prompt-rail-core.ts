/**
 * [INPUT]: 无外部依赖（纯函数）
 * [OUTPUT]: 对外提供 promptLabel（用户消息 → 导航标题）、PromptRailItem 类型
 * [POS]: PromptRail 的纯逻辑层，可单测；把"消息正文"压成一行可扫读的标题——
 *        导航条目要的是"我当时让它干嘛"，不是全文
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export interface PromptRailItem {
  /** 用户消息 id（跳转键，turnRefs 的 key 为 `user-<messageId>`）。 */
  messageId: string
  /** 单行标题（已去标记、压空白、截断）。 */
  label: string
  /** 在 allTurns 中的下标——scrollspy 与"上/下一条"顺序的真相。 */
  turnIndex: number
}

/** 标题最大长度：够看清意图，又不至于撑破 240px 浮层。 */
export const PROMPT_LABEL_MAX = 64

/**
 * 剥掉 markdown 标记，只留人读的字。导航条是"扫一眼认出这条指令"的地方，
 * 星号反引号方括号全是噪音（`**Follow-ups**` 该显示成 Follow-ups）。
 * 刻意保守：只处理成对的强调标记与行首块标记，不动单词内的下划线
 * （snake_case 标识符要原样保留）。
 */
function stripMarkdown(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')   // [文本](url) / ![alt](url) → 文本
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')        // 成对强调
    .replace(/`+/g, '')                            // 行内代码反引号
    .replace(/^\s*(#{1,6}|>+|[-*+]|\d+[.)])\s+/, '') // 行首块标记（标题/引用/列表）
    .trim()
}

/**
 * 用户消息正文 → 单行导航标题。
 * 处理顺序刻意如此：先剥隐藏段（edit_request 等 XML 包裹的内部标记，用户从未
 * 看见过它们），再取首个有内容的行（一条指令的第一句就是它的主旨），最后压空白截断。
 */
export function promptLabel(content: string, max = PROMPT_LABEL_MAX): string {
  // 两级处理，区别对待两类尖括号：
  // 1. 应用注入的内部标记（edit_request/context）——连内容一起剥，用户从没见过它们；
  // 2. 其余标签只去尖括号保留文字——用户可能真的在讲代码（"把 <div> 换成 <span>"）。
  const withoutHidden = content
    .replace(/<(edit_request|context)>[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')

  const firstMeaningfulLine =
    withoutHidden
      .split('\n')
      .map(line => stripMarkdown(line.replace(/\s+/g, ' ')))
      // 跳过纯 markdown 装饰行（分隔线、空列表符），它们不承载意图
      .find(line => line && !/^[-*_=#>\s]+$/.test(line)) ?? ''

  if (!firstMeaningfulLine) return ''
  return firstMeaningfulLine.length > max
    ? `${firstMeaningfulLine.slice(0, max - 1).trimEnd()}…`
    : firstMeaningfulLine
}
