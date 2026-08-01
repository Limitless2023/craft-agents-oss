/**
 * [INPUT]: 依赖 jotai 的 useAtom、jotai/utils 的 atomWithStorage、react 的 useCallback
 * [OUTPUT]: promptRailPinnedAtom（全局 boolean，localStorage 持久化）+ usePromptRailPinned hook
 * [POS]: 聊天区「指令导航」固定布局偏好，与 preview-outline-pinned 是镜像孪生
 *        （右缘文档大纲 / 左缘会话大纲）——同为跨重启保留的工作习惯，故用
 *        atomWithStorage；两者刻意分开存，用户可只钉其中一侧
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useCallback } from 'react'

export const promptRailPinnedAtom = atomWithStorage('craft-prompt-rail-pinned-v1', false)

export function usePromptRailPinned(): readonly [boolean, () => void] {
  const [pinned, setPinned] = useAtom(promptRailPinnedAtom)
  const toggle = useCallback(() => setPinned((v) => !v), [setPinned])
  return [pinned, toggle] as const
}
