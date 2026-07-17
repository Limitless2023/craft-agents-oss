/**
 * [INPUT]: 依赖 ./PreviewOverlay 的共享外壳（头部徽章/文件菜单/滚动区），
 *          ../markdown/viz-host 的文档组装/解析/导出构建器，
 *          ../markdown/use-viz-bridge 的宿主桥 hook，lucide-react 图标
 * [OUTPUT]: 对外提供 VizPreviewOverlay 组件——.craft/visualizations/*.html 的
 *          全屏活组件预览（方案1）+ 头部"导出独立 HTML"（方案2）
 * [POS]: overlay 家族的交互可视化成员：链接拦截器把 viz 分类路由到此（App.tsx
 *        FilePreviewRenderer case 'viz'）；渲染引擎与 MarkdownVizBlock 完全同源
 *        （同 buildVizDocument + useVizBridge），只是外壳换成全屏
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { Download, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PreviewOverlay } from './PreviewOverlay'
import { useVizBridge } from '../markdown/use-viz-bridge'
import {
  buildStandaloneVizDocument,
  buildVizDocument,
  classifyVizReadError,
  readVizTheme,
  VIZ_IFRAME_SANDBOX,
  VIZ_MAX_FILE_BYTES,
  type VizReadError,
} from '../markdown/viz-host'

const ERROR_KEYS: Record<VizReadError, string> = {
  'invalid-path': 'viz.errorInvalidPath',
  'access-denied': 'viz.errorAccessDenied',
  'not-found': 'viz.errorNotFound',
  'read-failed': 'viz.errorReadFailed',
  'too-large': 'viz.errorTooLarge',
}

export interface VizPreviewOverlayProps {
  isOpen: boolean
  onClose: () => void
  /** 可视化片段文件的绝对路径。 */
  filePath: string
  theme?: 'light' | 'dark'
  /** 读取片段内容（App 侧接 file:read）。 */
  loadHtml: (path: string) => Promise<string>
  /** 导出独立 HTML 的写盘回调（App 侧接 file:write）。缺省则不显示导出按钮。 */
  onExportFile?: (path: string, content: string) => Promise<void>
  /** 导出成功后在 Finder 中显示（App 侧接 shell showInFolder）。 */
  onRevealFile?: (path: string) => void
}

export function VizPreviewOverlay({
  isOpen,
  onClose,
  filePath,
  theme,
  loadHtml,
  onExportFile,
  onRevealFile,
}: VizPreviewOverlayProps) {
  const { t } = useTranslation()
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const [fragment, setFragment] = React.useState<string | null>(null)
  const [documentHtml, setDocumentHtml] = React.useState<string | null>(null)
  const [error, setError] = React.useState<VizReadError | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [exportFailed, setExportFailed] = React.useState(false)
  const { height } = useVizBridge(iframeRef, 480)

  const fileName = filePath.split('/').pop() ?? filePath

  React.useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setFragment(null)
    setDocumentHtml(null)
    setError(null)

    loadHtml(filePath)
      .then(html => {
        if (cancelled) return
        if (new TextEncoder().encode(html).length > VIZ_MAX_FILE_BYTES) {
          setError('too-large')
          return
        }
        setFragment(html)
        setDocumentHtml(buildVizDocument(html, readVizTheme()))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(classifyVizReadError(err instanceof Error ? err.message : String(err)))
      })

    return () => {
      cancelled = true
    }
  }, [isOpen, filePath, loadHtml])

  // 方案2：把片段 + 当前主题快照烘焙成自包含文档，写到源文件旁并在 Finder 中显示。
  const handleExport = React.useCallback(async () => {
    if (!fragment || !onExportFile || exporting) return
    setExporting(true)
    setExportFailed(false)
    const exportPath = filePath.replace(/\.html?$/i, '') + '-standalone.html'
    try {
      const standalone = buildStandaloneVizDocument(fragment, readVizTheme(), fileName.replace(/\.html?$/i, ''))
      await onExportFile(exportPath, standalone)
      onRevealFile?.(exportPath)
    } catch {
      setExportFailed(true)
    } finally {
      setExporting(false)
    }
  }, [fragment, onExportFile, exporting, filePath, fileName, onRevealFile])

  const headerActions = onExportFile ? (
    <div className="flex items-center gap-2">
      {exportFailed && <span className="text-xs text-destructive/80">{t('viz.exportFailed')}</span>}
      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={!fragment || exporting}
        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-medium text-foreground/80 shadow-minimal transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2} />
        {t('viz.export')}
      </button>
    </div>
  ) : undefined

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      theme={theme}
      typeBadge={{ icon: SlidersHorizontal, label: 'VIZ', variant: 'green' }}
      filePath={filePath}
      headerActions={headerActions}
      error={
        error
          ? { label: t(ERROR_KEYS[error]), message: filePath }
          : undefined
      }
    >
      <div className="px-6 pb-6">
        {!documentHtml && !error && (
          <div className="py-12 text-center text-sm text-muted-foreground">{t('viz.loading')}</div>
        )}
        {documentHtml && (
          <iframe
            ref={iframeRef}
            sandbox={VIZ_IFRAME_SANDBOX}
            referrerPolicy="no-referrer"
            srcDoc={documentHtml}
            title={fileName}
            className="block w-full rounded-[12px] border-0 bg-transparent"
            style={{ height: Math.max(height, 400) }}
          />
        )}
      </div>
    </PreviewOverlay>
  )
}
