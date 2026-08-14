/**
 * [INPUT]: 依赖 @craft-agent/ui 的 FullscreenOverlayBaseHeader，依赖 @/lib/trajectory-core 的解析/
 *          时间轴/统计，依赖同目录 TrajectoryLanes / TrajectoryList / TrajectoryDetail /
 *          TrajectoryComposition，依赖 window.electronAPI 的 readFile / homeDir
 * [OUTPUT]: 对外提供 TrajectoryOverlay —— 「这个会话里模型实际收到了什么、什么时候、花了多久」
 * [POS]: trajectory 模块的编排层：拉数据、持有选中/筛选/搜索/轴口径，四个子视图共享这份状态。
 *        刻意不用 PreviewOverlay：那个外壳把 children 放进带渐隐遮罩的**文档滚动容器**里，
 *        而这里要的是"顶栏固定 + 中间双栏各自滚 + 底部统计固定"的应用式布局，两者天然冲突。
 *        数据源见 trajectory-core 头部（SDK transcript + craft 自写的 system-prompt sidecar）。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw, Route } from 'lucide-react'
import { FullscreenOverlayBaseHeader } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import {
  buildTimeline,
  entryInRange,
  formatDuration,
  formatTokens,
  mergeTrajectory,
  parseSystemPromptSidecar,
  parseTrajectory,
  sdkTranscriptPath,
  summarizeRun,
  summarizeTools,
  summarizeTrajectory,
  systemPromptSidecarPath,
  type AxisMode,
  type TimeRange,
  type TrajectoryEntry,
  type TrajectoryKind,
} from '@/lib/trajectory-core'
import { TrajectoryComposition } from './TrajectoryComposition'
import { TrajectoryDetail } from './TrajectoryDetail'
import { TrajectoryLanes } from './TrajectoryLanes'
import { TrajectoryList } from './TrajectoryList'
import { TrajectorySidePanel } from './TrajectorySidePanel'

/** 明细列表最多渲染的行数（未虚拟滚动）。超出部分在列表顶部明示。 */
const LIST_CAP = 3000

export interface TrajectoryOverlayProps {
  isOpen: boolean
  onClose: () => void
  sessionTitle: string
  sdkSessionId?: string
  sdkCwd?: string
  sessionFolderPath?: string
}

export function TrajectoryOverlay({
  isOpen,
  onClose,
  sessionTitle,
  sdkSessionId,
  sdkCwd,
  sessionFolderPath,
}: TrajectoryOverlayProps) {
  const { t } = useTranslation()
  const [entries, setEntries] = React.useState<TrajectoryEntry[] | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [activeKind, setActiveKind] = React.useState<TrajectoryKind | 'all'>('all')
  const [axisMode, setAxisMode] = React.useState<AxisMode>('duration')
  const [query, setQuery] = React.useState('')
  const [selected, setSelected] = React.useState<number | null>(null)
  /** 时间轴上框出的时间窗口。看到一段很慢，就想知道那几十秒里到底在干嘛。 */
  const [brush, setBrush] = React.useState<TimeRange | null>(null)

  React.useEffect(() => {
    if (!isOpen) return
    let cancelled = false
    setEntries(null)
    setError(null)
    setSelected(null)
    setBrush(null)

    void (async () => {
      try {
        const home = await window.electronAPI.homeDir()
        const path = sdkTranscriptPath(home, sdkCwd, sdkSessionId)
        if (!path) {
          if (!cancelled) setError(t('trajectory.errorNoSdkSession'))
          return
        }
        const raw = await window.electronAPI.readFile(path)
        if (cancelled) return

        // 第二档：craft 自写的系统提示词 sidecar。会话跑在旧版本上时它不存在，
        // 那不是错误——主轨迹照常显示，只是少了系统提示词那一条。
        let systemPrompts: TrajectoryEntry[] = []
        const sidecar = systemPromptSidecarPath(sessionFolderPath)
        if (sidecar) {
          try {
            systemPrompts = parseSystemPromptSidecar(await window.electronAPI.readFile(sidecar))
          } catch {
            systemPrompts = []
          }
        }
        if (!cancelled) setEntries(mergeTrajectory(parseTrajectory(raw), systemPrompts))
      } catch {
        if (!cancelled) setError(t('trajectory.errorNotFound'))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, sdkCwd, sdkSessionId, sessionFolderPath, reloadToken, t])

  // Esc 关闭：本组件自持 portal，没有外壳代管
  React.useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // 先清掉聚焦态（框选 + 详情），再按才关整个视图
      if (selected != null || brush != null) {
        setSelected(null)
        setBrush(null)
      } else onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [isOpen, onClose, selected, brush])

  const summary = React.useMemo(() => (entries ? summarizeTrajectory(entries) : null), [entries])
  const timeline = React.useMemo(() => (entries ? buildTimeline(entries) : null), [entries])
  const run = React.useMemo(
    () => (entries && timeline ? summarizeRun(entries, timeline) : null),
    [entries, timeline],
  )

  /**
   * 列表可见集合。三道过滤叠加：
   * 1. `other` 永远不显示（queue-operation 之类的记账行，零信息量）
   * 2. **已配对的工具结果不单独成行**——它已经在调用行的箭头右边
   * 3. 大类筛选 + 搜索
   */
  const visible = React.useMemo(() => {
    if (!entries) return []
    const pairedResults = new Set(
      entries.filter(e => e.kind === 'tool-call' && e.resultText != null).map(e => e.toolUseId),
    )
    const q = query.trim().toLowerCase()
    return entries.filter(e => {
      if (e.kind === 'other') return false
      if (e.kind === 'tool-result' && e.toolUseId && pairedResults.has(e.toolUseId)) return false
      if (activeKind !== 'all' && e.kind !== activeKind) return false
      if (q && !`${e.source} ${e.toolName ?? ''} ${e.text}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [entries, activeKind, query])

  /**
   * 超长会话只渲染尾部：列表未做虚拟滚动，上万行会把这个视图变成卡顿的日志窗口。
   * 统计与时间轴仍吃全量数据——被截掉的只是"逐条明细"，占比与耗时口径不受影响。
   */
  const listEntries = React.useMemo(
    () => (visible.length > LIST_CAP ? visible.slice(-LIST_CAP) : visible),
    [visible],
  )

  const brushedCount = React.useMemo(
    () => (brush ? visible.filter(e => entryInRange(e, brush)).length : 0),
    [visible, brush],
  )

  /**
   * 工具耗时排行。**按框选窗口收窄**：框出慢的那一段后，要问的是"这 40 秒里谁最慢"，
   * 而不是整场会话的总账。不受大类筛选影响——筛选是看的镜头，框选才是范围。
   */
  const toolStats = React.useMemo(
    () => summarizeTools((entries ?? []).filter(e => entryInRange(e, brush))),
    [entries, brush],
  )

  const matchedIndices = React.useMemo(() => {
    if (!query.trim() && activeKind === 'all') return null
    return new Set(visible.map(e => e.index))
  }, [visible, query, activeKind])

  const selectedEntry = React.useMemo(
    () => (selected == null ? null : entries?.find(e => e.index === selected) ?? null),
    [entries, selected],
  )

  const turnLabel = React.useCallback((turn: number) => t('trajectory.turn', { n: turn }), [t])
  /** 双栏容器：右栏宽度上限按它的实际宽度算，窗口变化时跟着收。 */
  const splitRef = React.useRef<HTMLDivElement>(null)

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <FullscreenOverlayBaseHeader
        onClose={onClose}
        typeBadge={{ icon: Route, label: 'TRAJECTORY', variant: 'purple' }}
        title={sessionTitle}
        subtitle={
          summary ? t('trajectory.subtitle', { count: summary.totalChars.toLocaleString() }) : undefined
        }
        headerActions={
          <button
            type="button"
            onClick={() => setReloadToken(n => n + 1)}
            title={t('common.refresh')}
            className="rounded-[6px] p-1.5 text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 border-b border-border/60 bg-foreground/[0.04] px-4 py-3 text-[13px] text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive/70" />
          {error}
        </div>
      )}

      {!entries && !error && (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      )}

      {entries && timeline && summary && run && (
        <>
          <TrajectoryLanes
            timeline={timeline}
            axisMode={axisMode}
            onAxisModeChange={setAxisMode}
            selectedIndex={selected}
            onSelect={setSelected}
            query={query}
            onQueryChange={setQuery}
            matchedIndices={matchedIndices}
            brush={brush}
            onBrushChange={setBrush}
            brushedCount={brushedCount}
          />

          <div ref={splitRef} className="flex min-h-0 flex-1">
            <TrajectoryList
              entries={listEntries}
              selectedIndex={selected}
              onSelect={setSelected}
              turnLabel={turnLabel}
              brush={brush}
              truncatedNotice={
                visible.length > LIST_CAP
                  ? t('trajectory.truncated', { n: visible.length - LIST_CAP })
                  : undefined
              }
            />
            <TrajectorySidePanel containerRef={splitRef}>
              {selectedEntry ? (
                <TrajectoryDetail
                  entry={selectedEntry}
                  onClose={() => setSelected(null)}
                  turnLabel={turnLabel}
                />
              ) : (
                <TrajectoryComposition
                  summary={summary}
                  totalVisible={visible.length}
                  activeKind={activeKind}
                  onKindChange={setActiveKind}
                  hasSystemPrompt={entries.some(e => e.kind === 'system-prompt')}
                  tools={toolStats}
                  toolsScoped={brush != null}
                />
              )}
            </TrajectorySidePanel>
          </div>

          <StatusBar
            run={run}
            label={{
              turns: t('trajectory.stat.turns', { n: run.turns }),
              steps: t('trajectory.stat.steps', { n: run.steps }),
              model: t('trajectory.stat.model'),
              tools: t('trajectory.stat.tools'),
              cache: t('trajectory.stat.cacheHit'),
              tokensIn: t('trajectory.stat.tokensIn'),
              tokensOut: t('trajectory.stat.tokensOut'),
            }}
          />
        </>
      )}
    </div>,
    document.body,
  )
}

function StatusBar({
  run,
  label,
}: {
  run: NonNullable<ReturnType<typeof summarizeRun>>
  label: Record<'turns' | 'steps' | 'model' | 'tools' | 'cache' | 'tokensIn' | 'tokensOut', string>
}) {
  const cell = 'whitespace-nowrap'
  return (
    <footer className="flex shrink-0 items-center gap-3 overflow-x-auto border-t border-border/60 bg-background-elevated/40 px-4 py-1.5 text-[11px] text-muted-foreground">
      <span className={cn(cell, 'text-foreground/80')}>
        {label.turns} · {label.steps}
      </span>
      <Sep />
      <span className={cell}>
        {label.model} {formatDuration(run.modelMs)} · {label.tools} {formatDuration(run.toolMs)} (
        {run.toolCalls})
      </span>
      <Sep />
      <span className={cell}>
        {label.cache} {run.cacheHitRate == null ? '—' : `${Math.round(run.cacheHitRate * 100)}%`}
      </span>
      <Sep />
      <span className={cell}>
        {label.tokensIn} {formatTokens(run.inputTokens)} · {label.tokensOut}{' '}
        {formatTokens(run.outputTokens)}
      </span>
    </footer>
  )
}

function Sep() {
  return <span className="text-border">|</span>
}
