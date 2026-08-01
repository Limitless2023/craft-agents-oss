/**
 * [INPUT]: 依赖 jotai/utils 的 atomWithStorage
 * [OUTPUT]: autoExpandRunningTurnsAtom（全局 boolean，localStorage 持久化）
 * [POS]: 「运行中自动展开工具步骤」偏好。终端里靠流式滚动天然管理焦点（跑的时候
 *        看得见、跑完被新内容顶上去），卡片式 GUI 没有这个红利，只能用"运行中展开 →
 *        完成即收"显式模拟。默认 false = 保持上游（始终折叠）。
 *        与 chat-response-height / prompt-rail-pinned 同族：renderer-only 外观偏好。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { atomWithStorage } from 'jotai/utils'

/** 运行中的回合是否自动展开工具步骤（完成后自动收回）。默认 false。 */
export const autoExpandRunningTurnsAtom = atomWithStorage<boolean>(
  'craft-auto-expand-running-turns',
  false
)

/**
 * 是否在每条工具步骤下方显示输出前几行（Claude Code 同款 `⎿ …`）。默认 false。
 * 与"运行时展开"刻意分开：展开是"看得见有哪些步骤"，输出预览是"不点进去就知道
 * 每步的结果"——两个独立的信息密度旋钮，长会话里未必都想要。
 */
export const showToolOutputPreviewAtom = atomWithStorage<boolean>(
  'craft-show-tool-output-preview',
  false
)
