/**
 * DocsPanel - Right sidebar panel showing session info
 *
 * Displays the same content as the Info popover (session files tree),
 * but persistently visible in the right sidebar.
 */

import * as React from 'react'
import { useAtomValue } from 'jotai'
import { BookOpen } from 'lucide-react'
import { focusedSessionIdAtom } from '@/atoms/panel-stack'
import { useSession } from '@/context/AppShellContext'
import { SessionFilesSection } from './SessionFilesSection'

interface DocsPanelProps {
  closeButton?: React.ReactNode
}

/** Wrapper that reads session data once we have a valid ID */
function DocsPanelContent({ sessionId, closeButton }: { sessionId: string; closeButton?: React.ReactNode }) {
  const session = useSession(sessionId)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium">Info</span>
        </div>
        {closeButton}
      </div>

      {/* Session files */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <SessionFilesSection
          sessionId={sessionId}
          sessionFolderPath={session?.sessionFolderPath}
          hideHeader={false}
          className="h-full min-h-0"
        />
      </div>
    </div>
  )
}

export function DocsPanel({ closeButton }: DocsPanelProps) {
  const focusedSessionId = useAtomValue(focusedSessionIdAtom)

  if (!focusedSessionId) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center justify-between px-3 h-10 shrink-0 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Info</span>
          </div>
          {closeButton}
        </div>
        <div className="flex-1 flex items-center justify-center text-muted-foreground px-4">
          <p className="text-xs text-center">No session selected</p>
        </div>
      </div>
    )
  }

  return <DocsPanelContent sessionId={focusedSessionId} closeButton={closeButton} />
}
