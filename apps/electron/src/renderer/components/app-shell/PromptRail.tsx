/**
 * [INPUT]: 依赖 react、react-i18next、lucide-react 的 Pin/PinOff、@/lib/utils 的 cn、
 *          ../../atoms/prompt-rail-pinned 的 usePromptRailPinned、./prompt-rail-core 的类型；
 *          条目数据与跳转由 ChatDisplay 提供（不自行扫 DOM——见下）
 * [OUTPUT]: 对外提供 PromptRail 组件（悬浮态：左缘小横条 + 悬停展开；固定态：常驻指令列；
 *          两态共享 点击跳转 + scrollspy + 当前项自动滚入视野）
 * [POS]: 聊天区的「会话大纲」，是 right-sidebar/OutlineRail 的镜像孪生（那个在右缘扫文档标题，
 *        这个在左缘列会话指令）。**关键差异：数据源是消息数组而非 DOM**——聊天是反向分页的
 *        （只挂载最近 N 轮），扫 DOM 会漏掉全部历史指令；scrollspy 因此对"未挂载节点"
 *        按"已滚过"处理（分页只可能缺前面的）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Pin, PinOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePromptRailPinned } from '../../atoms/prompt-rail-pinned'
import type { PromptRailItem } from './prompt-rail-core'

const BAR_WIDTH = 12          // 收起态小横条宽（指令无层级，统一宽度）
const SPY_THRESHOLD = 96      // 消息顶部进入此线以内即视为"当前指令"（聊天行高大于文档标题）
const DOCK_WIDTH = 200        // 固定态指令列宽

/**
 * scrollspy：取最后一个"已滚过阈值线"的条目。
 * 未挂载的条目（被反向分页截掉的历史消息）必定在视口上方，按已滚过处理。
 */
function useActiveIndex(
  scrollRef: React.RefObject<HTMLElement | null>,
  items: PromptRailItem[],
  getNode: (messageId: string) => HTMLElement | null,
) {
  const [activeIdx, setActiveIdx] = React.useState(0)

  React.useEffect(() => {
    const container = scrollRef.current
    if (!container || items.length === 0) return
    let raf = 0

    const update = () => {
      raf = 0
      const cTop = container.getBoundingClientRect().top
      let active = 0
      items.forEach((item, i) => {
        const el = getNode(item.messageId)
        if (!el) {
          active = i // 未挂载 = 在视口之上 = 已滚过
          return
        }
        if (el.getBoundingClientRect().top - cTop <= SPY_THRESHOLD) active = i
      })
      setActiveIdx(active)
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      container.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [scrollRef, items, getNode])

  return activeIdx
}

function PromptEntries({
  items,
  activeIdx,
  onJump,
}: {
  items: PromptRailItem[]
  activeIdx: number
  onJump: (messageId: string) => void
}) {
  const activeBtnRef = React.useRef<HTMLButtonElement | null>(null)
  React.useEffect(() => {
    activeBtnRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  return (
    <>
      {items.map((item, i) => (
        <button
          key={item.messageId}
          ref={i === activeIdx ? activeBtnRef : undefined}
          onClick={() => onJump(item.messageId)}
          title={item.label}
          className={cn(
            'flex w-full items-baseline gap-2 px-3 py-1 text-left text-[12px] leading-5 transition-colors',
            i === activeIdx
              ? 'bg-foreground/[0.06] text-foreground'
              : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
          )}
        >
          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/50">{i + 1}</span>
          <span className="truncate">{item.label}</span>
        </button>
      ))}
    </>
  )
}

function PromptRailHeader({ pinned, onTogglePin }: { pinned: boolean; onTogglePin: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex shrink-0 items-center justify-between py-1 pl-3 pr-1.5">
      <span className="select-none text-[10px] uppercase tracking-wider text-muted-foreground/50">
        {t('promptRail.title')}
      </span>
      <button
        onClick={onTogglePin}
        title={t(pinned ? 'promptRail.unpin' : 'promptRail.pin')}
        className="rounded-[6px] p-1 text-muted-foreground/50 transition-colors hover:text-foreground"
      >
        {pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
      </button>
    </div>
  )
}

export function PromptRail({
  items,
  scrollRef,
  getTurnNode,
  onJump,
  onActiveChange,
}: {
  items: PromptRailItem[]
  /** 聊天滚动容器（scrollspy 的坐标基准）。 */
  scrollRef: React.RefObject<HTMLElement | null>
  /** 按消息 id 取已挂载的 turn 容器；未挂载返回 null。 */
  getTurnNode: (messageId: string) => HTMLElement | null
  /** 跳转到该消息（ChatDisplay 侧负责撑开分页后滚动）。 */
  onJump: (messageId: string) => void
  /** 上报当前条目序号——⌘↑/⌘↓ 与本组件共用同一个 scrollspy，避免两套定位漂移。 */
  onActiveChange?: (index: number) => void
}) {
  const [pinned, togglePinned] = usePromptRailPinned()
  const activeIdx = useActiveIndex(scrollRef, items, getTurnNode)

  React.useEffect(() => {
    onActiveChange?.(activeIdx)
  }, [activeIdx, onActiveChange])

  // 单条指令无导航价值
  if (items.length < 2) return null

  // ── 固定态：流内常驻指令列，滚动区自动让出宽度 ──
  if (pinned) {
    return (
      <aside
        className="flex h-full shrink-0 flex-col border-r border-border/50"
        style={{ width: DOCK_WIDTH }}
      >
        <PromptRailHeader pinned onTogglePin={togglePinned} />
        <div className="flex-1 overflow-y-auto pb-2">
          <PromptEntries items={items} activeIdx={activeIdx} onJump={onJump} />
        </div>
      </aside>
    )
  }

  // ── 悬浮态：左缘小横条 + 悬停向右展开浮层 ──
  return (
    <div className="group/prompts absolute left-1.5 top-1/2 z-20 -translate-y-1/2">
      <div className="flex max-h-[60vh] flex-col items-start gap-[5px] overflow-hidden px-1.5 py-2 transition-opacity duration-150 group-hover/prompts:opacity-0">
        {items.map((item, i) => (
          <div
            key={item.messageId}
            className={cn(
              'h-[2px] rounded-full transition-colors',
              i === activeIdx ? 'bg-foreground/70' : 'bg-foreground/[0.18]',
            )}
            style={{ width: BAR_WIDTH }}
          />
        ))}
      </div>
      {/* 浮层作为收起条的子元素，保持 hover 不断 */}
      <div className="pointer-events-none absolute left-0 top-1/2 flex max-h-[60vh] w-[260px] -translate-y-1/2 flex-col rounded-[10px] border border-border/60 bg-popover pb-1.5 opacity-0 shadow-middle transition-opacity duration-150 group-hover/prompts:pointer-events-auto group-hover/prompts:opacity-100">
        <PromptRailHeader pinned={false} onTogglePin={togglePinned} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PromptEntries items={items} activeIdx={activeIdx} onJump={onJump} />
        </div>
      </div>
    </div>
  )
}
