/**
 * [INPUT]: 依赖 @/actions 的 useAction、@/components/ui/rename-dialog 的 RenameDialog、react-i18next 的 useTranslation
 * [OUTPUT]: 对外提供 RenameSessionShortcut 组件（headless：注册 app.renameChat → 打开重命名当前会话的弹窗）
 * [POS]: app-shell 的全局快捷键处理器，由 App 单例挂载在 ActionRegistryProvider 内；单一注册规避多面板 handler 竞争
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAction } from "@/actions"
import { RenameDialog } from "@/components/ui/rename-dialog"

interface RenameSessionShortcutProps {
  // 当前主内容区展示的会话 id（无会话时为 null，快捷键失效）
  currentSessionId: string | null
  // 当前会话标题，用于预填输入框
  currentName: string
  // 复用 App 的单一重命名入口 handleRenameSession
  onRename: (sessionId: string, name: string) => void
}

// ─── Cmd+R 重命名当前会话 ──────────────────────────
// 只此一处注册 app.renameChat，重命名的目标恒为"当前会话"，
// 不受面板数量或侧栏折叠影响；弹窗复用受控的 RenameDialog。
export function RenameSessionShortcut({
  currentSessionId,
  currentName,
  onRename,
}: RenameSessionShortcutProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")

  const openDialog = useCallback(() => {
    setValue(currentName)
    setOpen(true)
  }, [currentName])

  useAction(
    "app.renameChat",
    openDialog,
    { enabled: () => !!currentSessionId },
    [currentSessionId, currentName]
  )

  const handleSubmit = useCallback(() => {
    const name = value.trim()
    if (currentSessionId && name) {
      onRename(currentSessionId, name)
    }
    setOpen(false)
  }, [currentSessionId, value, onRename])

  return (
    <RenameDialog
      open={open}
      onOpenChange={setOpen}
      title={t("chat.renameSession")}
      value={value}
      onValueChange={setValue}
      onSubmit={handleSubmit}
      placeholder={t("chat.enterSessionName")}
    />
  )
}
