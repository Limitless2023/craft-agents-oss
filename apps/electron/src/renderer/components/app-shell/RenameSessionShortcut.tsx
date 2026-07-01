/**
 * [INPUT]: 依赖 @/actions 的 useAction、@/components/ui/rename-dialog 的 RenameDialog、
 *          @/atoms/panel-stack 的 focusedSessionIdAtom、@/atoms/sessions 的 sessionAtomFamily、
 *          @/hooks/useSession 的 useSession、jotai 的 useAtomValue/useStore、react-i18next
 * [OUTPUT]: 对外提供 RenameSessionShortcut 组件（headless：注册 app.renameChat → 打开重命名当前会话的弹窗）
 * [POS]: app-shell 的全局快捷键处理器，由 App 单例挂载在 ActionRegistryProvider 内；单一注册规避多面板 handler 竞争
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAtomValue, useStore } from "jotai"
import { useAction } from "@/actions"
import { RenameDialog } from "@/components/ui/rename-dialog"
import { focusedSessionIdAtom } from "@/atoms/panel-stack"
import { sessionAtomFamily } from "@/atoms/sessions"
import { useSession } from "@/hooks/useSession"

interface RenameSessionShortcutProps {
  // 复用 App 的单一重命名入口 handleRenameSession
  onRename: (sessionId: string, name: string) => void
}

// ─── Cmd+R 重命名当前会话 ──────────────────────────
// 「当前会话」= 聚焦面板路由里的会话（focusedSessionIdAtom），回退到导航选择，
// 与 AppShell/ChatPage 判定当前会话的口径完全一致——只用 selected 会滞后于
// 视图（导航选择与面板焦点是两套状态），导致首次 ⌘R 命中错误/空会话。
// 只此一处注册 app.renameChat，不受面板数量或侧栏折叠影响；弹窗复用受控的 RenameDialog。
export function RenameSessionShortcut({ onRename }: RenameSessionShortcutProps) {
  const { t } = useTranslation()
  const store = useStore()
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)
  const [{ selected }] = useSession()
  const currentSessionId = focusedSessionId ?? selected

  const [open, setOpen] = useState(false)
  const [value, setValue] = useState("")
  // 打开时快照锁定目标：即便弹窗开着时焦点被后台事件切走，也只改当初那个会话
  const targetIdRef = useRef<string | null>(null)
  const originalNameRef = useRef("")

  const openDialog = useCallback(() => {
    if (!currentSessionId) return
    const name = store.get(sessionAtomFamily(currentSessionId))?.name ?? ""
    targetIdRef.current = currentSessionId
    originalNameRef.current = name
    setValue(name)
    setOpen(true)
  }, [currentSessionId, store])

  useAction("app.renameChat", openDialog, { enabled: () => !!currentSessionId }, [currentSessionId])

  const handleSubmit = useCallback(() => {
    const id = targetIdRef.current
    const name = value.trim()
    // 名称为空或未改动则跳过（与 ChatPage 参照实现一致，避免误触发标题重写）
    if (id && name && name !== originalNameRef.current) {
      onRename(id, name)
    }
    setOpen(false)
  }, [value, onRename])

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
