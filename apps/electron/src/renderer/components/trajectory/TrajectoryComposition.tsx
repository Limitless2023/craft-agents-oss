/**
 * [INPUT]: 依赖 @/lib/trajectory-core 的 TrajectorySummary/TrajectoryKind，依赖 ./kind-meta 的 KIND_META
 * [OUTPUT]: 对外提供 TrajectoryComposition —— 上下文构成条 + 大类筛选 + 注入块排行 +
 *          工具耗时排行 + 盲区声明
 * [POS]: 右栏的**默认页**（选中某条目后让位给 TrajectoryDetail）。这块是轨迹视图区别于
 *        普通日志查看器的地方：不是"发生了什么"，而是"上下文预算被谁吃掉了"。
 *        大类 chip 同时充当列表筛选器——分析与筛选在同一处，不必两处找。
 *        宽度由 TrajectorySidePanel 持有（与 TrajectoryDetail 共用槽位）。
 *        除了上下文预算，这里还回答另一个维度：时间被谁吃了（工具耗时排行）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { formatDuration, type ToolStat, type TrajectoryKind, type TrajectorySummary } from '@/lib/trajectory-core'
import { KIND_META } from './kind-meta'

export interface TrajectoryCompositionProps {
  summary: TrajectorySummary
  totalVisible: number
  activeKind: TrajectoryKind | 'all'
  onKindChange: (kind: TrajectoryKind | 'all') => void
  /** 第二档是否到位——没有 sidecar 时盲区文案要说得更满。 */
  hasSystemPrompt: boolean
  /** 工具耗时排行。框选时只统计窗口内——"这 40 秒里谁最慢"才是要问的。 */
  tools: ToolStat[]
  /** 排行是否被框选限定了范围，须在标题上说明，否则数字对不上底部统计。 */
  toolsScoped: boolean
}

export function TrajectoryComposition({
  summary,
  totalVisible,
  activeKind,
  onKindChange,
  hasSystemPrompt,
  tools,
  toolsScoped,
}: TrajectoryCompositionProps) {
  const { t } = useTranslation()
  const kinds = summary.byKind.filter(k => k.kind !== 'other' && k.count > 0)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <h3 className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
        {t('trajectory.composition')}
      </h3>
      <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-foreground/[0.06]">
        {kinds
          .filter(k => k.share > 0)
          .map(k => (
            <div
              key={k.kind}
              className={cn('h-full', KIND_META[k.kind].bar)}
              style={{ width: `${Math.max(k.share * 100, 0.5)}%` }}
              title={`${t(KIND_META[k.kind].labelKey)} ${(k.share * 100).toFixed(1)}%`}
            />
          ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        <Chip
          active={activeKind === 'all'}
          onClick={() => onKindChange('all')}
          label={t('trajectory.all')}
          count={totalVisible}
        />
        {kinds.map(k => (
          <Chip
            key={k.kind}
            active={activeKind === k.kind}
            onClick={() => onKindChange(k.kind)}
            label={t(KIND_META[k.kind].labelKey)}
            count={k.count}
            share={k.share}
            dot={KIND_META[k.kind].bar}
          />
        ))}
      </div>

      {summary.injections.length > 0 && (
        <>
          <h3 className="mb-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {t('trajectory.injections')}
          </h3>
          <div className="mb-4 space-y-1">
            {summary.injections.map(i => (
              <div key={i.source} className="flex items-baseline gap-2 text-[12px]">
                <span className="font-mono text-accent">{i.source}</span>
                <span className="flex-1 border-b border-dashed border-border/50" />
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {i.count}× · {i.chars.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {tools.length > 0 && (
        <>
          <h3 className="mb-2 flex items-baseline gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
            {t('trajectory.toolRanking')}
            {toolsScoped && (
              <span className="rounded-full bg-accent/15 px-1.5 py-px text-[9px] normal-case tracking-normal text-accent">
                {t('trajectory.scopedToSelection')}
              </span>
            )}
          </h3>
          <div className="mb-4 space-y-1">
            {tools.map(tool => (
              <ToolRow key={tool.name} tool={tool} maxMs={tools[0]!.totalMs} />
            ))}
          </div>
        </>
      )}

      {summary.compactions > 0 && (
        <p className="mb-4 rounded-[8px] bg-destructive/[0.07] px-3 py-2 text-[11px] leading-relaxed text-destructive/90">
          {t('trajectory.compactionNote', { n: summary.compactions })}
        </p>
      )}

      <p className="rounded-[8px] bg-foreground/[0.03] px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {hasSystemPrompt ? t('trajectory.blindSpotTier2') : t('trajectory.blindSpot')}
      </p>
    </div>
  )
}

/**
 * 一行 = 一个工具。条形按占最慢者的比例画——绝对秒数看不出"谁是瓶颈"，比例才看得出。
 * 一次都没计到时长时显示 —，不写 0.0s：那会让"还没返回"看起来像"瞬间完成"。
 */
function ToolRow({ tool, maxMs }: { tool: ToolStat; maxMs: number }) {
  const { t } = useTranslation()
  const share = maxMs > 0 ? tool.totalMs / maxMs : 0
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline gap-2 text-[12px]">
        <span className="truncate font-mono text-foreground/85">{tool.name}</span>
        {tool.errors > 0 && (
          <span className="shrink-0 text-[10px] text-destructive/80">
            {t('trajectory.toolErrors', { n: tool.errors })}
          </span>
        )}
        <span className="flex-1" />
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {tool.calls}× · {tool.timedCalls > 0 ? formatDuration(tool.totalMs) : '—'}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className={cn('h-full rounded-full', tool.errors > 0 ? 'bg-destructive/60' : 'bg-info/70')}
          style={{ width: `${Math.max(share * 100, share > 0 ? 2 : 0)}%` }}
        />
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  label,
  count,
  share,
  dot,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  share?: number
  dot?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] transition-colors',
        active ? 'bg-foreground/[0.08] text-foreground' : 'text-muted-foreground hover:bg-foreground/[0.04]',
      )}
    >
      {dot && <span className={cn('h-2 w-2 rounded-full', dot)} />}
      {label}
      <span className="tabular-nums text-muted-foreground/60">
        {count}
        {share != null && ` · ${(share * 100).toFixed(0)}%`}
      </span>
    </button>
  )
}
