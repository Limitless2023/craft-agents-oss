import type { BuiltInKanbanColumnId, KanbanColumnId, KanbanColumnMeta, KanbanTask } from './types'

/**
 * The board's default, ordered columns. Typed with the built-in id + a required
 * `labelKey` so consumers that only ever iterate this constant (Settings, the
 * color/status maps) keep exhaustive, non-optional access even though the general
 * `KanbanColumnMeta` widened `id` to string and made `labelKey` optional.
 */
export const KANBAN_COLUMNS: readonly (KanbanColumnMeta & {
  id: BuiltInKanbanColumnId
  labelKey: string
})[] = [
  { id: 'todo', labelKey: 'kanban.column.todo' },
  { id: 'in-progress', labelKey: 'kanban.column.inProgress' },
  { id: 'done', labelKey: 'kanban.column.done' },
] as const

/**
 * Default board placement for a status id.
 *
 * Placement (column) is independent from the status badge, so this is only the
 * *default* — a task may carry a different `column` (e.g. a `needs-review` task
 * parked in In Progress). Kept as one small function so the mapping is trivial
 * to change when the wiring phase introduces real, user-defined statuses.
 */
export function statusToColumn(statusId: string): KanbanColumnId {
  switch (statusId) {
    case 'in-progress':
    case 'needs-review':
      return 'in-progress'
    case 'done':
    case 'cancelled':
      return 'done'
    case 'todo':
    default:
      return 'todo'
  }
}

/**
 * 按当前激活列给任务分桶，顺序即渲染顺序：未知列 id 回退到第一列，列内最新在前。
 * KanbanBoard（渲染）与 KanbanBoardContainer（批量选择的 Shift 区间序）共用此函数，
 * 保证"视觉顺序"与"选择顺序"永远同构——分开各写一份迟早漂移。
 */
export function bucketTasksByColumn(
  tasks: readonly KanbanTask[],
  columns: readonly KanbanColumnMeta[]
): Map<KanbanColumnId, KanbanTask[]> {
  const known = new Set(columns.map(c => c.id))
  const firstColumnId = columns[0]?.id
  const buckets = new Map<KanbanColumnId, KanbanTask[]>()
  for (const c of columns) buckets.set(c.id, [])
  for (const task of tasks) {
    const target = known.has(task.column) ? task.column : firstColumnId
    if (target === undefined) continue
    buckets.get(target)!.push(task)
  }
  const recency = (t: KanbanTask) => t.createdAt ?? t.lastMessageAt ?? 0
  for (const list of buckets.values()) list.sort((a, b) => recency(b) - recency(a))
  return buckets
}
