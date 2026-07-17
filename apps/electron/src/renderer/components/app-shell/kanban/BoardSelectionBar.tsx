/**
 * [INPUT]: 依赖 @/components/ui/session-status-menu 的 SessionStatusMenu（可搜索状态选单）、
 *          @/components/ui/popover 的 Popover 三件套、lucide-react 图标、react-i18next
 * [OUTPUT]: 对外提供 BoardSelectionBar 组件——看板批量选择的底部浮动操作条
 * [POS]: kanban 批量操作的唯一执行入口：卡片手势与列头菜单只负责"选"，改状态/归档/
 *        "已取消并归档"清理组合/清除选择全部由本条触发，回调上抛 KanbanBoardContainer
 *        执行逐 id 的 sessionCommand 循环
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { Archive, ArchiveX, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { SessionStatus } from '@/config/session-status-config'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { SessionStatusMenu } from '@/components/ui/session-status-menu'

const BAR_BTN =
  'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-foreground/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'

interface BoardSelectionBarProps {
  /** 选中数量（容器只在 >0 时挂载本条）。 */
  count: number
  /** workspace 状态全集（有序），喂给批量改状态的选单。 */
  statuses: SessionStatus[]
  /** 批量改状态（容器侧同步修正 kanbanColumn 落位）。 */
  onSetStatus: (statusId: string) => void
  /** 批量归档（可从列表视图找回）。 */
  onArchive: () => void
  /** 清理组合：标记已取消 + 清除列落位残留 + 归档。 */
  onCancelAndArchive: () => void
  /** 清除选择，退出选择模式。 */
  onClear: () => void
}

export function BoardSelectionBar({
  count,
  statuses,
  onSetStatus,
  onArchive,
  onCancelAndArchive,
  onClear,
}: BoardSelectionBarProps) {
  const { t } = useTranslation()
  const [statusOpen, setStatusOpen] = React.useState(false)

  return (
    <div className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-background px-2 py-1.5 shadow-modal-small">
      <span className="px-1.5 text-xs font-medium tabular-nums text-foreground/70">
        {t('kanban.select.selected', { count })}
      </span>
      <div className="h-4 w-px bg-border" aria-hidden />
      <Popover open={statusOpen} onOpenChange={setStatusOpen}>
        <PopoverTrigger asChild>
          <button type="button" className={BAR_BTN}>
            {t('kanban.changeStatus')}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="center"
          sideOffset={6}
          className="w-auto border-0 bg-transparent p-0 shadow-none"
        >
          <SessionStatusMenu
            states={statuses}
            activeState=""
            onSelect={statusId => {
              setStatusOpen(false)
              onSetStatus(statusId)
            }}
          />
        </PopoverContent>
      </Popover>
      <button type="button" className={BAR_BTN} onClick={onArchive}>
        <Archive className="h-3.5 w-3.5" strokeWidth={2} />
        {t('sessionMenu.archive')}
      </button>
      <button
        type="button"
        className={cn(BAR_BTN, 'text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400')}
        onClick={onCancelAndArchive}
      >
        <ArchiveX className="h-3.5 w-3.5" strokeWidth={2} />
        {t('kanban.select.cancelArchive')}
      </button>
      <div className="h-4 w-px bg-border" aria-hidden />
      <button
        type="button"
        className={BAR_BTN}
        onClick={onClear}
        title={t('kanban.select.clear')}
        aria-label={t('kanban.select.clear')}
      >
        <X className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
    </div>
  )
}
