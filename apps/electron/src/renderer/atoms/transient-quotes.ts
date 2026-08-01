/**
 * [INPUT]: 依赖 jotai 的 atom/useAtom、jotai/utils 的 atomFamily、react 的 useCallback/useMemo
 * [OUTPUT]: transientQuotesAtomFamily(sessionId) + useTransientQuotes / useClearTransientQuotes hooks
 * [POS]: 「一次性代码引用」的状态层——从 Preview 面板选中代码后引用到对话，
 *        发送即消失。与 preview-annotations 刻意分家的三个理由：
 *        ① 不持久化（引用是一次性的，不该跨重启复活）；
 *        ② 不进标注体系（标注要锚点自愈，代码经语法高亮切分后锚不稳，
 *           而"问完就结束"的引用根本不需要重新定位）；
 *        ③ 不画高亮（用户明确要求代码上不留标记）。
 *        走 atomFamily 而非 props 的原因同 preview-annotations：PreviewPanel
 *        与 ChatDisplay 的组件树不连通，atom 是这个代码库里既有的跨墙通道。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { useCallback, useMemo } from 'react'

export interface TransientQuote {
  /** 会话内唯一 id。 */
  id: string
  /** 引用来源文件的绝对路径。 */
  filePath: string
  /** 展示标签，形如 `demo_benchmark.py:32-35`。 */
  label: string
  /** 引用的原文（发送时进 Follow-ups 段落）。 */
  text: string
  createdAt: number
}

/** per-session 的一次性引用队列。普通 atom——刻意不持久化。 */
export const transientQuotesAtomFamily = atomFamily((_sessionId: string) =>
  atom<TransientQuote[]>([])
)

export function useTransientQuotes(sessionId: string | undefined) {
  const key = sessionId ?? '__none__'
  const [quotes, setQuotes] = useAtom(transientQuotesAtomFamily(key))

  const add = useCallback(
    (quote: Omit<TransientQuote, 'id' | 'createdAt'>) => {
      setQuotes(prev => [
        ...prev,
        { ...quote, id: `q-${Date.now().toString(36)}-${prev.length}`, createdAt: Date.now() },
      ])
    },
    [setQuotes]
  )

  const remove = useCallback(
    (id: string) => setQuotes(prev => prev.filter(q => q.id !== id)),
    [setQuotes]
  )

  const clear = useCallback(() => setQuotes(prev => (prev.length ? [] : prev)), [setQuotes])

  return useMemo(() => ({ quotes, add, remove, clear }), [quotes, add, remove, clear])
}

/** 只读订阅（ChatDisplay 侧合并进 follow-up chips 用）。 */
export function useTransientQuotesValue(sessionId: string | undefined): TransientQuote[] {
  return useAtomValue(transientQuotesAtomFamily(sessionId ?? '__none__'))
}

/** 发送后清空（ChatDisplay 的 handleSubmit 用）。 */
export function useClearTransientQuotes(sessionId: string | undefined) {
  const setQuotes = useSetAtom(transientQuotesAtomFamily(sessionId ?? '__none__'))
  return useCallback(() => setQuotes(prev => (prev.length ? [] : prev)), [setQuotes])
}
