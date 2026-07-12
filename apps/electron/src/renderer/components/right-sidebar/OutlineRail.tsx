/**
 * [INPUT]: 依赖 react、@/lib/utils 的 cn、lucide-react 的 Pin/PinOff、
 *          ../../atoms/preview-outline-pinned 的 usePreviewOutlinePinned；
 *          大纲数据来自父级滚动容器的渲染后 DOM（querySelectorAll h1-h4）
 * [OUTPUT]: 对外提供 OutlineRail 组件（悬浮态：收起层级条 + 悬停展开；固定态：常驻大纲列；
 *          两态共享 点击跳转 + scrollspy + 当前项自动滚入视野）
 * [POS]: right-sidebar 的大纲导航，被 PreviewPanel 挂载（滚动容器的 flex 兄弟——固定态在流内
 *        成列，悬浮态 absolute 出流）；地图从地形生成——不解析 markdown，不持久化元素引用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { Pin, PinOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePreviewOutlinePinned } from '../../atoms/preview-outline-pinned'

// ============================================================
// 常量：只收 h1-h4（更深层级无导航价值）；条长按层级递减
// ============================================================
const HEADING_SELECTOR = 'h1, h2, h3, h4'
const BAR_WIDTHS = [16, 11, 7, 5]
const JUMP_OFFSET = 12        // 跳转后标题距容器顶的呼吸空间
const SPY_THRESHOLD = 32      // 标题顶部进入此线以内即视为"当前章节"（> JUMP_OFFSET）
const DOCK_WIDTH = 220        // 固定态大纲列宽

interface OutlineItem {
  level: number
  text: string
  domIndex: number  // 在 querySelectorAll 结果中的序号——跳转/定位实时重查时对齐用
}

// ============================================================
// 从渲染后 DOM 生成大纲。空文本标题保留 domIndex 对齐、仅从展示中剔除。
// ============================================================
function scanOutline(container: HTMLElement): OutlineItem[] {
  return Array.from(container.querySelectorAll<HTMLElement>(HEADING_SELECTOR))
    .map((el, domIndex) => ({
      level: Number(el.tagName[1]),
      text: el.textContent?.trim() ?? '',
      domIndex,
    }))
    .filter((it) => it.text)
}

// ============================================================
// 扫描 + scrollspy + 跳转（两种形态共享的全部行为）
// ============================================================
function useOutline(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  content: string,
  domVersion: string,
) {
  const [items, setItems] = React.useState<OutlineItem[]>([])
  const [activeIdx, setActiveIdx] = React.useState(0)

  // 扫描：渲染提交后的下一帧从 DOM 生成大纲
  React.useEffect(() => {
    const container = scrollRef.current
    if (!container) return
    const raf = requestAnimationFrame(() => setItems(scanOutline(container)))
    return () => cancelAnimationFrame(raf)
  }, [scrollRef, content, domVersion])

  // scrollspy：滚动时用实时 DOM 位置定位当前章节（rAF 节流）
  React.useEffect(() => {
    const container = scrollRef.current
    if (!container || items.length === 0) return
    let raf = 0
    const update = () => {
      raf = 0
      const els = container.querySelectorAll<HTMLElement>(HEADING_SELECTOR)
      const cTop = container.getBoundingClientRect().top
      let active = 0
      items.forEach((it, i) => {
        const el = els[it.domIndex]
        if (el && el.getBoundingClientRect().top - cTop <= SPY_THRESHOLD) active = i
      })
      setActiveIdx(active)
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, items])

  const jump = React.useCallback((it: OutlineItem) => {
    const container = scrollRef.current
    const el = container?.querySelectorAll<HTMLElement>(HEADING_SELECTOR)[it.domIndex]
    if (!container || !el) return
    const delta = el.getBoundingClientRect().top - container.getBoundingClientRect().top
    container.scrollTo({ top: container.scrollTop + delta - JUMP_OFFSET, behavior: 'smooth' })
  }, [scrollRef])

  return { items, activeIdx, jump }
}

// ============================================================
// 大纲条目列表（悬浮浮层与固定列共用；当前项自动滚入视野）
// ============================================================
function OutlineEntries({
  items,
  activeIdx,
  onJump,
}: {
  items: OutlineItem[]
  activeIdx: number
  onJump: (it: OutlineItem) => void
}) {
  const minLevel = Math.min(...items.map((it) => it.level))
  const activeBtnRef = React.useRef<HTMLButtonElement | null>(null)
  React.useEffect(() => {
    activeBtnRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  return (
    <>
      {items.map((it, i) => (
        <button
          key={i}
          ref={i === activeIdx ? activeBtnRef : undefined}
          onClick={() => onJump(it)}
          title={it.text}
          className={cn(
            'block w-full text-left pr-3 py-1 text-[12px] leading-5 truncate transition-colors',
            i === activeIdx
              ? 'text-foreground bg-foreground/[0.06]'
              : 'text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04]',
          )}
          style={{ paddingLeft: 12 + (it.level - minLevel) * 12 }}
        >
          {it.text}
        </button>
      ))}
    </>
  )
}

// 两态共用的迷你标题行：OUTLINE 字样 + 钉/取消钉
function OutlineHeader({ pinned, onTogglePin }: { pinned: boolean; onTogglePin: () => void }) {
  return (
    <div className="flex items-center justify-between pl-3 pr-1.5 py-1 shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 select-none">Outline</span>
      <button
        onClick={onTogglePin}
        title={pinned ? 'Unpin outline' : 'Pin outline'}
        className="p-1 rounded-[6px] text-muted-foreground/50 hover:text-foreground transition-colors"
      >
        {pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
      </button>
    </div>
  )
}

export function OutlineRail({
  scrollRef,
  content,
  domVersion,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>
  content: string     // 文档内容——变化即重扫
  domVersion: string  // 渲染分支指纹（文件路径/阅读模式/标注数）——DOM 重建即重扫
}) {
  const [pinned, togglePinned] = usePreviewOutlinePinned()
  const { items, activeIdx, jump } = useOutline(scrollRef, content, domVersion)

  // 单标题无导航价值
  if (items.length < 2) return null

  // ── 固定态：流内常驻大纲列（对照阅读），滚动区自动让出宽度 ──
  if (pinned) {
    return (
      <aside
        className="shrink-0 h-full border-l border-border/50 flex flex-col"
        style={{ width: DOCK_WIDTH }}
      >
        <OutlineHeader pinned onTogglePin={togglePinned} />
        <div className="flex-1 overflow-y-auto pb-2">
          <OutlineEntries items={items} activeIdx={activeIdx} onJump={jump} />
        </div>
      </aside>
    )
  }

  // ── 悬浮态：收起层级条 + 悬停展开浮层 ──
  const minLevel = Math.min(...items.map((it) => it.level))
  return (
    <div className="absolute right-1.5 top-1/2 -translate-y-1/2 z-20 group/outline">
      {/* 收起态：层级小横条（当前章节加深） */}
      <div className="flex flex-col items-end py-2 px-1.5 gap-[5px] max-h-[60vh] overflow-hidden transition-opacity duration-150 group-hover/outline:opacity-0">
        {items.map((it, i) => (
          <div
            key={i}
            className={cn(
              'h-[2px] rounded-full transition-colors',
              i === activeIdx ? 'bg-foreground/70' : 'bg-foreground/[0.18]',
            )}
            style={{ width: BAR_WIDTHS[Math.min(it.level - minLevel, BAR_WIDTHS.length - 1)] }}
          />
        ))}
      </div>
      {/* 展开态：悬停出现的大纲浮层（作为子元素保持 hover 不断） */}
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[240px] max-h-[60vh] rounded-[10px] border border-border/60 bg-popover shadow-middle pb-1.5 flex flex-col opacity-0 pointer-events-none transition-opacity duration-150 group-hover/outline:opacity-100 group-hover/outline:pointer-events-auto">
        <OutlineHeader pinned={false} onTogglePin={togglePinned} />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <OutlineEntries items={items} activeIdx={activeIdx} onJump={jump} />
        </div>
      </div>
    </div>
  )
}
