/**
 * [INPUT]: 依赖 react/react-dom 的 createPortal、react-i18next、lucide-react 的 Quote 图标、
 *          @/lib/utils 的 cn；行号来自 ShikiCodeViewer 渲染的 [data-line] 属性
 * [OUTPUT]: 对外提供 CodeQuoteLayer —— 包裹代码视图，选中即浮出「引用到对话」按钮
 * [POS]: Preview 面板代码视图的引用捕获层。与 markdown 的标注追问刻意不同源：
 *        那套要持久锚点（标注长期存在，文件改了要能自愈重定位），而代码引用是
 *        一次性的——问完即弃，因此只取"当下选中的文本 + 行号"，不落任何存储、
 *        不在代码上留高亮。锚点计算也用简化版（代码选区是块状，直接取选区外接
 *        矩形底部；markdown 那套"按指针挑行矩形"是为跨行不规则文本流准备的）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Quote } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PendingSelection {
  text: string
  startLine: number
  endLine: number
  /** 视口坐标：按钮锚点（选区底部中心）。 */
  x: number
  y: number
}

/** 从选区端点回溯最近的带行号元素；拿不到返回 null（降级分支也带 data-line，正常不会）。 */
function lineOf(node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement
  const lineEl = el?.closest('[data-line]')
  if (!lineEl) return null
  const value = Number(lineEl.getAttribute('data-line'))
  return Number.isFinite(value) ? value : null
}

export function CodeQuoteLayer({
  filePath,
  onQuote,
  children,
}: {
  /** 当前代码文件绝对路径（用于生成 `文件名:行号` 标签）。 */
  filePath: string
  /** 用户确认引用时回调（文本 + 行号范围）。 */
  onQuote: (quote: { text: string; startLine: number; endLine: number }) => void
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const containerRef = React.useRef<HTMLDivElement>(null)
  const [pending, setPending] = React.useState<PendingSelection | null>(null)

  const dismiss = React.useCallback(() => setPending(null), [])

  // 选区捕获：鼠标松开后读一次选区。放在 rAF 里是因为 mouseup 当帧
  // selection 可能尚未落定（与 markdown 那边同样的处理）。
  const handleMouseUp = React.useCallback(() => {
    requestAnimationFrame(() => {
      const root = containerRef.current
      const selection = window.getSelection()
      if (!root || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
        setPending(null)
        return
      }

      const range = selection.getRangeAt(0)
      if (!root.contains(range.commonAncestorContainer)) {
        setPending(null)
        return
      }

      const text = range.toString()
      if (!text.trim()) {
        setPending(null)
        return
      }

      const rect = range.getBoundingClientRect()
      const start = lineOf(range.startContainer)
      const end = lineOf(range.endContainer)
      // 行号拿不到时退化成整段引用（宁可少个行号，也不要不能引用）
      const startLine = start ?? 0
      const endLine = end ?? start ?? 0

      setPending({
        text,
        startLine: Math.min(startLine, endLine),
        endLine: Math.max(startLine, endLine),
        x: rect.left + rect.width / 2,
        y: rect.bottom,
      })
    })
  }, [])

  // 滚动/失焦时收起按钮：它是 fixed 定位的，容器一滚就会与选区错位。
  React.useEffect(() => {
    if (!pending) return
    const onScroll = () => setPending(null)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [pending])

  const confirm = React.useCallback(() => {
    if (!pending) return
    onQuote({ text: pending.text, startLine: pending.startLine, endLine: pending.endLine })
    // 引用后立刻清掉选区——代码上不留任何痕迹是这个功能的前提
    window.getSelection()?.removeAllRanges()
    setPending(null)
  }, [pending, onQuote])

  return (
    <div ref={containerRef} onMouseUp={handleMouseUp} className="contents">
      {children}
      {/* 点击别处收起的兜底层。必须排在按钮之前渲染——两者同层级时，
          后挂载的 portal 在上，顺序反了会把按钮盖住点不着。 */}
      {pending &&
        createPortal(
          <div
            onMouseDown={dismiss}
            style={{ position: 'fixed', inset: 0, zIndex: 'var(--z-island, 400)' as React.CSSProperties['zIndex'] }}
            className="bg-transparent"
            aria-hidden
          />,
          document.body
        )}
      {pending &&
        createPortal(
          <button
            type="button"
            // mousedown 阶段就阻断，否则点击会先清掉选区导致 confirm 拿不到内容
            onMouseDown={e => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={confirm}
            style={{
              position: 'fixed',
              left: Math.max(8, Math.min(pending.x, window.innerWidth - 8)),
              top: pending.y + 6,
              transform: 'translateX(-50%)',
              zIndex: 'var(--z-island, 400)' as React.CSSProperties['zIndex'],
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border border-border bg-popover px-2.5 py-1.5',
              'text-[12px] font-medium text-foreground shadow-modal-small',
              'hover:bg-foreground/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
            )}
          >
            <Quote className="h-3.5 w-3.5" strokeWidth={2} />
            {t('preview.quoteToChat')}
            {pending.startLine > 0 && (
              <span className="tabular-nums text-muted-foreground">
                {pending.startLine === pending.endLine
                  ? `L${pending.startLine}`
                  : `L${pending.startLine}-${pending.endLine}`}
              </span>
            )}
          </button>,
          document.body
        )}
    </div>
  )
}
