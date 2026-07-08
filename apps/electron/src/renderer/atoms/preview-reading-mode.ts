/**
 * [INPUT]: 依赖 jotai 的 atom/useAtom；react 的 useCallback
 * [OUTPUT]: previewReadingModeAtom（全局单例 boolean）+ usePreviewReadingMode hook
 * [POS]: Preview 面板「阅读模式」视图开关（隐藏/显示高亮批注）；全局非持久，PreviewPanel 消费；与 preview-annotations 存储解耦
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { atom, useAtom } from 'jotai'
import { useCallback } from 'react'

// ────────────────────────────────────────────────────────
// 全局单例：整个 Preview 面板共用一个开关（跨 tab、跨会话）。
// 非持久（不写 localStorage）——阅读模式是临时视图偏好，
// app 重启回到默认 false（显示高亮）。故意用普通 atom 而非 atomFamily。
// ────────────────────────────────────────────────────────
export const previewReadingModeAtom = atom(false)

export function usePreviewReadingMode(): readonly [boolean, () => void] {
  const [hidden, setHidden] = useAtom(previewReadingModeAtom)
  const toggle = useCallback(() => setHidden((v) => !v), [setHidden])
  return [hidden, toggle] as const
}
