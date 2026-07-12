/**
 * [INPUT]: 依赖 jotai 的 useAtom、jotai/utils 的 atomWithStorage；react 的 useCallback
 * [OUTPUT]: previewOutlinePinnedAtom（全局 boolean，localStorage 持久化）+ usePreviewOutlinePinned hook
 * [POS]: Preview 大纲「固定」布局偏好；与 preview-reading-mode 相邻——但固定是持久布局偏好
 *        （对照阅读的工作习惯），跨重启保留，故用 atomWithStorage 而非普通 atom
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useAtom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useCallback } from 'react'

export const previewOutlinePinnedAtom = atomWithStorage('craft-preview-outline-pinned-v1', false)

export function usePreviewOutlinePinned(): readonly [boolean, () => void] {
  const [pinned, setPinned] = useAtom(previewOutlinePinnedAtom)
  const toggle = useCallback(() => setPinned((v) => !v), [setPinned])
  return [pinned, toggle] as const
}
