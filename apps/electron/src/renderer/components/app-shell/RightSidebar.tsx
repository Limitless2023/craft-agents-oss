/**
 * RightSidebar - Content router for right sidebar panels
 *
 * Routes to different panel types based on RightSidebarPanel discriminated union.
 * Similar to how MainContentPanel routes between different page types.
 */

import * as React from 'react'
import type { RightSidebarPanel } from '../../../shared/types'
import { DocsPanel } from '../right-sidebar/DocsPanel'
import { PreviewPanel } from '../right-sidebar/PreviewPanel'

export interface RightSidebarProps {
  /** Current panel configuration */
  panel: RightSidebarPanel
  /** Close button to display in panel header */
  closeButton?: React.ReactNode
}

/**
 * Routes right sidebar content based on panel type
 */
export function RightSidebar({ panel, closeButton }: RightSidebarProps) {
  switch (panel.type) {
    case 'docs':
      return <DocsPanel closeButton={closeButton} />

    case 'preview':
      return <PreviewPanel closeButton={closeButton} />

    case 'files':
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <p className="text-sm">Files panel — Coming soon</p>
        </div>
      )

    case 'history':
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground">
          <p className="text-sm">History panel — Coming soon</p>
        </div>
      )

    case 'none':
    default:
      return null
  }
}
