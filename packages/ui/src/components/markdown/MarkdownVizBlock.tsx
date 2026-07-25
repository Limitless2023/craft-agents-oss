/**
 * [INPUT]: 依赖 ./viz-host 的文档组装/解析/常量，./use-viz-bridge 的宿主桥 hook，
 *          ../../context/PlatformContext 的 onReadFile（file:read IPC），lucide-react 图标
 * [OUTPUT]: 对外提供 MarkdownVizBlock 组件——```viz fence → 沙箱 iframe 交互可视化
 * [POS]: markdown fence 路由的交互可视化块（Markdown.tsx 按语言 viz 路由至此）；
 *        ⤢ 按钮经 onFileClick 走链接拦截器管线 → VizPreviewOverlay 全屏；与
 *        MarkdownHtmlBlock（allow-same-origin 无脚本）互补且刻意分离——本组件相反
 *        （allow-scripts 无 same-origin），两组件绝不合并参数化以免两 flag 同开
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { AlertTriangle, Maximize2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '../../lib/utils'
import { usePlatform } from '../../context/PlatformContext'
import { useVizBridge, type VizFollowUpRequest } from './use-viz-bridge'
import {
  buildVizDocument,
  classifyVizReadError,
  parseVizFence,
  readVizTheme,
  VIZ_IFRAME_SANDBOX,
  VIZ_MAX_FILE_BYTES,
  type VizReadError,
} from './viz-host'

interface MarkdownVizBlockProps {
  /** fence 体：第一个非空行为可视化文件的绝对路径。 */
  code: string
  className?: string
  /** 点击 ⤢ 时把文件路径交给链接拦截器（路由到 VizPreviewOverlay 全屏）。 */
  onFileClick?: (path: string) => void
  /**
   * G8 追问回传：组件请求代用户发消息时的发送函数（会话作用域，由 ChatDisplay
   * 绑定）。缺省 = 宿主不支持（Preview 面板等无会话场景），桥自动回执 unsupported。
   */
  onFollowUp?: (prompt: string) => void | Promise<void>
}

const ERROR_KEYS: Record<VizReadError, string> = {
  'invalid-path': 'viz.errorInvalidPath',
  'access-denied': 'viz.errorAccessDenied',
  'not-found': 'viz.errorNotFound',
  'read-failed': 'viz.errorReadFailed',
  'too-large': 'viz.errorTooLarge',
}

export function MarkdownVizBlock({ code, className, onFileClick, onFollowUp }: MarkdownVizBlockProps) {
  const { t } = useTranslation()
  const { onReadFile } = usePlatform()
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const [documentHtml, setDocumentHtml] = React.useState<string | null>(null)
  const [error, setError] = React.useState<VizReadError | null>(null)
  // 追问确认队列（S6：确认卡显式点发送才回执 ok）。同 requestId 去重防组件重发。
  const [followUpQueue, setFollowUpQueue] = React.useState<VizFollowUpRequest[]>([])
  const [sendingFollowUp, setSendingFollowUp] = React.useState(false)
  const activeFollowUp = followUpQueue[0] ?? null

  const handleFollowUpRequest = React.useCallback((req: VizFollowUpRequest) => {
    setFollowUpQueue(current => (current.some(item => item.requestId === req.requestId) ? current : [...current, req]))
  }, [])

  const { height, respondFollowUp } = useVizBridge(iframeRef, 180, onFollowUp ? handleFollowUpRequest : undefined)

  const finishFollowUp = React.useCallback(
    (req: VizFollowUpRequest, ok: boolean, errorMessage?: string) => {
      respondFollowUp(req.requestId, ok, errorMessage)
      setFollowUpQueue(current => current.filter(item => item.requestId !== req.requestId))
    },
    [respondFollowUp]
  )

  const confirmFollowUp = React.useCallback(async () => {
    if (!activeFollowUp || !onFollowUp || sendingFollowUp) return
    setSendingFollowUp(true)
    try {
      await onFollowUp(activeFollowUp.prompt)
      finishFollowUp(activeFollowUp, true)
    } catch (err) {
      finishFollowUp(activeFollowUp, false, err instanceof Error ? err.message : 'send failed')
    } finally {
      setSendingFollowUp(false)
    }
  }, [activeFollowUp, onFollowUp, sendingFollowUp, finishFollowUp])

  const target = React.useMemo(() => parseVizFence(code), [code])

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
        setDocumentHtml(buildVizDocument(html, readVizTheme()))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(classifyVizReadError(err instanceof Error ? err.message : String(err)))
      })

    return () => {
      cancelled = true
    }
  }, [target, onReadFile])

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
        className={cn('min-h-28 animate-pulse rounded-[8px] bg-foreground/[0.04]', className)}
        aria-busy="true"
        aria-label={t('viz.loading')}
      />
    )
  }

  return (
    <div className={cn('group/viz relative w-full min-w-0 overflow-hidden bg-transparent', className)}>
      {onFileClick && target && (
        <button
          type="button"
          onClick={() => onFileClick(target.file)}
          title={t('viz.openFullscreen')}
          aria-label={t('viz.openFullscreen')}
          className="absolute right-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md border border-border/60 bg-card text-foreground/50 opacity-0 shadow-minimal transition-opacity hover:bg-foreground/[0.05] hover:text-foreground group-hover/viz:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
      <iframe
        ref={iframeRef}
        sandbox={VIZ_IFRAME_SANDBOX}
        referrerPolicy="no-referrer"
        srcDoc={documentHtml}
        title={target?.file.split('/').pop() ?? 'Interactive visualization'}
        className="block w-full border-0 bg-transparent"
        style={{ height }}
      />

      {/* G8 确认卡：组件请求代发消息 → 展示完整 prompt，显式点发送才发出（S6）。
          内嵌在组件下方而非弹窗——不打断阅读流，且多面板时归属明确 */}
      {activeFollowUp && (
        <div className="mt-1.5 rounded-[8px] border border-border/60 bg-card p-3 shadow-minimal">
          <div className="mb-1.5 text-[11px] font-medium text-foreground/50">
            {t('chat.followUp')} · {t('viz.followUpExplain')}
          </div>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-[13px] text-foreground">
            {activeFollowUp.prompt}
          </div>
          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => finishFollowUp(activeFollowUp, false, 'cancelled')}
              disabled={sendingFollowUp}
              className="inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-medium text-foreground/70 transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void confirmFollowUp()}
              disabled={sendingFollowUp}
              className="inline-flex h-7 items-center rounded-lg bg-accent px-2.5 text-xs font-medium text-accent-foreground transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {t('shortcuts.sendMessage')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
