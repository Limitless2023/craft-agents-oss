# Message Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a heart "favorite" button under every AI reply, plus a "Favorites" sidebar entry above Settings that lists favorites and jumps back to the original message with a brief highlight.

**Architecture:** Pure-renderer feature. A localStorage-backed favorites store (keyed by `messageId`) drives a heart toggle in `TurnCard` and a `FavoritesPage` reached via a new `favorites` navigator (cloned from the `settings` navigator pattern). Clicking a favorite uses an ephemeral in-memory "highlight request" store to tell `ChatDisplay` to scroll to + flash the target message — avoiding any change to the route parser / navigation core.

**Tech Stack:** React + TypeScript, `bun test` (no React component test infra), `lucide-react` icons, i18next (flat dotted keys in `packages/shared/src/i18n/locales/*.json`), Tailwind `cn()`.

## Global Constraints

- **Renderer-only.** No changes to `main.cjs`, preload, subprocess servers, or `packages/shared/src/protocol/channels.ts`. Patch flow stays `build:renderer` + `patch-app.sh`.
- **No React component tests exist** (no vitest/jsdom/testing-library). Only pure `.ts` logic is unit-tested via `bun test`. UI/wiring is verified by `bun run typecheck` + manual acceptance.
- **localStorage access must be lazy** (inside functions, guarded `typeof window !== 'undefined'`) so pure modules stay importable under `bun test`.
- **Favorite unique key = `messageId`.** Toggle = remove if present, else add. No dedup branches.
- **New files get an L3 header** (`[INPUT]/[OUTPUT]/[POS]/[PROTOCOL]`); the new module folder gets an **L2 `CLAUDE.md`**; per the repo's GEB doc protocol.
- Comments: 中文 + ASCII 分块风格, matching the surrounding file.
- i18n: add keys to `en.json` and `zh-Hans.json`; other locales fall back to English.

**Module folder for all new files:** `apps/electron/src/renderer/components/favorites/`

---

### Task 1: Favorites store (pure core + localStorage binding)

**Files:**
- Create: `apps/electron/src/renderer/components/favorites/favorites-core.ts`
- Test: `apps/electron/src/renderer/components/favorites/favorites-core.test.ts`
- Create: `apps/electron/src/renderer/components/favorites/favorites-store.ts`

**Interfaces:**
- Produces:
  - `interface Favorite { messageId: string; sessionId: string; sessionTitle: string; contentSnapshot: string; createdAt: number }`
  - `favorites-core.ts`: `parseFavorites(raw: string | null): Favorite[]`, `toggleFavorite(list: Favorite[], fav: Favorite): Favorite[]`, `removeFavorite(list: Favorite[], messageId: string): Favorite[]`, `isFavorited(list: Favorite[], messageId: string): boolean`, `sortByCreatedDesc(list: Favorite[]): Favorite[]`
  - `favorites-store.ts`: `getFavorites(): Favorite[]`, `toggleFavorite(fav: Favorite): void`, `removeFavorite(messageId: string): void`, `isFavorited(messageId: string): boolean`, `subscribeFavorites(cb: () => void): () => void`, and hooks `useFavorites(): Favorite[]`, `useIsFavorited(messageId: string): boolean`

- [ ] **Step 1: Write the failing test for the pure core**

Create `apps/electron/src/renderer/components/favorites/favorites-core.test.ts`:

```ts
import { test, expect } from 'bun:test'
import {
  parseFavorites,
  toggleFavorite,
  removeFavorite,
  isFavorited,
  sortByCreatedDesc,
  type Favorite,
} from './favorites-core'

const mk = (messageId: string, createdAt: number): Favorite => ({
  messageId,
  sessionId: 's1',
  sessionTitle: 'Session 1',
  contentSnapshot: 'snapshot ' + messageId,
  createdAt,
})

test('parseFavorites returns [] for null / bad JSON', () => {
  expect(parseFavorites(null)).toEqual([])
  expect(parseFavorites('not json')).toEqual([])
  expect(parseFavorites('{"not":"array"}')).toEqual([])
})

test('parseFavorites round-trips a valid array', () => {
  const list = [mk('m1', 1)]
  expect(parseFavorites(JSON.stringify(list))).toEqual(list)
})

test('toggleFavorite adds when absent, removes when present (keyed by messageId)', () => {
  const empty: Favorite[] = []
  const added = toggleFavorite(empty, mk('m1', 1))
  expect(added.map(f => f.messageId)).toEqual(['m1'])
  const removed = toggleFavorite(added, mk('m1', 2))
  expect(removed).toEqual([])
})

test('isFavorited reflects presence by messageId', () => {
  const list = [mk('m1', 1)]
  expect(isFavorited(list, 'm1')).toBe(true)
  expect(isFavorited(list, 'm2')).toBe(false)
})

test('removeFavorite drops only the matching id', () => {
  const list = [mk('m1', 1), mk('m2', 2)]
  expect(removeFavorite(list, 'm1').map(f => f.messageId)).toEqual(['m2'])
})

test('sortByCreatedDesc orders newest first, without mutating input', () => {
  const list = [mk('m1', 1), mk('m2', 3), mk('m3', 2)]
  expect(sortByCreatedDesc(list).map(f => f.messageId)).toEqual(['m2', 'm3', 'm1'])
  expect(list.map(f => f.messageId)).toEqual(['m1', 'm2', 'm3']) // input untouched
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test apps/electron/src/renderer/components/favorites/favorites-core.test.ts`
Expected: FAIL — cannot resolve `./favorites-core`.

- [ ] **Step 3: Implement the pure core**

Create `apps/electron/src/renderer/components/favorites/favorites-core.ts`:

```ts
/**
 * [INPUT]: 无外部依赖（纯函数模块）
 * [OUTPUT]: Favorite 类型 + parse/toggle/remove/isFavorited/sortByCreatedDesc 纯函数
 * [POS]: favorites 模块的纯逻辑内核，被 favorites-store 消费；无 DOM，可 bun test
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// ============================================================
// Types
// ============================================================
export interface Favorite {
  /** 唯一键：一条回复一条收藏 */
  messageId: string
  sessionId: string
  sessionTitle: string
  /** 收藏瞬间的回复 markdown：列表摘要 + 原对话已删的兜底 */
  contentSnapshot: string
  createdAt: number
}

// ============================================================
// Pure reducers — 无副作用，全部返回新数组
// ============================================================
export function parseFavorites(raw: string | null): Favorite[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Favorite[]) : []
  } catch {
    return []
  }
}

export function isFavorited(list: Favorite[], messageId: string): boolean {
  return list.some(f => f.messageId === messageId)
}

export function toggleFavorite(list: Favorite[], fav: Favorite): Favorite[] {
  return isFavorited(list, fav.messageId)
    ? removeFavorite(list, fav.messageId)
    : [...list, fav]
}

export function removeFavorite(list: Favorite[], messageId: string): Favorite[] {
  return list.filter(f => f.messageId !== messageId)
}

export function sortByCreatedDesc(list: Favorite[]): Favorite[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test apps/electron/src/renderer/components/favorites/favorites-core.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Implement the localStorage binding + React hooks**

Create `apps/electron/src/renderer/components/favorites/favorites-store.ts`:

```ts
/**
 * [INPUT]: 依赖 ./favorites-core 的纯 reducers；依赖 react 的 useSyncExternalStore；浏览器 localStorage
 * [OUTPUT]: getFavorites/toggleFavorite/removeFavorite/isFavorited/subscribeFavorites + useFavorites/useIsFavorited
 * [POS]: favorites 模块的单一真相源；心形按钮(ChatDisplay) 与 FavoritesPage 共享，自动同步
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useSyncExternalStore } from 'react'
import {
  parseFavorites,
  toggleFavorite as toggleCore,
  removeFavorite as removeCore,
  isFavorited as isFavoritedCore,
  type Favorite,
} from './favorites-core'

export type { Favorite } from './favorites-core'

const STORAGE_KEY = 'craft-favorites-v1'

// ============================================================
// In-memory snapshot (single source of truth) + listeners
// ============================================================
let snapshot: Favorite[] = readFromStorage()
const listeners = new Set<() => void>()

function readFromStorage(): Favorite[] {
  if (typeof window === 'undefined') return []
  return parseFavorites(window.localStorage.getItem(STORAGE_KEY))
}

function commit(next: Favorite[]): void {
  snapshot = next
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
  listeners.forEach(l => l())
}

// Cross-window sync: another window edited localStorage
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) {
      snapshot = parseFavorites(e.newValue)
      listeners.forEach(l => l())
    }
  })
}

// ============================================================
// Imperative API
// ============================================================
export function getFavorites(): Favorite[] {
  return snapshot
}

export function isFavorited(messageId: string): boolean {
  return isFavoritedCore(snapshot, messageId)
}

export function toggleFavorite(fav: Favorite): void {
  commit(toggleCore(snapshot, fav))
}

export function removeFavorite(messageId: string): void {
  commit(removeCore(snapshot, messageId))
}

export function subscribeFavorites(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

// ============================================================
// React hooks
// ============================================================
export function useFavorites(): Favorite[] {
  return useSyncExternalStore(subscribeFavorites, getFavorites, getFavorites)
}

export function useIsFavorited(messageId: string): boolean {
  return useSyncExternalStore(
    subscribeFavorites,
    () => isFavoritedCore(snapshot, messageId),
    () => false,
  )
}
```

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS (no errors from the new files).

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/renderer/components/favorites/favorites-core.ts \
        apps/electron/src/renderer/components/favorites/favorites-core.test.ts \
        apps/electron/src/renderer/components/favorites/favorites-store.ts
git commit -m "feat(favorites): favorites core logic + localStorage store"
```

---

### Task 2: Heart button in TurnCard (packages/ui)

**Files:**
- Modify: `packages/ui/src/components/chat/TurnCard.tsx` (imports ~line 25; props interface ~line 292-369; toolbar JSX ~line 2538-2550)

**Interfaces:**
- Consumes: nothing from earlier tasks (pure props).
- Produces: two new optional props on `TurnCardProps`: `isFavorited?: boolean`, `onToggleFavorite?: () => void`. Consumed by Task 3.

- [ ] **Step 1: Add the `Heart` icon import**

In `packages/ui/src/components/chat/TurnCard.tsx`, add `Heart` to the existing `lucide-react` import block (the block starting at line 9 with `ChevronRight, ...`). Insert after `GitBranch,` (line 25):

```ts
  GitBranch,
  Heart,
```

- [ ] **Step 2: Add the two props to `TurnCardProps`**

In the `TurnCardProps` interface, right after the `onBranch` prop (line 352), add:

```ts
  /** Whether this turn's response is currently favorited */
  isFavorited?: boolean
  /** Toggle favorite state for this turn's response */
  onToggleFavorite?: () => void
```

- [ ] **Step 3: Render the heart button after the Markdown button**

In the desktop footer's left group, immediately after the Markdown `{onPopOut && (...)}` block that closes at line 2550, and before the closing `</div>` at line 2551, insert:

```tsx
                {onToggleFavorite && response?.messageId && !isStreaming && (
                  <button
                    onClick={onToggleFavorite}
                    className={cn(
                      "turn-action-btn flex items-center gap-1.5 transition-colors select-none",
                      isFavorited ? "text-red-500" : "text-muted-foreground hover:text-foreground",
                      "focus:outline-none focus-visible:underline"
                    )}
                  >
                    <Heart className={cn(SIZE_CONFIG.iconSize, isFavorited && "fill-current")} />
                    <span>{t("common.favorite")}</span>
                  </button>
                )}
```

Note: `response`, `isStreaming`, `t`, `cn`, `SIZE_CONFIG` are all already in scope in this component (used by the adjacent Copy/Markdown buttons).

- [ ] **Step 4: Typecheck**

Run: `bun run typecheck`
Expected: PASS. (`t("common.favorite")` resolves at runtime; the key is added in Task 3. i18next returns the key string if missing, so no type error.)

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/chat/TurnCard.tsx
git commit -m "feat(favorites): heart toggle button in TurnCard footer"
```

---

### Task 3: Wire the heart in ChatDisplay + i18n label

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` (the assistant-turn `<TurnCard .../>` render, ~line 1710-1838; add store import at top)
- Modify: `packages/shared/src/i18n/locales/en.json`
- Modify: `packages/shared/src/i18n/locales/zh-Hans.json`

**Interfaces:**
- Consumes: `useIsFavorited`, `toggleFavorite`, `getFavorites`, `type Favorite` from Task 1's `favorites-store`.
- Produces: end-to-end favoriting (heart persists across restart).

- [ ] **Step 1: Add the i18n label key**

In `packages/shared/src/i18n/locales/en.json`, add a top-level flat key next to the other `common.*` keys (keep JSON valid — add a comma):

```json
  "common.favorite": "Favorite",
```

In `packages/shared/src/i18n/locales/zh-Hans.json`, add:

```json
  "common.favorite": "收藏",
```

- [ ] **Step 2: Import the favorites store in ChatDisplay**

At the top of `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx`, with the other renderer imports, add:

```ts
import { useIsFavorited, toggleFavorite, getFavorites, type Favorite } from '../favorites/favorites-store'
```

(Adjust the relative path if ChatDisplay's depth differs — it lives in `renderer/components/app-shell/`, so `../favorites/favorites-store` is correct.)

- [ ] **Step 3: Build a per-turn toggle helper**

Inside the `ChatDisplay` component body (near other `useCallback` helpers), add a helper that constructs the `Favorite` payload from the current session and a turn's response. `session` is a prop already in scope (see `ChatDisplayProps.session`):

```ts
  // ------------------------------------------------------------
  // Favorites: build payload from session + assistant response
  // ------------------------------------------------------------
  const makeToggleFavorite = useCallback(
    (messageId: string, text: string) => () => {
      const fav: Favorite = {
        messageId,
        sessionId: session.id,
        sessionTitle: session.title ?? '',
        contentSnapshot: text,
        createdAt: Date.now(),
      }
      toggleFavorite(fav)
    },
    [session.id, session.title],
  )
```

Note: if the `Session` type's title field is not `title`, use the actual field (check `session.` autocomplete — likely `title`). `getFavorites` import is retained for Task 6/7 usage; if lint flags it unused here, drop it from this file's import and import it where used.

- [ ] **Step 4: Pass favorite props to the assistant `TurnCard`**

Find the `<TurnCard` element rendered for assistant turns (the one receiving `turnId={turn.turnId}` and `response={turn.response}`, ~line 1714-1757). Add two props (only meaningful when there's a response messageId):

```tsx
              isFavorited={!!turn.response?.messageId && favIsActive(turn.response.messageId)}
              onToggleFavorite={
                turn.response?.messageId
                  ? makeToggleFavorite(turn.response.messageId, turn.response.text ?? '')
                  : undefined
              }
```

Because hooks can't be called inside `.map`, resolve favorite state via the store snapshot subscription. Add near the top of the component body:

```ts
  const favorites = useFavorites()
  const favIsActive = useCallback(
    (messageId: string) => favorites.some(f => f.messageId === messageId),
    [favorites],
  )
```

And update the import in Step 2 to include `useFavorites`:

```ts
import { useFavorites, toggleFavorite, type Favorite } from '../favorites/favorites-store'
```

(Drop `useIsFavorited`/`getFavorites` from this file — `useFavorites` + `favIsActive` covers per-turn state in a `.map` without per-item hooks.)

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification (build + run)**

Run: `bun run --filter '@craft-agent/electron' build:renderer`
Then reload the app (dev: `bun run electron:dev`; or patch). Verify:
- A "Favorite" heart appears in each completed AI reply footer, right of "Markdown".
- Clicking it fills the heart red; clicking again clears it.
- Reload the window → the red state persists (localStorage).

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx \
        packages/shared/src/i18n/locales/en.json \
        packages/shared/src/i18n/locales/zh-Hans.json
git commit -m "feat(favorites): wire heart toggle in ChatDisplay + i18n label"
```

---

### Task 4: Favorites navigator plumbing (types + routes + parser)

**Files:**
- Modify: `apps/electron/src/shared/types.ts` (nav union ~872, guards ~897, `getNavigationStateKey` ~905, `parseNavigationStateKey` ~941)
- Modify: `apps/electron/src/shared/routes.ts` (`view` object ~180-185)
- Modify: `apps/electron/src/shared/route-parser.ts` (`NavigatorType` :38, `COMPOUND_ROUTE_PREFIXES` :63, `parseCompoundRoute` :98, `buildCompoundRoute` :262, `convertCompoundToViewRoute` :381, `convertCompoundToNavigationState` :498)
- Test: `apps/electron/src/shared/route-parser.favorites.test.ts`

**Interfaces:**
- Produces: `FavoritesNavigationState { navigator: 'favorites' }`, `isFavoritesNavigation(s): s is FavoritesNavigationState`, `routes.view.favorites(): 'favorites'`. Round-trip: `parseRouteToNavigationState('favorites')` → `{ navigator: 'favorites' }`; `buildCompoundRoute({navigator:'favorites', details:null})` → `'favorites'`. Consumed by Tasks 5.

- [ ] **Step 1: Write the failing route-parser round-trip test**

Create `apps/electron/src/shared/route-parser.favorites.test.ts`:

```ts
import { test, expect } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute, isCompoundRoute } from './route-parser'

test('favorites is recognized as a compound route', () => {
  expect(isCompoundRoute('favorites')).toBe(true)
})

test('parseCompoundRoute("favorites") → favorites navigator, no details', () => {
  expect(parseCompoundRoute('favorites')).toEqual({ navigator: 'favorites', details: null })
})

test('buildCompoundRoute round-trips favorites', () => {
  const parsed = parseCompoundRoute('favorites')
  expect(parsed).not.toBeNull()
  expect(buildCompoundRoute(parsed!)).toBe('favorites')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test apps/electron/src/shared/route-parser.favorites.test.ts`
Expected: FAIL — `isCompoundRoute('favorites')` is `false` and parse returns `null`.

- [ ] **Step 3: Extend `NavigatorType` and route parsing**

In `apps/electron/src/shared/route-parser.ts`:

(a) Line 38 — add `'favorites'`:
```ts
export type NavigatorType = 'sessions' | 'sources' | 'skills' | 'automations' | 'settings' | 'favorites'
```

(b) Line 63-65 — add `'favorites'` to the prefix list:
```ts
const COMPOUND_ROUTE_PREFIXES = [
  'allSessions', 'flagged', 'archived', 'state', 'label', 'view', 'sources', 'skills', 'automations', 'settings', 'favorites'
]
```

(c) In `parseCompoundRoute`, add a branch mirroring the settings branch. Insert right before the `// Settings navigator` block (line 97):
```ts
  // Favorites navigator (navigator-only view, no details)
  if (first === 'favorites') {
    return { navigator: 'favorites', details: null }
  }

```

(d) In `buildCompoundRoute`, add before the settings block (line 262):
```ts
  if (parsed.navigator === 'favorites') {
    return 'favorites'
  }

```

- [ ] **Step 4: Handle favorites in the two converters**

In `route-parser.ts`, find `convertCompoundToViewRoute` (line 381) and `convertCompoundToNavigationState` (line 498). Add a favorites case to each, next to the settings case.

For `convertCompoundToNavigationState` (returns `NavigationState`), add near the settings handling:
```ts
  if (compound.navigator === 'favorites') {
    return { navigator: 'favorites' }
  }
```

For `convertCompoundToViewRoute` (returns a `ParsedRoute` view route), add a case matching how `settings` is converted there (read the settings case in that function and mirror it, using route string `'favorites'`). If settings does e.g. `return { type: 'view', route: 'settings', ... }`, produce the same shape with `'favorites'`.

- [ ] **Step 5: Add the navigation state type + guard + key functions**

In `apps/electron/src/shared/types.ts`:

(a) After the `SettingsNavigationState` interface (line 848), add:
```ts
/**
 * Favorites navigation state (navigator-only view, no subpage/details)
 */
export interface FavoritesNavigationState {
  navigator: 'favorites'
  rightSidebar?: RightSidebarPanel
}
```

(b) Add to the `NavigationState` union (line 872-877):
```ts
export type NavigationState =
  | SessionsNavigationState
  | SourcesNavigationState
  | SettingsNavigationState
  | SkillsNavigationState
  | AutomationsNavigationState
  | FavoritesNavigationState
```

(c) After `isSettingsNavigation` (line 889), add:
```ts
export const isFavoritesNavigation = (
  state: NavigationState
): state is FavoritesNavigationState => state.navigator === 'favorites'
```

(d) In `getNavigationStateKey` (line 905), add before the `// Chats` fallback (line 928):
```ts
  if (state.navigator === 'favorites') {
    return 'favorites'
  }
```

(e) In `parseNavigationStateKey` (line 941), add near the other navigator cases:
```ts
  if (key === 'favorites') return { navigator: 'favorites' }
```

- [ ] **Step 6: Add the route builder**

In `apps/electron/src/shared/routes.ts`, inside `view` (after the `settings` builder, line 184, before the closing `}` at 185):
```ts
    /** Favorites view (favorites navigator) */
    favorites: () => 'favorites' as const,
```

- [ ] **Step 7: Run the parser test + full typecheck**

Run: `bun test apps/electron/src/shared/route-parser.favorites.test.ts`
Expected: PASS (3 tests).

Run: `bun run typecheck`
Expected: PASS. If TypeScript reports a non-exhaustive switch on `navigator` anywhere (e.g. a `navigation-registry.ts` `NavigatorType` that's a 3-member subset, or a switch missing a `favorites` arm), add the missing `favorites` case there. Fix each until clean.

- [ ] **Step 8: Commit**

```bash
git add apps/electron/src/shared/types.ts apps/electron/src/shared/routes.ts \
        apps/electron/src/shared/route-parser.ts \
        apps/electron/src/shared/route-parser.favorites.test.ts
git commit -m "feat(favorites): add favorites navigator (types + routes + parser)"
```

---

### Task 5: Sidebar entry + MainContentPanel branch + FavoritesPage shell

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/AppShell.tsx` (handler near `handleSettingsClick` ~1872; sidebar links: separator at 2623, Settings item at 2624-2631)
- Modify: `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx` (settings branch 237-245)
- Create: `apps/electron/src/renderer/components/favorites/FavoritesPage.tsx`
- Modify: `packages/shared/src/i18n/locales/en.json`, `zh-Hans.json`

**Interfaces:**
- Consumes: `isFavoritesNavigation` (Task 4), `routes.view.favorites` (Task 4).
- Produces: `FavoritesPage` React component (default export). Reachable via sidebar. Consumed/expanded by Task 6.

- [ ] **Step 1: Add i18n keys (sidebar + page shell)**

`en.json` — add:
```json
  "sidebar.favorites": "Favorites",
  "favorites.title": "Favorites",
  "favorites.empty": "No favorites yet",
  "favorites.emptyHint": "Tap the heart under any AI reply to save it here.",
```

`zh-Hans.json` — add:
```json
  "sidebar.favorites": "收藏",
  "favorites.title": "我的收藏",
  "favorites.empty": "还没有收藏",
  "favorites.emptyHint": "在任意 AI 回复下点心形，即可收藏到这里。",
```

- [ ] **Step 2: Create the FavoritesPage shell**

Create `apps/electron/src/renderer/components/favorites/FavoritesPage.tsx`:

```tsx
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
```

- [ ] **Step 3: Render FavoritesPage in MainContentPanel**

In `apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx`:

(a) Add the import (with the other page imports at the top):
```ts
import FavoritesPage from '../favorites/FavoritesPage'
```

(b) Add `isFavoritesNavigation` to the existing import from `@/shared/types` (or wherever `isSettingsNavigation` is imported from in this file).

(c) Immediately before the settings branch (line 237, `if (isSettingsNavigation(navState)) {`), add:
```tsx
  // Favorites navigator - navigator-only full-page view.
  if (isFavoritesNavigation(navState)) {
    return wrapWithStoplight(
      <Panel variant="grow" className={className}>
        <FavoritesPage />
      </Panel>
    )
  }

```

- [ ] **Step 4: Add the sidebar handler in AppShell**

In `apps/electron/src/renderer/components/app-shell/AppShell.tsx`, near `handleSettingsClick` (line 1872), add:
```ts
  const handleFavoritesClick = useCallback(() => {
    navigate(routes.view.favorites())
  }, [navigate])
```

Ensure `isFavoritesNavigation` is imported in this file (alongside `isSettingsNavigation`).

- [ ] **Step 5: Insert the Favorites sidebar item above Settings**

In the sidebar links array, between the separator (line 2623) and the Settings item (line 2624), insert:
```tsx
                    // --- Favorites ---
                    {
                      id: "nav:favorites",
                      title: t("sidebar.favorites"),
                      icon: Heart,
                      variant: isFavoritesNavigation(navState) ? "default" : "ghost",
                      onClick: () => handleFavoritesClick(),
                    },
```

Add `Heart` to the `lucide-react` import in AppShell.tsx (find the existing import that includes `Settings`, add `Heart`).

- [ ] **Step 6: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 7: Manual verification**

Run: `bun run --filter '@craft-agent/electron' build:renderer`, reload the app. Verify:
- A "Favorites" entry with a heart icon appears in the left sidebar, directly above "Settings".
- Clicking it opens the Favorites page (empty state, since Task 6 hasn't wired the list rendering — but if you favorited earlier it shows "N favorite(s)").
- The entry highlights (active variant) when on the page.

- [ ] **Step 8: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/AppShell.tsx \
        apps/electron/src/renderer/components/app-shell/MainContentPanel.tsx \
        apps/electron/src/renderer/components/favorites/FavoritesPage.tsx \
        packages/shared/src/i18n/locales/en.json packages/shared/src/i18n/locales/zh-Hans.json
git commit -m "feat(favorites): sidebar entry + favorites page shell"
```

---

### Task 6: FavoritesPage list + unfavorite + jump request

**Files:**
- Create: `apps/electron/src/renderer/components/favorites/favorites-highlight-store.ts`
- Test: `apps/electron/src/renderer/components/favorites/favorites-highlight-store.test.ts`
- Modify: `apps/electron/src/renderer/components/favorites/FavoritesPage.tsx`
- Modify: `packages/shared/src/i18n/locales/en.json`, `zh-Hans.json`

**Interfaces:**
- Consumes: `useFavorites`, `removeFavorite` (Task 1); `routes.view.favorites`/`allSessions` (Task 4); `navigate`.
- Produces: `favorites-highlight-store.ts`: `requestHighlight(sessionId, messageId)`, `peekHighlight(sessionId): string | null`, `consumeHighlight(sessionId): void`, `subscribeHighlight(cb): () => void`, `__resetHighlight()` (test-only). Consumed by Task 7.

- [ ] **Step 1: Write the failing highlight-store test**

Create `apps/electron/src/renderer/components/favorites/favorites-highlight-store.test.ts`:

```ts
import { test, expect, beforeEach } from 'bun:test'
import {
  requestHighlight,
  peekHighlight,
  consumeHighlight,
  subscribeHighlight,
  __resetHighlight,
} from './favorites-highlight-store'

beforeEach(() => __resetHighlight())

test('peek returns messageId only for the matching session', () => {
  requestHighlight('s1', 'm1')
  expect(peekHighlight('s1')).toBe('m1')
  expect(peekHighlight('s2')).toBeNull()
})

test('consume clears the pending request for the matching session', () => {
  requestHighlight('s1', 'm1')
  consumeHighlight('s1')
  expect(peekHighlight('s1')).toBeNull()
})

test('consume for a non-matching session does not clear', () => {
  requestHighlight('s1', 'm1')
  consumeHighlight('s2')
  expect(peekHighlight('s1')).toBe('m1')
})

test('subscribe fires on request and can be unsubscribed', () => {
  let calls = 0
  const unsub = subscribeHighlight(() => { calls++ })
  requestHighlight('s1', 'm1')
  expect(calls).toBe(1)
  unsub()
  requestHighlight('s1', 'm2')
  expect(calls).toBe(1)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test apps/electron/src/renderer/components/favorites/favorites-highlight-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the highlight store**

Create `apps/electron/src/renderer/components/favorites/favorites-highlight-store.ts`:

```ts
/**
 * [INPUT]: 无外部依赖（模块单例 + 监听器集合）
 * [OUTPUT]: requestHighlight/peekHighlight/consumeHighlight/subscribeHighlight (+ __resetHighlight 测试用)
 * [POS]: favorites 模块的临时（非持久化）跳转高亮信号；FavoritesPage 请求、ChatDisplay 消费
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

// 临时信号：让某会话挂载/渲染时滚动+闪烁某条消息（一次性，consume 后清空）
interface HighlightRequest { sessionId: string; messageId: string }

let pending: HighlightRequest | null = null
const listeners = new Set<() => void>()

export function requestHighlight(sessionId: string, messageId: string): void {
  pending = { sessionId, messageId }
  listeners.forEach(l => l())
}

export function peekHighlight(sessionId: string): string | null {
  return pending && pending.sessionId === sessionId ? pending.messageId : null
}

export function consumeHighlight(sessionId: string): void {
  if (pending && pending.sessionId === sessionId) pending = null
}

export function subscribeHighlight(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

// test-only
export function __resetHighlight(): void {
  pending = null
  listeners.clear()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test apps/electron/src/renderer/components/favorites/favorites-highlight-store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add list/card i18n keys**

`en.json`:
```json
  "favorites.remove": "Remove from favorites",
```
`zh-Hans.json`:
```json
  "favorites.remove": "取消收藏",
```

- [ ] **Step 6: Fill in the FavoritesPage list**

Replace the whole body of `apps/electron/src/renderer/components/favorites/FavoritesPage.tsx` with:

```tsx
/**
 * [INPUT]: 依赖 ./favorites-store 的 useFavorites/removeFavorite；./favorites-highlight-store 的 requestHighlight；
 *          ../../lib/navigate 的 navigate；@/shared/routes 的 routes；sortByCreatedDesc（favorites-core）
 * [OUTPUT]: 对外提供 FavoritesPage 组件（默认导出），由 MainContentPanel 在 favorites navigator 下渲染
 * [POS]: favorites 模块的页面视图，列出收藏、取消收藏、点击跳回原对话并请求高亮
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { useTranslation } from 'react-i18next'
import { Heart } from 'lucide-react'
import { useFavorites, removeFavorite } from './favorites-store'
import { sortByCreatedDesc } from './favorites-core'
import { requestHighlight } from './favorites-highlight-store'
import { navigate } from '../../lib/navigate'
import { routes } from '@/shared/routes'

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
```

Note on the `@/shared/routes` import alias: match how other renderer files import shared modules (e.g. how `MainContentPanel` imports `@/shared/types`). If the alias differs, use the same style. `navigate` comes from `apps/electron/src/renderer/lib/navigate.ts` — verify the relative path (`../../lib/navigate`) resolves from `components/favorites/`.

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Manual verification**

`bun run --filter '@craft-agent/electron' build:renderer`, reload. Verify:
- Favorites page lists favorited replies newest-first: session title + 2-line snippet + timestamp.
- The red heart on a card removes it (list updates live; the source reply's heart also un-fills — shared store).
- Clicking a card navigates to that session (highlight not yet visible — Task 7).

- [ ] **Step 9: Commit**

```bash
git add apps/electron/src/renderer/components/favorites/favorites-highlight-store.ts \
        apps/electron/src/renderer/components/favorites/favorites-highlight-store.test.ts \
        apps/electron/src/renderer/components/favorites/FavoritesPage.tsx \
        packages/shared/src/i18n/locales/en.json packages/shared/src/i18n/locales/zh-Hans.json
git commit -m "feat(favorites): favorites list, unfavorite, and jump-request"
```

---

### Task 7: Consume highlight in ChatDisplay (scroll + flash)

**Files:**
- Modify: `apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx` (`scrollToFollowUpTurn` 1410-1450; assistant turn wrapper 1699-1709; add state + effects + import)

**Interfaces:**
- Consumes: `peekHighlight`, `consumeHighlight`, `subscribeHighlight` (Task 6); existing `assistantTurnIndexByMessageId` (1400), `allTurns`, `visibleTurnCount`/`setVisibleTurnCount`, `turnRefs`, `getTurnKey`.
- Produces: full jump-to-favorite behavior.

- [ ] **Step 1: Import the highlight store**

At the top of `ChatDisplay.tsx`, add:
```ts
import { peekHighlight, consumeHighlight, subscribeHighlight } from '../favorites/favorites-highlight-store'
```

- [ ] **Step 2: Extract `scrollToMessage` and delegate `scrollToFollowUpTurn` to it**

Replace the existing `scrollToFollowUpTurn` definition (lines 1410-1450) with a `scrollToMessage(messageId)` plus a thin `scrollToFollowUpTurn` wrapper (DRY — `annotationId` is unused in the scroll path):

```ts
  const scrollToMessage = useCallback((messageId: string) => {
    const targetTurnIndex = assistantTurnIndexByMessageId.get(messageId)
    if (targetTurnIndex == null) return

    const ensureVisibleCount = allTurns.length - targetTurnIndex

    const scrollToTurn = () => {
      const targetTurn = allTurns[targetTurnIndex]
      if (!targetTurn) return false
      const turnKey = getTurnKey(targetTurn)
      const turnContainer = turnRefs.current.get(turnKey)
      if (!turnContainer) return false
      turnContainer.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return true
    }

    if (ensureVisibleCount > visibleTurnCount) {
      setVisibleTurnCount(ensureVisibleCount)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!scrollToTurn()) {
            setTimeout(() => { void scrollToTurn() }, 80)
          }
        })
      })
      return
    }

    if (!scrollToTurn()) {
      requestAnimationFrame(() => { void scrollToTurn() })
    }
  }, [assistantTurnIndexByMessageId, allTurns, visibleTurnCount])

  const scrollToFollowUpTurn = useCallback(
    (item: { messageId: string; annotationId: string }) => scrollToMessage(item.messageId),
    [scrollToMessage],
  )
```

- [ ] **Step 3: Add highlight state + consume effect + fade effect**

Near the other `useState`/`useEffect` hooks in the component body, add:

```ts
  // ------------------------------------------------------------
  // Favorites: consume a pending "jump + highlight" request
  // ------------------------------------------------------------
  const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null)

  useEffect(() => {
    const check = () => {
      const messageId = peekHighlight(session.id)
      if (!messageId) return
      // wait until the target message is actually rendered/indexed
      if (!assistantTurnIndexByMessageId.has(messageId)) return
      consumeHighlight(session.id)
      setHighlightMessageId(messageId)
      scrollToMessage(messageId)
    }
    check()
    return subscribeHighlight(check)
  }, [session.id, assistantTurnIndexByMessageId, scrollToMessage])

  useEffect(() => {
    if (!highlightMessageId) return
    const timer = setTimeout(() => setHighlightMessageId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightMessageId])
```

- [ ] **Step 4: Add the transient ring to the assistant turn wrapper**

At the assistant turn render (~1699-1709), compute the target flag just before the `return (` for the assistant `<div>`, and add the ring class. The wrapper becomes:

```tsx
                    const isHighlightTarget =
                      highlightMessageId != null && turn.response?.messageId === highlightMessageId
                    return (
                      <div
                        key={turnKey}
                        ref={el => { if (el) turnRefs.current.set(turnKey, el); else turnRefs.current.delete(turnKey) }}
                        className={cn(
                          "pt-2",
                          "rounded-lg transition-all duration-200",
                          isCurrentMatch && "ring-2 ring-info ring-offset-2 ring-offset-background",
                          isAnyMatch && !isCurrentMatch && "ring-1 ring-info/30",
                          isHighlightTarget && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                        )}
                      >
```

(If `turn` is not directly in scope at that exact spot, use the same turn variable the surrounding `.map` callback already binds — the wrapper already reads `turnKey`/`isCurrentMatch` from it.)

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Manual verification (the whole feature)**

`bun run --filter '@craft-agent/electron' build:renderer`, reload. Verify end-to-end:
1. Favorite an AI reply (heart fills red).
2. Open the Favorites page from the sidebar (above Settings).
3. Click the favorite card → app navigates to that session, scrolls the reply into center view, and a primary-colored ring flashes on it, fading after ~2s.
4. Manually scroll away and re-open the same favorite → it highlights again.
5. Reload the window while on the session → no phantom re-highlight (the request was consumed).
6. Favorite a reply, delete its session, open Favorites → card still shows (snapshot); clicking navigates without crashing (no scroll target → silent).

- [ ] **Step 7: Commit**

```bash
git add apps/electron/src/renderer/components/app-shell/ChatDisplay.tsx
git commit -m "feat(favorites): scroll-to + flash highlight on favorite jump"
```

---

### Task 8: Module docs (GEB L2 + repo CLAUDE.md)

**Files:**
- Create: `apps/electron/src/renderer/components/favorites/CLAUDE.md`
- Modify: `Projects/craft-agents-oss/CLAUDE.md` (Custom Modifications section)

- [ ] **Step 1: Create the module L2 CLAUDE.md**

Create `apps/electron/src/renderer/components/favorites/CLAUDE.md`:

```markdown
# favorites/
> L2 | 父级: ../../CLAUDE.md

消息收藏功能（纯 renderer）。

成员清单
favorites-core.ts: 纯 reducers（parse/toggle/remove/isFavorited/sortByCreatedDesc）+ Favorite 类型；无 DOM，bun test 覆盖
favorites-core.test.ts: favorites-core 单测
favorites-store.ts: localStorage(`craft-favorites-v1`) 绑定 + useSyncExternalStore hooks（useFavorites/useIsFavorited）；单一真相源
favorites-highlight-store.ts: 临时跳转高亮信号（request/peek/consume/subscribe）；非持久化
favorites-highlight-store.test.ts: 高亮信号单测
FavoritesPage.tsx: 收藏页视图，列出/取消/点击跳回原对话（requestHighlight + navigate）

法则: 唯一键 messageId · localStorage 纯前端 · 跳转高亮走信号 store 不碰路由核心

[PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
```

- [ ] **Step 2: Add a Custom Modifications subsection to the repo CLAUDE.md**

In `Projects/craft-agents-oss/CLAUDE.md`, under `## Custom Modifications`, add a new subsection documenting the feature (files touched: TurnCard heart, ChatDisplay wiring + highlight, favorites navigator across types/routes/route-parser/AppShell/MainContentPanel, the `components/favorites/` module, i18n keys). Keep it concise, matching the existing subsection style.

- [ ] **Step 3: Final full check**

Run: `bun run typecheck && bun test`
Expected: PASS (all favorites tests green, no type errors).

- [ ] **Step 4: Commit**

```bash
git add apps/electron/src/renderer/components/favorites/CLAUDE.md "Projects/craft-agents-oss/CLAUDE.md" || git add apps/electron/src/renderer/components/favorites/CLAUDE.md CLAUDE.md
git commit -m "docs(favorites): module L2 + repo CLAUDE.md sync"
```

---

## Notes for the implementer

- **Patch/run:** after the feature is merged, deploy via `bun run --filter '@craft-agent/electron' build:renderer` then `bash patch-app.sh` (renderer-only; no main/subprocess rebuild). During development, `bun run electron:dev` hot-reloads without patching.
- **Session field names:** Task 3/6 assume `session.id` and `session.title`. If the `Session` type uses different names (e.g. `name`), adjust — typecheck will flag it.
- **Import aliases:** match the file you're editing (`@/shared/...` vs relative). MainContentPanel and ChatDisplay already import shared types — copy their style.
- **Exhaustiveness:** adding the `favorites` navigator may surface missing switch arms at typecheck (Task 4 Step 7). Fix each where TypeScript points.
