/**
 * [INPUT]: 依赖 ./viz-host 的文档组装/主题/解析/常量，../../context/PlatformContext 的
 *          onReadFile（file:read IPC，含 workspace 校验 + symlink 还原），lucide-react 图标
 * [OUTPUT]: 对外提供 MarkdownVizBlock 组件——```viz fence → 沙箱 iframe 交互可视化
 * [POS]: markdown fence 路由的交互可视化块（Markdown.tsx 按语言 viz 路由至此）；与
 *        MarkdownHtmlBlock（allow-same-origin 无脚本）互补且刻意分离——本组件相反
 *        （allow-scripts 无 same-origin），两组件绝不合并参数化以免两 flag 同开
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'
import {
  buildVizDocument,
  clampVizHeight,
  classifyVizReadError,
  parseVizFence,
  readVizTheme,
  VIZ_HOST_SOURCE,
  VIZ_IFRAME_SANDBOX,
  VIZ_MAX_FILE_BYTES,
  VIZ_WIDGET_SOURCE,
  type VizReadError,
  type VizThemeSnapshot,
} from './viz-host'

interface MarkdownVizBlockProps {
  /** fence 体：第一个非空行为可视化文件的绝对路径。 */
  code: string
  className?: string
}

const ERROR_KEYS: Record<VizReadError, string> = {
  'invalid-path': 'viz.errorInvalidPath',
  'access-denied': 'viz.errorAccessDenied',
  'not-found': 'viz.errorNotFound',
  'read-failed': 'viz.errorReadFailed',
  'too-large': 'viz.errorTooLarge',
}

export function MarkdownVizBlock({ code, className }: MarkdownVizBlockProps) {
  const { t } = useTranslation()
  const { onReadFile } = usePlatform()
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const themeRef = React.useRef<VizThemeSnapshot | null>(null)
  const [documentHtml, setDocumentHtml] = React.useState<string | null>(null)
  const [error, setError] = React.useState<VizReadError | null>(null)
  const [height, setHeight] = React.useState(180)

  const target = React.useMemo(() => parseVizFence(code), [code])

  const postToWidget = React.useCallback((message: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage({ source: VIZ_HOST_SOURCE, ...message }, '*')
  }, [])

  const sendTheme = React.useCallback(() => {
    postToWidget({ type: 'theme', theme: themeRef.current ?? readVizTheme() })
  }, [postToWidget])

  // 主题实时跟随（G4）：监听宿主根元素属性变化，快照后推入 iframe，无需刷新。
  React.useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      themeRef.current = readVizTheme(root)
      sendTheme()
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-font'] })
    return () => observer.disconnect()
  }, [sendTheme])

  // 读盘并组装文档。file:read 的信任边界（允许根目录 + realpath + 黑名单）在主进程；
  // 2MB 上限（S5）在此补齐。
  React.useEffect(() => {
    let cancelled = false
    setDocumentHtml(null)
    setError(null)

    if (!target) {
      setError('invalid-path')
      return
    }
    if (!onReadFile) {
      setError('read-failed')
      return
    }

    onReadFile(target.file)
      .then(html => {
        if (cancelled) return
        if (new TextEncoder().encode(html).length > VIZ_MAX_FILE_BYTES) {
          setError('too-large')
          return
        }
        themeRef.current = readVizTheme()
        setDocumentHtml(buildVizDocument(html, themeRef.current))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(classifyVizReadError(err instanceof Error ? err.message : String(err)))
      })

    return () => {
      cancelled = true
    }
  }, [target, onReadFile])

  // 桥消息（S7：双重校验——window 来源必须是本 iframe，payload 必须带 widget source 标识）。
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
      // G8（追问回传）留二期：保持 API 面兼容，宿主统一回执 unsupported，
      // 保证组件内的 Promise 不悬挂（S6 天然满足：永不发送）。
      if (data.type === 'sendFollowUpMessage' && typeof data.requestId === 'string') {
        postToWidget({ type: 'followUpResult', requestId: data.requestId, ok: false, error: 'unsupported' })
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [sendTheme, postToWidget])

  if (error) {
    return (
      <div
        className={cn(
          'flex min-h-20 items-center justify-center gap-2 rounded-[8px] bg-foreground/3 px-4 py-5 text-center text-[13px] text-destructive/80 shadow-minimal',
          className
        )}
      >
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>
          {t(ERROR_KEYS[error])}
          {target?.file ? <span className="ml-1 break-all text-muted-foreground">({target.file})</span> : null}
        </span>
      </div>
    )
  }

  if (!documentHtml) {
    return (
      <div
        className={cn(
          'min-h-28 animate-pulse rounded-[8px] bg-foreground/[0.04]',
          className
        )}
        aria-busy="true"
        aria-label={t('viz.loading')}
      />
    )
  }

  return (
    <div className={cn('relative w-full min-w-0 overflow-hidden bg-transparent', className)}>
      <iframe
        ref={iframeRef}
        sandbox={VIZ_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={documentHtml}
        title={target?.file.split('/').pop() ?? 'Interactive visualization'}
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />
    </div>
  )
}
