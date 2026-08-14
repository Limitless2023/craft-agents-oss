/**
 * [INPUT]: 依赖 @/lib/trajectory-core 的 TrajectoryTimeline/AxisMode/TimeRange/makeProjector/
 *          makeInverseProjector/formatDuration，依赖 ./kind-meta 的 LANES，依赖 @/lib/utils 的 cn
 * [OUTPUT]: 对外提供 TrajectoryLanes —— 三泳道时间轴条（Input / Model / Tools）+ 框选
 * [POS]: trajectory 模块的时间维度视图。列表回答"发生了什么"，这里回答"什么时候、花了多久、
 *        谁在等谁"——两者共用 entryIndex 作选中键，点泳道即选中列表行，反之亦然。
 *        **交互由单独一层顶层捕获**：段本身 pointer-events-none，点击靠自己的几何做命中判定。
 *        这样"点选一条"与"拖出一段"归同一个所有者，不必和按钮抢事件、也没有 z-index 打架。
 *        轴口径由父级持有（AxisMode），因为框选窗口的反算依赖它；**视口（缩放/平移）留在本地**，
 *        它纯粹是看的方式，不影响任何下游数据，父级不必知道。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Layers, Maximize2, Rows3, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  FULL_VIEWPORT,
  formatDuration,
  isFullViewport,
  makeInverseProjector,
  makeProjector,
  panViewport,
  viewportScale,
  zoomViewport,
  type AxisMode,
  type LaneSegment,
  type TimeRange,
  type TrajectoryTimeline,
  type Viewport,
} from '@/lib/trajectory-core'
import { LANES } from './kind-meta'

const LANE_ROW_H = 16
/**
 * 段最小可见宽度，单位是**屏幕比例**而非轴空间。
 * 这个区别是被缩放逼出来的：下限若加在轴空间，放大 500× 后它会跟着放大到撑满整条轨道，
 * 一个零时长的工具调用能盖住整个视野。加在屏幕空间才是它的本意——"至少看得见、点得中"。
 */
const MIN_W_SCREEN = 0.0035
/** 超过这个像素位移才算"拖"，否则按"点"处理——手一抖不该把点选变成框选。 */
const DRAG_THRESHOLD_PX = 4

const AXIS_MODES: Array<{ mode: AxisMode; icon: typeof Clock; labelKey: string }> = [
  { mode: 'duration', icon: Clock, labelKey: 'trajectory.axis.duration' },
  { mode: 'turns', icon: Layers, labelKey: 'trajectory.axis.turns' },
  { mode: 'calls', icon: Rows3, labelKey: 'trajectory.axis.calls' },
]

/** 段 + 轴空间坐标（未加最小宽度，下限在屏幕空间统一施加）。 */
interface PlacedSegment extends LaneSegment {
  x0: number
  x1: number
}

/** 段在当前视口下的屏幕矩形（比例）。渲染与命中判定共用它，否则"看得见却点不中"。 */
interface ScreenRect {
  left: number
  width: number
}

export interface TrajectoryLanesProps {
  timeline: TrajectoryTimeline
  axisMode: AxisMode
  onAxisModeChange: (mode: AxisMode) => void
  selectedIndex: number | null
  onSelect: (entryIndex: number) => void
  query: string
  onQueryChange: (q: string) => void
  /** 命中搜索的条目下标集合——泳道里高亮，未命中的淡出。 */
  matchedIndices: Set<number> | null
  brush: TimeRange | null
  onBrushChange: (range: TimeRange | null) => void
  /** 框选窗口里的条目数，显示在读数条上。 */
  brushedCount: number
}

export function TrajectoryLanes({
  timeline,
  axisMode,
  onAxisModeChange,
  selectedIndex,
  onSelect,
  query,
  onQueryChange,
  matchedIndices,
  brush,
  onBrushChange,
  brushedCount,
}: TrajectoryLanesProps) {
  const { t } = useTranslation()
  const trackRef = React.useRef<HTMLDivElement>(null)
  const [hovered, setHovered] = React.useState<PlacedSegment | null>(null)
  /** 拖拽中的临时窗口——不进父级 state，避免每像素重渲染整个列表。 */
  const [draft, setDraft] = React.useState<{ x0: number; x1: number } | null>(null)
  /** 可见区间（轴空间）。百轮会话全景下所有段挤成一片，必须能放大。 */
  const [view, setView] = React.useState<Viewport>(FULL_VIEWPORT)

  // 换轴口径 = 换了一套坐标含义，保留缩放只会让人不知身在何处
  React.useEffect(() => setView(FULL_VIEWPORT), [axisMode])

  const project = React.useMemo(() => makeProjector(timeline, axisMode), [timeline, axisMode])
  const unproject = React.useMemo(
    () => makeInverseProjector(timeline, axisMode),
    [timeline, axisMode],
  )

  /** 轴空间 → 屏幕比例（受视口影响）。段的渲染与命中判定都过这一层。 */
  const toScreen = React.useCallback(
    (axisX: number) => (axisX - view.v0) / (view.v1 - view.v0),
    [view],
  )

  const placed = React.useMemo<PlacedSegment[]>(
    () => timeline.segments.map(s => ({ ...s, x0: project(s.startMs), x1: project(s.endMs) })),
    [timeline.segments, project],
  )

  /** 段的屏幕矩形，最小宽度在此施加——渲染与命中判定的唯一几何来源。 */
  const rectOf = React.useCallback(
    (s: PlacedSegment): ScreenRect => {
      const left = toScreen(s.x0)
      return { left, width: Math.max(toScreen(s.x1) - left, MIN_W_SCREEN) }
    },
    [toScreen],
  )

  const turnBoundaries = React.useMemo(
    () => timeline.turns.slice(1).map(turn => project(turn.startMs)),
    [timeline.turns, project],
  )

  /** 像素 → 屏幕比例 [0,1]。 */
  const toScreenFrac = React.useCallback((clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return 0
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1)
  }, [])

  /** 像素 → 轴空间坐标。框选与命中判定用的都是它——屏幕坐标随缩放变，轴坐标不变。 */
  const toFrac = React.useCallback(
    (clientX: number) => view.v0 + toScreenFrac(clientX) * (view.v1 - view.v0),
    [view, toScreenFrac],
  )

  /**
   * 命中判定：y 落在哪条泳道、x 落在哪个段。
   * 多段重叠时取**最窄**的那个——窄段是被宽段罩住的那个，不优先它就永远点不到。
   */
  const hitTest = React.useCallback(
    (clientX: number, clientY: number): PlacedSegment | null => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return null
      const laneIdx = Math.min(
        LANES.length - 1,
        Math.max(0, Math.floor((clientY - rect.top) / LANE_ROW_H)),
      )
      const lane = LANES[laneIdx]!.lane
      // 用屏幕坐标比较：命中区必须与看到的那根条严格一致，包括最小宽度撑出来的部分
      const x = toScreenFrac(clientX)
      const hits = placed
        .filter(s => s.lane === lane)
        .map(s => ({ s, r: rectOf(s) }))
        .filter(({ r }) => x >= r.left && x <= r.left + r.width)
      if (!hits.length) return null
      return hits.reduce((best, cur) => (cur.r.width < best.r.width ? cur : best)).s
    },
    [placed, toScreenFrac, rectOf],
  )

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startClientX = e.clientX
      const startClientY = e.clientY
      const x0 = toFrac(startClientX)
      let moved = false

      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.abs(ev.clientX - startClientX) < DRAG_THRESHOLD_PX) return
        moved = true
        setDraft({ x0, x1: toFrac(ev.clientX) })
      }
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        setDraft(null)
        if (!moved) {
          // 没拖动 = 点选。点空白处则清掉框选，这是最自然的"取消"手势。
          const hit = hitTest(startClientX, startClientY)
          if (hit) onSelect(hit.entryIndex)
          else onBrushChange(null)
          return
        }
        const a = toFrac(startClientX)
        const b = toFrac(ev.clientX)
        onBrushChange({
          startMs: unproject(Math.min(a, b)),
          endMs: unproject(Math.max(a, b)),
        })
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [toFrac, hitTest, onSelect, onBrushChange, unproject],
  )

  /**
   * 触控板双指捏合在 Electron/Chromium 里表现为 `ctrlKey` 为真的 wheel 事件；
   * 双指横扫是 deltaX。两者都必须 preventDefault，所以只能用原生非被动监听——
   * React 的 onWheel 在根节点上是被动的，拦不住默认滚动。
   */
  React.useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) {
        setView(v => panViewport(v, e.deltaX / el.clientWidth))
        return
      }
      // 捏合与普通竖向滚轮都用来缩放：这条轨道里没有别的可滚，语义不冲突
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002))
      const rect = el.getBoundingClientRect()
      const anchor = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
      setView(v => zoomViewport(v, factor, anchor))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const band = draft
    ? { left: toScreen(Math.min(draft.x0, draft.x1)), right: toScreen(Math.max(draft.x0, draft.x1)) }
    : brush
      ? { left: toScreen(project(brush.startMs)), right: toScreen(project(brush.endMs)) }
      : null

  return (
    <div className="shrink-0 border-b border-border/60 bg-background-elevated/40 px-4 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex items-center gap-1">
          {AXIS_MODES.map(({ mode, icon: Icon, labelKey }) => (
            <button
              key={mode}
              type="button"
              onClick={() => onAxisModeChange(mode)}
              className={cn(
                'inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] transition-colors',
                axisMode === mode
                  ? 'bg-accent/15 text-accent'
                  : 'text-muted-foreground hover:bg-foreground/[0.05]',
              )}
            >
              <Icon className="h-3 w-3" />
              {t(labelKey)}
            </button>
          ))}
        </div>

        {/* 读数位：框选优先于悬停——框选是留存状态，悬停是瞬时的 */}
        {brush ? (
          <button
            type="button"
            onClick={() => onBrushChange(null)}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-2.5 py-1 text-[11px] text-accent transition-colors hover:bg-accent/25"
            title={t('trajectory.brushClear')}
          >
            {formatDuration(brush.endMs - brush.startMs)} ·{' '}
            {t('trajectory.brushCount', { n: brushedCount })}
            <X className="h-3 w-3" />
          </button>
        ) : hovered ? (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {hovered.label} · {formatDuration(hovered.endMs - hovered.startMs)}
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground/50">{t('trajectory.brushHint')}</span>
        )}

        {!isFullViewport(view) && (
          <button
            type="button"
            onClick={() => setView(FULL_VIEWPORT)}
            title={t('trajectory.zoomReset')}
            className="inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <Maximize2 className="h-3 w-3" />
            {viewportScale(view).toFixed(viewportScale(view) < 10 ? 1 : 0)}×
          </button>
        )}
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50" />
          <input
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            placeholder={t('trajectory.search')}
            className="h-6 w-52 rounded-[6px] border border-border/60 bg-background pl-6 pr-6 text-[11px] outline-none placeholder:text-muted-foreground/50 focus:border-accent/50"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex shrink-0 flex-col justify-between py-px">
          {LANES.map(l => (
            <div
              key={l.lane}
              className="text-[10px] leading-none text-muted-foreground/70"
              style={{ height: LANE_ROW_H, lineHeight: `${LANE_ROW_H}px` }}
            >
              {l.label}
            </div>
          ))}
        </div>

        <div ref={trackRef} className="relative flex-1 overflow-hidden">
          {/* 回合分隔线：竖着切开，一眼看出"这是第几轮" */}
          {turnBoundaries.map((x, i) => (
            <div
              key={i}
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-border"
              style={{ left: `${toScreen(x) * 100}%` }}
            />
          ))}

          {LANES.map(({ lane }) => (
            <div key={lane} className="relative" style={{ height: LANE_ROW_H }}>
              <div className="absolute inset-x-0 top-1/2 h-[7px] -translate-y-1/2 rounded-full bg-foreground/[0.04]" />
              {placed
                .filter(s => s.lane === lane)
                .map(s => {
                  const selected = selectedIndex === s.entryIndex
                  const dimmed = matchedIndices != null && !matchedIndices.has(s.entryIndex)
                  const r = rectOf(s)
                  if (r.left + r.width < 0 || r.left > 1) return null // 视口外，不渲染
                  return (
                    <div
                      key={`${s.lane}-${s.entryIndex}`}
                      className={cn(
                        // 交互全交给顶层捕获层，段本身不接事件
                        'pointer-events-none absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full transition-all',
                        laneColor(lane, s.isError),
                        selected && 'h-[11px] ring-2 ring-accent ring-offset-1 ring-offset-background',
                        dimmed && 'opacity-25',
                      )}
                      style={{ left: `${r.left * 100}%`, width: `${r.width * 100}%` }}
                    />
                  )
                })}
            </div>
          ))}

          {/* 框选带：跨三条泳道，两端各一条竖线 */}
          {band && (
            <div
              className="pointer-events-none absolute inset-y-0 border-x border-accent bg-accent/10"
              style={{ left: `${band.left * 100}%`, width: `${(band.right - band.left) * 100}%` }}
            />
          )}

          {/* 交互捕获层：点选 + 框选的唯一所有者 */}
          <div
            className="absolute inset-0 cursor-crosshair"
            onPointerDown={onPointerDown}
            onPointerMove={e => setHovered(hitTest(e.clientX, e.clientY))}
            onPointerLeave={() => setHovered(null)}
          />
        </div>
      </div>
    </div>
  )
}

/** 泳道底色：Input 用品牌紫、Model 用中性、Tools 用琥珀，出错的工具段转红。 */
function laneColor(lane: string, isError?: boolean): string {
  if (isError) return 'bg-destructive/80'
  if (lane === 'input') return 'bg-accent/60'
  if (lane === 'model') return 'bg-foreground/35'
  return 'bg-info/70'
}
