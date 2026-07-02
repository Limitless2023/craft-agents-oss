/**
 * [INPUT]: 无外部依赖（纯函数）
 * [OUTPUT]: extractMentionQuery — 从光标前文本提取尾部 `@…` 提及查询
 * [POS]: mention-menu 的查询提取内核；抽出为无 React 纯模块以便 bun test
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ============================================================
// @ 提及查询提取
// ------------------------------------------------------------
// 光标前若以 `@` + 最多 100 个「字母/数字/下划线/连字符/斜杠/点/空格」结尾，
// 返回其后的查询（裸 `@` 返回 ''），否则返回 null。
//
// 用 Unicode 属性转义 \p{L}\p{N} + `u` 标志 → 覆盖中文/日文/韩文/带音标拉丁
// 等所有语言；原先的 `\w`（无 u 时仅 [A-Za-z0-9_]）会让 `@中文` 整体失配、
// 菜单直接关闭、永不发起文件搜索（CJK 检索不到的根因）。
// 空格允许，以便 `@app availability.md` 这类带空格文件名（Slack 式）。
// ============================================================
const MENTION_QUERY_RE = /@([\p{L}\p{N}_\-\/.\s]{0,100})?$/u

export function extractMentionQuery(textBeforeCursor: string): string | null {
  const match = textBeforeCursor.match(MENTION_QUERY_RE)
  if (!match) return null
  return match[1] ?? ''
}
