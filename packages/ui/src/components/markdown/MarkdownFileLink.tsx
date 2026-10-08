/**
 * [INPUT]: 依赖 react / react-i18next，依赖 ../../context/PlatformContext 的 usePlatform（取
 *          onOpenFileExternal），依赖 ../ui/StyledDropdown 的 Radix 下拉原语，依赖
 *          ./link-target 的 resolveMarkdownLinkTarget 与 ../../lib/file-classification
 *          的 isBrowserOpenableFilePath
 * [OUTPUT]: 对外提供 MarkdownFileLink —— 消息正文里的链接锚点（左键行为与上游一致，
 *          右键在 .html 链接上多一条「在浏览器中打开」）
 * [POS]: Markdown.tsx 的 `a` 渲染器委托到这里。单独成文件而不是写在 createComponents 里，
 *        是因为它需要自己的菜单状态——内联箭头组件里挂 hook 会随组件表 memo 重建而丢状态。
 *
 *        **为什么能直接拿到打开能力、不用穿 prop 链**：`onOpenFileExternal` 住在
 *        packages/ui 自己的 PlatformContext 里（App.tsx 经 PlatformProvider 注入，
 *        与 PDF 外部打开同一条）。因此本功能**零新增回调参数**，自然绕开了
 *        “往 createComponents 加回调会让 fence 整树重挂” 那条历史教训。
 *
 *        **为什么不走 shell.openExternal(file://)**：`file:` 在 url-safety.ts 里被
 *        刻意拉黑（Electron 在 Windows 上可借此启动本地可执行文件，RCE 类）。这里走
 *        与 PDF 相同的 `shell.openPath`，由系统按 .html 的默认关联程序打开——绝大多数
 *        机器上就是默认浏览器。
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink } from 'lucide-react'
import { usePlatform } from '../../context/PlatformContext'
import { isBrowserOpenableFilePath } from '../../lib/file-classification'
import { resolveMarkdownLinkTarget } from './link-target'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  StyledDropdownMenuContent,
  StyledDropdownMenuItem,
} from '../ui/StyledDropdown'

export interface MarkdownFileLinkProps {
  /** 原始 href（未经 sanitize），点击时用它解析目标。 */
  rawHref: string
  /** 经 defaultUrlTransform 过滤后的 href，仅用于 <a> 的属性；危险 scheme 下为 undefined。 */
  safeHref?: string
  children?: React.ReactNode
  onFileClick?: (path: string) => void
  onUrlClick?: (url: string) => void
}

export function MarkdownFileLink({
  rawHref,
  safeHref,
  children,
  onFileClick,
  onUrlClick,
}: MarkdownFileLinkProps) {
  const { t } = useTranslation()
  const { onOpenFileExternal } = usePlatform()
  const [menuAt, setMenuAt] = React.useState<{ x: number; y: number } | null>(null)

  /**
   * 解析一次目标。href 可能为空——有些模型输出的是裸 <a> 标签，路径在文本内容里，
   * 所以回落到锚文本（与上游 `a` 渲染器的行为一致）。
   */
  const resolveTarget = React.useCallback(() => {
    const fallbackText = React.Children.toArray(children)
      .map((child) => (typeof child === 'string' ? child : ''))
      .join('')
      .trim()
    const target = rawHref || fallbackText
    if (!target) return null
    return resolveMarkdownLinkTarget(target)
  }, [rawHref, children])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    const resolved = resolveTarget()
    if (!resolved) return
    if (resolved.kind === 'file' && onFileClick) {
      onFileClick(resolved.path)
    } else if (resolved.kind === 'url' && onUrlClick) {
      onUrlClick(resolved.url)
    }
  }

  /** 右键命中的文件路径；非 .html 文件链接与网址一律为 null（保留系统原生右键菜单）。 */
  const browserOpenablePath = React.useMemo(() => {
    if (!onOpenFileExternal) return null
    const resolved = resolveTarget()
    if (!resolved || resolved.kind !== 'file') return null
    return isBrowserOpenableFilePath(resolved.path) ? resolved.path : null
  }, [onOpenFileExternal, resolveTarget])

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!browserOpenablePath) return // 不拦截：其余链接保持原生右键菜单
    e.preventDefault()
    setMenuAt({ x: e.clientX, y: e.clientY })
  }

  const anchor = (
    <a
      href={safeHref}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className="text-accent hover:underline cursor-pointer"
    >
      {children}
    </a>
  )

  if (!browserOpenablePath) return anchor

  return (
    <>
      {anchor}
      {/*
        Radix 的下拉锚定在 Trigger 上，而右键菜单要开在光标处——所以放一个 fixed 定位的
        0×0 触发器当锚点。菜单关掉就卸载，页面上不会常驻一堆隐形节点。
      */}
      <DropdownMenu
        open={menuAt !== null}
        onOpenChange={(open) => {
          if (!open) setMenuAt(null)
        }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            style={{
              position: 'fixed',
              left: menuAt?.x ?? 0,
              top: menuAt?.y ?? 0,
              width: 0,
              height: 0,
            }}
          />
        </DropdownMenuTrigger>
        <StyledDropdownMenuContent align="start" sideOffset={2}>
          <StyledDropdownMenuItem
            onSelect={() => {
              onOpenFileExternal?.(browserOpenablePath)
              setMenuAt(null)
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t('common.openInBrowser')}
          </StyledDropdownMenuItem>
        </StyledDropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
