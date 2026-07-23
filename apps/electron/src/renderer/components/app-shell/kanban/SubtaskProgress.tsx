import { cn } from '@/lib/utils'
import type { KanbanSubtask } from './types'

interface SubtaskProgressProps {
  subtasks: KanbanSubtask[]
  /**
   * Total expected subtasks (the denominator). Defaults to `subtasks.length`. When larger — e.g. a
   * Conductor run whose child sessions spawn lazily — the extra slots render as pending filler so the
   * count and bar stay stable instead of growing as children appear.
   */
  total?: number
  /** Accent color for done/running segments. Defaults to the theme accent. */
  accent?: string
  className?: string
}

const PENDING_TRACK = 'color-mix(in srgb, currentColor 12%, transparent)'

/**
 * One segment per subtask: done/running segments fill with the accent (running
 * ones pulse), pending segments stay a faint track. A trailing `done/total`
 * count gives the exact tally. Renders nothing when there are no subtasks.
 */
// 注意：宿主没有 --primary（品牌色叫 --accent，viz 主题桥修过同一个坑），
// 默认值必须用 --accent，写 --primary 等于无回退
export function SubtaskProgress({ subtasks, total: totalProp, accent = 'var(--accent)', className }: SubtaskProgressProps) {
  const revealed = subtasks.length
  // Never let the denominator drop below what's already revealed (guards a stale/low total).
  const total = Math.max(totalProp ?? revealed, revealed)
  if (total === 0) return null
  const done = subtasks.filter(s => s.runState === 'done').length
  const unrevealed = total - revealed

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div
        className="flex flex-1 gap-0.5"
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
      >
        {subtasks.map(subtask => (
          <span
            key={subtask.id}
            className={cn('h-1 flex-1 rounded-full', subtask.runState === 'running' && 'animate-pulse')}
            style={{
              backgroundColor:
                subtask.runState === 'failed'
                  ? '#ef4444' // red-500, matches the failed glyph in SubtaskRow
                  : subtask.runState === 'pending'
                    ? PENDING_TRACK
                    : accent,
            }}
          />
        ))}
        {Array.from({ length: unrevealed }, (_, i) => (
          <span
            key={`pending-${i}`}
            className="h-1 flex-1 rounded-full"
            style={{ backgroundColor: PENDING_TRACK }}
          />
        ))}
      </div>
      <span className="shrink-0 text-[11px] font-medium tabular-nums text-foreground/50">
        {done}/{total}
      </span>
    </div>
  )
}
