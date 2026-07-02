/**
 * [INPUT]: 依赖 ./favorites-store 的 useFavorites；依赖 react-i18next 的 useTranslation
 * [OUTPUT]: 对外提供 FavoritesPage 组件（默认导出），由 MainContentPanel 在 favorites navigator 下渲染
 * [POS]: favorites 模块的页面视图，列出收藏并跳回原对话（Task 6 补全列表/跳转）
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from 'react-i18next'
import { useFavorites } from './favorites-store'

export default function FavoritesPage() {
  const { t } = useTranslation()
  const favorites = useFavorites()

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <header className="px-6 py-4 border-b border-border/40">
        <h1 className="text-lg font-semibold">{t('favorites.title')}</h1>
      </header>

      {favorites.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 text-muted-foreground">
          <p className="text-base">{t('favorites.empty')}</p>
          <p className="text-sm">{t('favorites.emptyHint')}</p>
        </div>
      ) : (
        <div className="px-6 py-4 text-sm text-muted-foreground">
          {/* Task 6 fills in the list */}
          {favorites.length} favorite(s)
        </div>
      )}
    </div>
  )
}
