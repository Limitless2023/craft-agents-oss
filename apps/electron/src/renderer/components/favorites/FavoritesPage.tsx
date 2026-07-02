/**
 * [INPUT]: 依赖 ./favorites-store 的 useFavorites/removeFavorite；./favorites-highlight-store 的 requestHighlight；
 *          @/lib/navigate 的 navigate+routes；./favorites-core 的 sortByCreatedDesc
 * [OUTPUT]: 对外提供 FavoritesPage 组件（默认导出），由 MainContentPanel 在 favorites navigator 下渲染
 * [POS]: favorites 模块的页面视图，列出收藏、取消收藏、点击跳回原对话并请求高亮
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import { useFavorites, removeFavorite } from './favorites-store'
import { sortByCreatedDesc } from './favorites-core'
import { requestHighlight } from './favorites-highlight-store'
import { navigate, routes } from '@/lib/navigate'

export default function FavoritesPage() {
  const { t } = useTranslation()
  const favorites = useFavorites()
  const sorted = sortByCreatedDesc(favorites)

  const openFavorite = (sessionId: string, messageId: string) => {
    requestHighlight(sessionId, messageId)
    navigate(routes.view.allSessions(sessionId))
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header className="px-6 py-4 border-b border-border/40">
        <h1 className="text-lg font-semibold">{t('favorites.title')}</h1>
      </header>

      {sorted.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
          <p className="text-base">{t('favorites.empty')}</p>
          <p className="text-sm">{t('favorites.emptyHint')}</p>
        </div>
      ) : (
        <ul className="px-4 py-3 space-y-2">
          {sorted.map(fav => (
            <li key={fav.messageId}>
              <button
                onClick={() => openFavorite(fav.sessionId, fav.messageId)}
                className="group w-full text-left rounded-lg border border-border/40 hover:border-border hover:bg-muted/40 transition-colors p-3 flex items-start gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{fav.sessionTitle || fav.sessionId}</div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{fav.contentSnapshot}</div>
                  <div className="text-[11px] text-muted-foreground/70 mt-1">
                    {new Date(fav.createdAt).toLocaleString()}
                  </div>
                </div>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={t('favorites.remove')}
                  title={t('favorites.remove')}
                  onClick={e => { e.stopPropagation(); removeFavorite(fav.messageId) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); removeFavorite(fav.messageId) } }}
                  className="shrink-0 text-red-500 opacity-70 hover:opacity-100 transition-opacity"
                >
                  <Heart className="h-4 w-4 fill-current" />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
