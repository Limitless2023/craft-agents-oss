/**
 * [INPUT]: 依赖 @craft-agent/ui 的 buildVizDocument/readVizTheme/VIZ_IFRAME_SANDBOX/
 *          VIZ_MAX_FILE_BYTES（viz 运行时原语），@/context/AppShellContext 的
 *          workspaces/onOpenFile，@/atoms/sessions 的 sessionMetaMapAtom（收集会话 cwd），
 *          window.electronAPI 的 listFiles/readFile，./viz-gallery-core 的纯逻辑
 * [OUTPUT]: 对外提供 VizGalleryPage 组件——跨会话可视化资产画廊（活缩略图网格）
 * [POS]: viz-gallery 的页面层，由 MainContentPanel 在 'viz-gallery' 导航态下渲染
 *        （Favorites 同款"零 props 自取数据"全幅页模板）；点击卡片经 onOpenFile
 *        走链接拦截器管线 → VizPreviewOverlay 全屏
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import * as React from 'react'
import { RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useTranslation } from 'react-i18next'
import {
  buildVizDocument,
  readVizTheme,
  VIZ_IFRAME_SANDBOX,
  VIZ_MAX_FILE_BYTES,
} from '@craft-agent/ui'
import { useAppShellContext } from '@/context/AppShellContext'
import { sessionMetaMapAtom } from '@/atoms/sessions'
import { collectVizRoots, entryDisplayName, isGalleryVizFile, type VizGalleryEntry } from './viz-gallery-core'

/** 单页最多渲染的活缩略图数（每个都是一个沙箱 iframe，设个天花板护住内存）。 */
const MAX_THUMBNAILS = 60

export function VizGalleryPage() {
  const { t } = useTranslation()
  const { workspaces, activeWorkspaceId, onOpenFile } = useAppShellContext()
  const metaMap = useAtomValue(sessionMetaMapAtom)

  const workspaceRoot = React.useMemo(
    () => workspaces.find((w) => w.id === activeWorkspaceId)?.rootPath,
    [workspaces, activeWorkspaceId]
  )

  // 扫描根 = workspace 根 + 各会话工作目录（去重）。用 join key 做依赖，避免数组身份抖动。
  const roots = React.useMemo(
    () => collectVizRoots(workspaceRoot, [...metaMap.values()].map((m) => m.workingDirectory)),
    [workspaceRoot, metaMap]
  )
  const rootsKey = roots.join('\n')

  const [entries, setEntries] = React.useState<VizGalleryEntry[] | null>(null)
  const [refreshNonce, setRefreshNonce] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    const scanRoots = rootsKey ? rootsKey.split('\n') : []
    void Promise.all(
      scanRoots.map(async (root): Promise<VizGalleryEntry[]> => {
        try {
          const listing = await window.electronAPI.listFiles(`${root}/.craft/visualizations`)
          return listing.items
            .filter((item) => item.type === 'file' && isGalleryVizFile(item.name))
            .map((item) => ({ path: item.path, name: item.name, root }))
        } catch {
          // 目录不存在（该根从没产出过可视化）→ 空集，不是错误
          return []
        }
      })
    ).then((groups) => {
      if (cancelled) return
      const byPath = new Map<string, VizGalleryEntry>()
      for (const entry of groups.flat()) byPath.set(entry.path, entry)
      setEntries([...byPath.values()].sort((a, b) => a.name.localeCompare(b.name)))
    })
    return () => {
      cancelled = true
    }
  }, [rootsKey, refreshNonce])

  const shown = entries?.slice(0, MAX_THUMBNAILS) ?? []

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-foreground/60" strokeWidth={2} />
          <span className="text-sm font-medium">{t('vizGallery.title')}</span>
          {entries != null && entries.length > 0 && (
            <span className="text-xs tabular-nums text-foreground/45">
              {t('vizGallery.count', { count: entries.length })}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setRefreshNonce((n) => n + 1)}
          title={t('common.refresh')}
          aria-label={t('common.refresh')}
          className="grid h-7 w-7 place-items-center rounded-md text-foreground/50 transition-colors hover:bg-foreground/[0.05] hover:text-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {entries != null && entries.length === 0 && (
          <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">
            {t('vizGallery.empty')}
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((entry) => (
            <VizThumbCard key={entry.path} entry={entry} onOpen={() => onOpenFile(entry.path)} />
          ))}
        </div>
        {entries != null && entries.length > MAX_THUMBNAILS && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            {t('vizGallery.truncated', { count: entries.length - MAX_THUMBNAILS })}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 活缩略图卡片：读文件 → 同一套 buildVizDocument → 半尺寸沙箱 iframe
 * （pointer-events 关闭，交互留给全屏）。缩略图按挂载时主题烘焙，切主题后
 * 手动刷新即可（缩略图不接主题桥，60 个 MutationObserver 不值）。
 */
function VizThumbCard({ entry, onOpen }: { entry: VizGalleryEntry; onOpen: () => void }) {
  const { t } = useTranslation()
  const [doc, setDoc] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    setDoc(null)
    setFailed(false)
    window.electronAPI
      .readFile(entry.path)
      .then((html) => {
        if (cancelled) return
        if (new TextEncoder().encode(html).length > VIZ_MAX_FILE_BYTES) {
          setFailed(true)
          return
        }
        setDoc(buildVizDocument(html, readVizTheme()))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [entry.path])

  return (
    <button
      type="button"
      onClick={onOpen}
      title={t('vizGallery.openCard', { name: entryDisplayName(entry.name) })}
      className="group relative overflow-hidden rounded-lg border border-border/60 bg-card text-left shadow-minimal transition-colors hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="relative h-44 overflow-hidden bg-background">
        {doc ? (
          <iframe
            sandbox={VIZ_IFRAME_SANDBOX}
            referrerPolicy="no-referrer"
            srcDoc={doc}
            title={entry.name}
            tabIndex={-1}
            className="pointer-events-none absolute left-0 top-0 h-[200%] w-[200%] origin-top-left scale-50 border-0 bg-transparent"
          />
        ) : failed ? (
          <div className="flex h-full items-center justify-center text-xs text-destructive/70">
            {t('viz.errorReadFailed')}
          </div>
        ) : (
          <div className="h-full animate-pulse bg-foreground/[0.04]" />
        )}
      </div>
      <div className="border-t border-border/40 px-3 py-2">
        <div className="truncate text-[13px] font-medium text-foreground">{entryDisplayName(entry.name)}</div>
        <div className="truncate text-[11px] text-foreground/45">{entry.root}</div>
      </div>
    </button>
  )
}
