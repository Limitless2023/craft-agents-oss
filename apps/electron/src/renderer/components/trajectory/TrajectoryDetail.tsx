/**
 * [INPUT]: 依赖 @/lib/trajectory-core 的 TrajectoryEntry/formatDuration/formatTokens，
 *          依赖 ./kind-meta 的 KIND_META，react-i18next，lucide-react
 * [OUTPUT]: 对外提供 TrajectoryDetail —— 右侧分页详情面板
 * [POS]: trajectory 模块的"看全文"出口。列表只给一行，全文、原始入参、完整结果、
 *        计时全在这里。Payload/Result 两页仅工具条目有——对非工具条目留空页
 *        比隐藏更糟，所以按条目类型动态给页签。宽度不归它管——与 TrajectoryComposition
 *        轮流占同一槽位，尺寸由 TrajectorySidePanel 持有，否则切换时会跳。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDuration, formatTokens, type TrajectoryEntry } from '@/lib/trajectory-core'
import { KIND_META } from './kind-meta'

type TabId = 'summary' | 'payload' | 'result' | 'raw' | 'timing'

export interface TrajectoryDetailProps {
  entry: TrajectoryEntry
  onClose: () => void
  turnLabel: (turn: number) => string
}

export function TrajectoryDetail({ entry, onClose, turnLabel }: TrajectoryDetailProps) {
  const { t } = useTranslation()
  const isTool = entry.kind === 'tool-call' || entry.kind === 'tool-result'
  const tabs = React.useMemo<Array<{ id: TabId; labelKey: string }>>(() => {
    const list: Array<{ id: TabId; labelKey: string }> = [
      { id: 'summary', labelKey: 'trajectory.tab.summary' },
    ]
    if (isTool) {
      list.push({ id: 'payload', labelKey: 'trajectory.tab.payload' })
      list.push({ id: 'result', labelKey: 'trajectory.tab.result' })
    } else {
      list.push({ id: 'payload', labelKey: 'trajectory.tab.content' })
    }
    list.push({ id: 'raw', labelKey: 'trajectory.tab.raw' })
    list.push({ id: 'timing', labelKey: 'trajectory.tab.timing' })
    return list
  }, [isTool])

  const [tab, setTab] = React.useState<TabId>('summary')
  // 切条目时页签回到概览：上一条留在 Result 页、下一条没有 Result，会看到空白
  React.useEffect(() => {
    setTab('summary')
  }, [entry.index])

  const meta = KIND_META[entry.kind]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
        <span className={cn('font-mono text-[10px] uppercase tracking-wide', meta.text)}>
          {meta.role}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {entry.turn > 0 ? `${turnLabel(entry.turn)} · ${t('trajectory.step', { n: entry.step })}` : entry.source}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <nav className="flex gap-1 border-b border-border/60 px-2 py-1.5">
        {tabs.map(tb => (
          <button
            key={tb.id}
            type="button"
            onClick={() => setTab(tb.id)}
            className={cn(
              'rounded-[6px] px-2 py-1 text-[11px] transition-colors',
              tab === tb.id
                ? 'bg-accent/15 text-accent'
                : 'text-muted-foreground hover:bg-foreground/[0.05]',
            )}
          >
            {t(tb.labelKey)}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'summary' && <SummaryTab entry={entry} />}
        {tab === 'payload' && (
          <Mono text={entry.kind === 'tool-call' ? pretty(entry.toolInput) : entry.text} />
        )}
        {tab === 'result' && (
          <Mono
            text={entry.resultText ?? (entry.kind === 'tool-result' ? entry.text : '')}
            tone={entry.resultIsError ? 'error' : undefined}
          />
        )}
        {tab === 'raw' && <Mono text={pretty(entry.raw)} />}
        {tab === 'timing' && <TimingTab entry={entry} />}
      </div>
    </div>
  )
}

function SummaryTab({ entry }: { entry: TrajectoryEntry }) {
  const { t } = useTranslation()
  return (
    <dl className="space-y-1.5 text-[12px]">
      <Row label={t('trajectory.field.source')} value={entry.source} mono />
      <Row label={t('trajectory.field.chars')} value={entry.charCount.toLocaleString()} />
      {entry.model && <Row label={t('trajectory.field.model')} value={entry.model} mono />}
      {entry.usage && (
        <>
          <Row
            label={t('trajectory.field.tokensIn')}
            value={formatTokens(entry.usage.input + entry.usage.cacheRead + entry.usage.cacheCreation)}
          />
          <Row label={t('trajectory.field.tokensOut')} value={formatTokens(entry.usage.output)} />
          <Row label={t('trajectory.field.cacheRead')} value={formatTokens(entry.usage.cacheRead)} />
        </>
      )}
      {entry.requestId && <Row label="requestId" value={entry.requestId} mono />}
      {entry.toolUseId && <Row label="toolUseId" value={entry.toolUseId} mono />}
      <div className="pt-2">
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-foreground/80">
          {entry.text.slice(0, 4000)}
        </p>
      </div>
    </dl>
  )
}

function TimingTab({ entry }: { entry: TrajectoryEntry }) {
  const { t } = useTranslation()
  return (
    <dl className="space-y-1.5 text-[12px]">
      <Row
        label={t('trajectory.field.started')}
        value={entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}
      />
      <Row
        label={t('trajectory.field.duration')}
        value={entry.durationMs != null ? formatDuration(entry.durationMs) : '—'}
      />
      <Row label={t('trajectory.field.timingSource')} value={t('trajectory.timingSourceValue')} />
      <p className="pt-2 text-[11px] leading-relaxed text-muted-foreground">
        {t('trajectory.timingNote')}
      </p>
    </dl>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-[92px] shrink-0 text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 flex-1 break-all text-foreground/85', mono && 'font-mono text-[11px]')}>
        {value}
      </dd>
    </div>
  )
}

function Mono({ text, tone }: { text: string; tone?: 'error' }) {
  if (!text) return <p className="text-[12px] text-muted-foreground">—</p>
  return (
    <pre
      className={cn(
        'whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed',
        tone === 'error' ? 'text-destructive/90' : 'text-foreground/80',
      )}
    >
      {text}
    </pre>
  )
}

function pretty(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
