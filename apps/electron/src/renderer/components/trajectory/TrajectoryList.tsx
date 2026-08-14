/**
 * [INPUT]: 依赖 @/lib/trajectory-core 的 TrajectoryEntry/compactJson，依赖 ./kind-meta 的 KIND_META
 * [OUTPUT]: 对外提供 TrajectoryList —— 一条目一行的密集事件流
 * [POS]: trajectory 模块的主视图。刻意做成"一行读完"：左槽角色标签定位类型，
 *        工具行把调用与结果压在同一行（`名字 {入参} → 结果`），要看全文点开右侧详情。
 *        已配对的工具结果不单独成行——它已经在调用行的箭头右边，再列一遍是纯噪音。
 *        时间轴框选后窗外条目淡出（不隐藏）：保留上下文才看得出这段在整体里的位置。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { cn } from '@/lib/utils'
import { compactJson, entryInRange, type TimeRange, type TrajectoryEntry } from '@/lib/trajectory-core'
import { KIND_META } from './kind-meta'

export interface TrajectoryListProps {
  entries: TrajectoryEntry[]
  selectedIndex: number | null
  onSelect: (entryIndex: number) => void
  /** 回合标记文案（i18n 的 "Turn {{n}}"）。 */
  turnLabel: (turn: number) => string
  /** 被截断掉的条数（超长会话只渲染尾部）。截断必须说出来，不能装作全都在。 */
  truncatedNotice?: string
  /** 时间轴上框出的窗口。窗外条目淡出而非隐藏——保留上下文才看得出"这段在整体里的位置"。 */
  brush?: TimeRange | null
}

export function TrajectoryList({
  entries,
  selectedIndex,
  onSelect,
  turnLabel,
  truncatedNotice,
  brush,
}: TrajectoryListProps) {
  const rowRefs = React.useRef(new Map<number, HTMLButtonElement>())

  // 从时间轴点选时把对应行滚进视野——两个视图共用一个选中键，行为必须双向
  React.useEffect(() => {
    if (selectedIndex == null) return
    rowRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  // 框选后跳到窗口内第一条：框完还要自己手动找位置，这个功能就白做了
  const firstInRange = brush ? entries.find(e => entryInRange(e, brush))?.index : undefined
  React.useEffect(() => {
    if (firstInRange == null) return
    rowRefs.current.get(firstInRange)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [firstInRange])

  let lastTurn = -1

  return (
    <div className="min-w-0 flex-1 overflow-y-auto py-1">
      {truncatedNotice && (
        <p className="px-3 py-1.5 text-center text-[11px] text-muted-foreground/70">
          {truncatedNotice}
        </p>
      )}
      {entries.map(e => {
        const meta = KIND_META[e.kind]
        const showTurn = e.turn > 0 && e.turn !== lastTurn
        if (showTurn) lastTurn = e.turn
        const selected = selectedIndex === e.index
        const outside = brush != null && !entryInRange(e, brush)
        return (
          <React.Fragment key={e.index}>
            {showTurn && (
              <div className="sticky top-0 z-10 flex items-center gap-2 bg-background/95 px-3 py-1 backdrop-blur">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
                  {turnLabel(e.turn)}
                </span>
                <span className="h-px flex-1 bg-border/60" />
              </div>
            )}
            <button
              ref={el => {
                if (el) rowRefs.current.set(e.index, el)
                else rowRefs.current.delete(e.index)
              }}
              type="button"
              onClick={() => onSelect(e.index)}
              className={cn(
                'flex w-full items-baseline gap-2 px-3 py-[3px] text-left transition-all',
                selected ? 'bg-accent/10' : 'hover:bg-foreground/[0.03]',
                outside && 'opacity-30',
              )}
            >
              <span
                className={cn(
                  'w-[74px] shrink-0 text-right font-mono text-[10px] uppercase tracking-wide',
                  meta.text,
                )}
              >
                {meta.role}
              </span>
              <RowBody entry={e} />
            </button>
          </React.Fragment>
        )
      })}
      {!entries.length && (
        <p className="px-3 py-8 text-center text-[12px] text-muted-foreground">—</p>
      )}
    </div>
  )
}

/**
 * 行正文。工具行是 `名字 {入参} → 结果` 三段式：调用与结果共用一行，
 * 因为"调了什么"和"得到什么"分开看没有意义。
 */
function RowBody({ entry }: { entry: TrajectoryEntry }) {
  if (entry.kind === 'tool-call') {
    return (
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 font-mono text-[11px]">
        <span className="shrink-0 text-foreground/90">{entry.toolName}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground/80">
          {compactJson(entry.toolInput, 100)}
        </span>
        {entry.resultText != null && (
          <>
            <span className="shrink-0 text-muted-foreground/40">→</span>
            <span
              className={cn(
                'min-w-0 flex-[1.2] truncate',
                entry.resultIsError ? 'text-destructive/80' : 'text-muted-foreground/70',
              )}
            >
              {oneLine(entry.resultText, 140)}
            </span>
          </>
        )}
      </span>
    )
  }

  return (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/75">
        {oneLine(entry.text, 200) || entry.source}
      </span>
      <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground/40">
        {entry.charCount.toLocaleString()}
      </span>
    </span>
  )
}

function oneLine(text: string, max: number): string {
  const s = text.replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max)}…` : s
}
