/**
 * [INPUT]: 依赖 @/atoms/trajectory-panel-width 的宽度 atom 与三个约束常量，jotai 的 useAtom
 * [OUTPUT]: 对外提供 TrajectorySidePanel —— 可拖宽的右栏容器（详情与构成共用这一个槽位）
 * [POS]: 轨迹视图右栏的**宽度所有者**。详情/构成两个视图只管内容、不管尺寸——它们轮流占用
 *        同一个槽位，宽度若各持一份，切换时就会跳。拖拽状态走 ref 而非 state：
 *        指针每移动一像素就 setState 会让整个事件流列表重渲染，长会话下立刻卡顿。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { useAtom } from 'jotai'
import {
  TRAJECTORY_LIST_MIN_WIDTH,
  TRAJECTORY_PANEL_DEFAULT_WIDTH,
  TRAJECTORY_PANEL_MIN_WIDTH,
  trajectoryPanelWidthAtom,
} from '@/atoms/trajectory-panel-width'
import { cn } from '@/lib/utils'

/** 手柄命中区总宽（左右各 5px，absolute 实现不占布局）。 */
const SASH_HIT_WIDTH = 10

export interface TrajectorySidePanelProps {
  /** 外层双栏容器，用于按可用宽度 clamp——上限必须跟着窗口变，不能写死。 */
  containerRef: React.RefObject<HTMLDivElement | null>
  children: React.ReactNode
}

export function TrajectorySidePanel({ containerRef, children }: TrajectorySidePanelProps) {
  const [width, setWidth] = useAtom(trajectoryPanelWidthAtom)
  const [dragging, setDragging] = React.useState(false)
  const asideRef = React.useRef<HTMLElement>(null)

  /**
   * 容器宽度进 state 而不是渲染时读 ref：首帧 ref 还是 null，读出 0 会让 clamp 直接
   * 掐到最小值，而之后没有任何东西会触发重渲染把它弹回来——面板会永远停在 280px。
   */
  const [containerWidth, setContainerWidth] = React.useState(0)
  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    ro.observe(el)
    setContainerWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [containerRef])

  /** 可用上限：容器总宽减去左侧列表的保底宽度。未测量前不设上限。 */
  const clamp = React.useCallback(
    (w: number) => {
      const max =
        containerWidth > 0
          ? Math.max(TRAJECTORY_PANEL_MIN_WIDTH, containerWidth - TRAJECTORY_LIST_MIN_WIDTH)
          : Number.POSITIVE_INFINITY
      return Math.min(Math.max(w, TRAJECTORY_PANEL_MIN_WIDTH), max)
    },
    [containerWidth],
  )

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = asideRef.current?.getBoundingClientRect().width ?? width
      setDragging(true)

      // 拖拽期间直接改 DOM 样式，不过 React：每像素一次 setState 会连带重渲染
      // 左侧上千行的事件流列表，手感立刻变粘。松手时才写回 atom。
      let next = startWidth
      const onMove = (ev: PointerEvent) => {
        next = clamp(startWidth - (ev.clientX - startX)) // 往左拖 = 变宽
        if (asideRef.current) asideRef.current.style.width = `${next}px`
      }
      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setDragging(false)
        setWidth(next)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [clamp, setWidth, width],
  )

  // 窗口变窄时**显示宽度**收进可用范围，但持久化的意图宽度不动——与 Preview 面板同一范式：
  // 窗口再拉宽，用户原本拖到的宽度自己回来，不需要重拖。
  return (
    <aside
      ref={asideRef}
      className="relative flex shrink-0 flex-col border-l border-border/60 bg-background-elevated/30"
      style={{ width: clamp(width) }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onDoubleClick={() => setWidth(TRAJECTORY_PANEL_DEFAULT_WIDTH)}
        title=""
        className="absolute inset-y-0 z-20 cursor-col-resize"
        style={{ left: -SASH_HIT_WIDTH / 2, width: SASH_HIT_WIDTH }}
      >
        {/* 视觉线只在悬停/拖拽时出现——常驻会变成第二条边框，与 border-l 打架 */}
        <div
          className={cn(
            'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-accent transition-opacity',
            dragging ? 'opacity-100' : 'opacity-0 hover:opacity-60',
          )}
        />
      </div>
      {/* 拖拽中屏蔽内容的指针事件：否则指针滑过文本会触发选中，拖出一片高亮 */}
      <div className={cn('flex min-h-0 flex-1 flex-col', dragging && 'select-none')}>{children}</div>
    </aside>
  )
}
