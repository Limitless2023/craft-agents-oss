/**
 * [INPUT]: 依赖 ./viz-host 的 readVizTheme/clampVizHeight/来源标识常量，react
 * [OUTPUT]: 对外提供 useVizBridge hook——viz 沙箱 iframe 的宿主侧桥
 *          （主题实时推送 / resize 高度接收 / follow-up 统一回执 unsupported）
 * [POS]: MarkdownVizBlock（消息内嵌块）与 VizPreviewOverlay（全屏 overlay）共用的
 *        桥逻辑单一实现——两个宿主行为必须完全一致，分写两份迟早漂移
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import {
  clampVizHeight,
  readVizTheme,
  VIZ_HOST_SOURCE,
  VIZ_WIDGET_SOURCE,
  type VizThemeSnapshot,
} from './viz-host'

/**
 * viz iframe 宿主桥。挂上后自动完成：
 * 1. 主题跟随（G4）：MutationObserver 监听宿主根元素 → 快照推入 iframe；
 * 2. 高度自适应（G5）：接收 widget 的 resize 消息 → clamp 后更新 height；
 * 3. S7 双重校验：window 来源必须是本 iframe，payload 必须带 widget source 标识；
 * 4. G8 留二期：follow-up 请求统一回执 unsupported，widget 侧 Promise 不悬挂。
 */
export function useVizBridge(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  initialHeight = 180
): { height: number; readTheme: () => VizThemeSnapshot } {
  const [height, setHeight] = React.useState(initialHeight)
  const themeRef = React.useRef<VizThemeSnapshot | null>(null)

  const postToWidget = React.useCallback(
    (message: Record<string, unknown>) => {
      iframeRef.current?.contentWindow?.postMessage({ source: VIZ_HOST_SOURCE, ...message }, '*')
    },
    [iframeRef]
  )

  const sendTheme = React.useCallback(() => {
    postToWidget({ type: 'theme', theme: themeRef.current ?? readVizTheme() })
  }, [postToWidget])

  const readTheme = React.useCallback(() => {
    themeRef.current = readVizTheme()
    return themeRef.current
  }, [])

  React.useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      themeRef.current = readVizTheme(root)
      sendTheme()
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-font'] })
    return () => observer.disconnect()
  }, [sendTheme])

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { source?: string; type?: string; height?: unknown; requestId?: unknown } | null
      if (!data || typeof data !== 'object' || data.source !== VIZ_WIDGET_SOURCE) return

      if (data.type === 'ready') {
        sendTheme()
        return
      }
      if (data.type === 'resize') {
        const next = clampVizHeight(data.height)
        if (next !== null) setHeight(next)
        return
      }
      if (data.type === 'sendFollowUpMessage' && typeof data.requestId === 'string') {
        postToWidget({ type: 'followUpResult', requestId: data.requestId, ok: false, error: 'unsupported' })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [iframeRef, sendTheme, postToWidget])

  return { height, readTheme }
}
