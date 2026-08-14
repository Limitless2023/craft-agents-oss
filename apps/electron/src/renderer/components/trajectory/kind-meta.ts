/**
 * [INPUT]: 依赖 @/lib/trajectory-core 的 TrajectoryKind
 * [OUTPUT]: 对外提供 KIND_META（大类 → 角色标签/配色/i18n 键）、ROLE_ORDER、laneOf
 * [POS]: trajectory 模块的展示词典。时间轴、明细列表、右侧详情三处共用同一份配色与角色名，
 *        分开写必然漂移——同一条目在泳道里是蓝的、在列表里是紫的，读者会以为是两回事。
 *        角色标签（SYSTEM/USER/CONTEXT/…）刻意保持英文大写常量：它是数据分类学而非文案，
 *        与日志级别同性质，翻译反而丢失可辨识度。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { Lane, TrajectoryKind } from '@/lib/trajectory-core'

export interface KindMeta {
  /** 左槽角色标签，固定英文大写。 */
  role: string
  /** i18n 键，用于筛选 chip 与详情页标题。 */
  labelKey: string
  /** 实心色块（时间轴段、chip 圆点）。 */
  bar: string
  /** 文字色（角色标签、来源名）。 */
  text: string
  /** 该大类落在哪条泳道；null = 不上时间轴。 */
  lane: Lane | null
}

export const KIND_META: Record<TrajectoryKind, KindMeta> = {
  'system-prompt': {
    role: 'SYSTEM',
    labelKey: 'trajectory.kind.systemPrompt',
    bar: 'bg-success',
    text: 'text-success',
    // 不上泳道：它不是某一刻发生的事件，而是整场会话的常量配置
    lane: null,
  },
  injection: {
    role: 'CONTEXT',
    labelKey: 'trajectory.kind.injection',
    bar: 'bg-accent',
    text: 'text-accent',
    lane: 'input',
  },
  prompt: {
    role: 'USER',
    labelKey: 'trajectory.kind.prompt',
    bar: 'bg-foreground/70',
    text: 'text-foreground',
    lane: 'input',
  },
  thinking: {
    role: 'THINKING',
    labelKey: 'trajectory.kind.thinking',
    bar: 'bg-foreground/30',
    text: 'text-muted-foreground',
    lane: 'model',
  },
  reply: {
    role: 'ASSISTANT',
    labelKey: 'trajectory.kind.reply',
    bar: 'bg-foreground/45',
    text: 'text-foreground/80',
    lane: 'model',
  },
  'tool-call': {
    role: 'TOOL',
    labelKey: 'trajectory.kind.toolCall',
    bar: 'bg-info',
    text: 'text-info',
    lane: 'tools',
  },
  'tool-result': {
    role: 'RESULT',
    labelKey: 'trajectory.kind.toolResult',
    bar: 'bg-info/50',
    text: 'text-info/80',
    lane: 'tools',
  },
  compaction: {
    role: 'COMPACT',
    labelKey: 'trajectory.kind.compaction',
    bar: 'bg-destructive',
    text: 'text-destructive',
    lane: null,
  },
  system: {
    role: 'SYSTEM',
    labelKey: 'trajectory.kind.system',
    bar: 'bg-foreground/20',
    text: 'text-muted-foreground',
    lane: null,
  },
  other: {
    role: 'MISC',
    labelKey: 'trajectory.kind.other',
    bar: 'bg-foreground/10',
    text: 'text-muted-foreground/60',
    lane: null,
  },
}

/** 泳道显示顺序与标题——与 DeepSeek 的 Input / Model / Tools 一致。 */
export const LANES: Array<{ lane: Lane; label: string }> = [
  { lane: 'input', label: 'Input' },
  { lane: 'model', label: 'Model' },
  { lane: 'tools', label: 'Tools' },
]

export function laneOf(kind: TrajectoryKind): Lane | null {
  return KIND_META[kind].lane
}
