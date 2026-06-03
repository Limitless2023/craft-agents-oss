/**
 * QuickChatApp — the renderer side of the floating QuickChat ball.
 *
 * Loaded into a separate Electron BrowserWindow when the URL carries
 * `?quickChat=true` (see renderer/main.tsx for the dispatch). Lives apart
 * from the main AppShell because:
 *   - The floating window is much smaller (ball/expanded) — no need for
 *     LeftSidebar / PanelStack / EntityList / navigation infra.
 *   - We want fast first-paint. Mounting the full AppShell would render
 *     dozens of providers and atoms it doesn't need.
 *
 * Two visual states:
 *   - "ball": 64×64 round button bottom-right. Click → expand.
 *   - "expanded": 600×420 mini chat. ESC / outside-click → collapse.
 *
 * Session lifecycle:
 *   - First send (no current session, or last activity > 1h ago) creates
 *     a fresh session in workspace-zero. System prompt embeds an English-
 *     coach role so the assistant focuses on phrasing improvements.
 *   - Subsequent sends within 1h reuse the same session for follow-ups.
 *   - The session is a normal session — it shows up in the main app's
 *     sidebar list with label `quick-chat` so you can find it later.
 *
 * Clipboard:
 *   - On expand, we read the system clipboard. If it's non-empty and
 *     visibly different from the last value we saw, we show it as a
 *     ghost suggestion above the input ("Press Tab to use clipboard").
 *
 * Streaming:
 *   - sendMessage returns once the user message is persisted; assistant
 *     tokens arrive via window.electronAPI.onAgentEvent (see App.tsx for
 *     the same plumbing). Here we use a slim subscriber that only cares
 *     about text deltas + tool result + completion for our session.
 */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { MessageSquare, Copy, Check } from 'lucide-react'
import { Markdown } from '@craft-agent/ui'
import '../index.css'

// ─── Constants ────────────────────────────────────────────────────────────
const BALL_SIZE = 64
const EXPANDED_W = 600
const EXPANDED_H = 460
const SESSION_REUSE_WINDOW_MS = 60 * 60 * 1000 // 1 hour

// ┌────────────────────────────────────────────────────────────────────────┐
// │ First-turn framing.                                                    │
// │                                                                        │
// │ We don't have a clean way to inject a real system prompt through       │
// │ CreateSessionOptions, so the first user message has to do the priming. │
// │ Format the request as a natural user ask ("please improve this English │
// │ phrasing") rather than an embedded "you are X" system prompt — that    │
// │ way when the session is opened in the main app, it reads as a normal   │
// │ conversation instead of a leaked prompt.                               │
// │                                                                        │
// │ Subsequent turns in the same session just send the user's text as-is;  │
// │ Claude carries the "English coach" intent from context.                │
// └────────────────────────────────────────────────────────────────────────┘
function buildFirstTurnMessage(userText: string): string {
  return [
    'Please help me improve this English phrasing.',
    '- Suggest 1-2 more natural versions, ranked.',
    '- Briefly explain why (one short bullet each).',
    '- If the original is already fine, just say so.',
    '',
    'Text:',
    userText,
  ].join('\n')
}

const LS_KEY_SESSION = 'craft-quick-chat:session'

interface QuickChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

interface PersistedSession {
  sessionId: string
  lastActivityAt: number
}

// ─── Session persistence helpers ──────────────────────────────────────────
function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(LS_KEY_SESSION)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.sessionId !== 'string' || typeof parsed?.lastActivityAt !== 'number') return null
    return parsed
  } catch { return null }
}

function persistSession(sessionId: string): void {
  try {
    const entry: PersistedSession = { sessionId, lastActivityAt: Date.now() }
    localStorage.setItem(LS_KEY_SESSION, JSON.stringify(entry))
  } catch {/* quota */}
}

// ─── Ball view ────────────────────────────────────────────────────────────
function Ball({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      // Drag handle via CSS so the ball can be repositioned by dragging.
      // The chat header gets the same treatment in expanded mode.
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-accent/60 shadow-strong hover:scale-105 transition-transform flex items-center justify-center cursor-pointer"
      onMouseDown={(e) => e.stopPropagation()}
      title="QuickChat — English coach"
    >
      <span style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <MessageSquare className="w-6 h-6 text-white" />
      </span>
    </button>
  )
}

// ─── Expanded view ────────────────────────────────────────────────────────
function ExpandedChat({
  workspaceId,
  onCollapse,
}: {
  workspaceId: string
  onCollapse: () => void
}) {
  const [input, setInput] = React.useState('')
  const [messages, setMessages] = React.useState<QuickChatMessage[]>([])
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const [isStreaming, setIsStreaming] = React.useState(false)
  const [clipboardSuggestion, setClipboardSuggestion] = React.useState('')
  const [copiedId, setCopiedId] = React.useState<string | null>(null)
  const inputRef = React.useRef<HTMLTextAreaElement>(null)
  const transcriptRef = React.useRef<HTMLDivElement>(null)
  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ sessionIdRef mirrors sessionId synchronously so the global event   │
  // │ listener can filter events the instant createSession returns —     │
  // │ React's setSessionId is async and runs after sendMessage has       │
  // │ already started producing text_delta events. Without the ref, the  │
  // │ first turn's tokens get dropped (filtered against null sessionId). │
  // └─────────────────────────────────────────────────────────────────────┘
  const sessionIdRef = React.useRef<string | null>(null)

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ On mount: focus input + pull clipboard suggestion + decide whether │
  // │ to reuse the last session (within reuse window) or start fresh.   │
  // └─────────────────────────────────────────────────────────────────────┘
  React.useEffect(() => {
    inputRef.current?.focus()
    const clip = window.electronAPI.readClipboardText?.() ?? ''
    if (clip.trim().length > 0 && clip.length < 2000) {
      setClipboardSuggestion(clip.trim())
    }
    const persisted = loadPersistedSession()
    if (persisted && Date.now() - persisted.lastActivityAt < SESSION_REUSE_WINDOW_MS) {
      setSessionId(persisted.sessionId)
      sessionIdRef.current = persisted.sessionId
    }
  }, [])

  // ESC collapses
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCollapse()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onCollapse])

  // ┌─────────────────────────────────────────────────────────────────────┐
  // │ Subscribe to agent events for the current session. Streaming tokens │
  // │ are appended into the last assistant message; completion flips      │
  // │ isStreaming off so the input becomes hot again.                     │
  // └─────────────────────────────────────────────────────────────────────┘
  React.useEffect(() => {
    // Subscribe ONCE on mount, not on sessionId change. We filter via the
    // ref inside the callback so the first turn's text_delta events (which
    // start streaming before React commits setSessionId) aren't dropped.
    const cleanup = window.electronAPI.onSessionEvent((evt) => {
      if (evt.sessionId !== sessionIdRef.current) return

      if (evt.type === 'text_delta') {
        const delta = evt.delta ?? ''
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: last.content + delta }]
          }
          return [...prev, { id: `${Date.now()}-a`, role: 'assistant', content: delta }]
        })
      } else if (evt.type === 'text_complete') {
        // Some models emit text_complete with the full text and no preceding
        // text_delta stream. Handle both: replace the trailing assistant
        // bubble's content with the complete text if we have an empty one,
        // or append a new bubble if there isn't an assistant turn open yet.
        const fullText = evt.text ?? ''
        if (fullText) {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (last && last.role === 'assistant') {
              return [...prev.slice(0, -1), { ...last, content: fullText }]
            }
            return [...prev, { id: `${Date.now()}-a`, role: 'assistant', content: fullText }]
          })
        }
        setIsStreaming(false)
      } else if (evt.type === 'complete' || evt.type === 'interrupted' || evt.type === 'error') {
        setIsStreaming(false)
      }
    })
    return () => { cleanup?.() }
  }, [])

  // Auto-scroll transcript on new content
  React.useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // ─── Send a message ─────────────────────────────────────────────────────
  const handleSend = React.useCallback(async () => {
    const text = input.trim()
    if (!text || isStreaming) return

    setInput('')
    setMessages((prev) => [...prev, { id: `${Date.now()}-u`, role: 'user', content: text }])
    setIsStreaming(true)
    setClipboardSuggestion('') // drop suggestion once user sent something

    let currentSessionId = sessionId
    try {
      // Create on first send or after expiration
      if (!currentSessionId) {
        const session = await window.electronAPI.createSession(workspaceId, {
          name: 'QuickChat',
          model: 'claude-sonnet-4-6',
          // 'off' fully disables extended thinking — for one-shot English
          // phrasing help, even 'low' thinking adds 1-2s latency for no
          // quality gain. Direct generation is much snappier.
          thinkingLevel: 'off',
          workingDirectory: 'none',
          // 'allow-all' skips any permission prompt. The English coach
          // session never invokes tools, but the default 'safe' mode
          // could pop confirmations if the model ever decided to call
          // one — preempt that since the flow is supposed to be silent.
          permissionMode: 'allow-all',
          labels: ['quick-chat'],
        })
        currentSessionId = session.id
        // Update the ref SYNCHRONOUSLY before sendMessage so the listener
        // (subscribed once on mount) starts catching events for this id
        // immediately. setSessionId is queued by React and would otherwise
        // race the first text_delta back from the agent.
        sessionIdRef.current = session.id
        setSessionId(session.id)
        persistSession(session.id)
      }
      persistSession(currentSessionId)

      // First message of a fresh session gets the natural-request framing
      // so the model knows we want phrasing help. Follow-up messages in
      // the same session inherit the intent from conversation context and
      // can be sent verbatim.
      const isFirstUserMessage = messages.length === 0
      const composed = isFirstUserMessage ? buildFirstTurnMessage(text) : text

      await window.electronAPI.sendMessage(currentSessionId, composed, [], [], {})
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-e`,
          role: 'assistant',
          content: `**Error**: ${err instanceof Error ? err.message : 'Failed to send message'}`,
        },
      ])
      setIsStreaming(false)
    }
  }, [input, isStreaming, sessionId, workspaceId, messages.length])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    } else if (e.key === 'Tab' && clipboardSuggestion && !input) {
      e.preventDefault()
      setInput(clipboardSuggestion)
      setClipboardSuggestion('')
    }
  }

  const handleCopy = (msgId: string, content: string) => {
    try {
      navigator.clipboard.writeText(content)
      setCopiedId(msgId)
      setTimeout(() => setCopiedId(null), 1500)
    } catch {/* clipboard denied */}
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background rounded-[12px] shadow-strong overflow-hidden border border-border/40">
      {/* Header — drag handle + collapse hint */}
      <div
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        className="flex items-center justify-between px-3 h-9 shrink-0 border-b border-border/40 bg-foreground/[0.02]"
      >
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-accent" />
          <span className="text-[11px] font-medium text-muted-foreground">English Coach</span>
        </div>
        <button
          onClick={onCollapse}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="text-[10px] text-muted-foreground/60 hover:text-foreground px-1.5 py-0.5 rounded-[4px] hover:bg-foreground/[0.05]"
          title="Collapse (ESC)"
        >
          ESC
        </button>
      </div>

      {/* Transcript */}
      <div ref={transcriptRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-[12px] text-muted-foreground/50 italic py-2">
            Paste a sentence and I'll suggest more natural phrasings.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="group">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-1">
              {m.role === 'user' ? 'You' : 'Coach'}
            </div>
            <div className={m.role === 'user' ? 'text-[13px] text-foreground/80' : 'text-[13px]'}>
              {m.role === 'user' ? (
                <p className="whitespace-pre-wrap">{m.content}</p>
              ) : (
                <div className="prose-sm">
                  <Markdown mode="minimal">{m.content}</Markdown>
                </div>
              )}
            </div>
            {m.role === 'assistant' && m.content && (
              <button
                onClick={() => handleCopy(m.id, m.content)}
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {copiedId === m.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                {copiedId === m.id ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        ))}
        {isStreaming && messages[messages.length - 1]?.role === 'user' && (
          <div className="text-[12px] text-muted-foreground/40 italic">Thinking…</div>
        )}
      </div>

      {/* Clipboard suggestion */}
      {clipboardSuggestion && !input && (
        <div className="px-4 py-1 text-[11px] text-muted-foreground/60 border-t border-border/40 bg-foreground/[0.02]">
          <span className="font-medium">Clipboard:</span>{' '}
          <span className="opacity-70">{clipboardSuggestion.slice(0, 90)}{clipboardSuggestion.length > 90 ? '…' : ''}</span>
          <span className="ml-2 text-[10px]">Press Tab</span>
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-3 border-t border-border/40 bg-background shrink-0">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isStreaming ? '' : "Paste or type something to refine…"}
          className="w-full text-[13px] bg-foreground/[0.04] rounded-[8px] px-3 py-2 outline-none resize-none focus:bg-foreground/[0.06] placeholder:text-muted-foreground/40"
          rows={2}
          autoComplete="off"
          spellCheck={false}
          disabled={isStreaming}
        />
      </div>
    </div>
  )
}

// ─── Root component ───────────────────────────────────────────────────────
function QuickChatRoot() {
  const [mode, setMode] = React.useState<'ball' | 'expanded'>('ball')
  const workspaceId = React.useMemo(() => {
    return new URLSearchParams(window.location.search).get('workspaceId') ?? ''
  }, [])

  const handleExpand = React.useCallback(() => {
    setMode('expanded')
    window.electronAPI.resizeQuickChatWindow?.(EXPANDED_W, EXPANDED_H)
  }, [])

  const handleCollapse = React.useCallback(() => {
    setMode('ball')
    window.electronAPI.resizeQuickChatWindow?.(BALL_SIZE, BALL_SIZE)
  }, [])

  if (mode === 'ball') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-transparent">
        <Ball onClick={handleExpand} />
      </div>
    )
  }
  return <ExpandedChat workspaceId={workspaceId} onCollapse={handleCollapse} />
}

export function mountQuickChat() {
  const root = createRoot(document.getElementById('root')!)
  root.render(<QuickChatRoot />)
}
