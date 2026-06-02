/**
 * Live "what it's doing now" activity phrase.
 *
 * Subscribes to the ephemeral activity-phrase store (outside Zustand) and
 * renders only while a phrase is set for this conversation. Fed by CC's
 * headless `task_summary` (debounced classifier); clears on the idle null.
 */

import { memo, useSyncExternalStore } from 'react'
import { getActivityPhrase, getVersion, subscribe } from '@/hooks/activity-phrase-store'
import { Collapse } from './collapse'

interface ActivityPhrasePillProps {
  conversationId: string | null
}

export const ActivityPhrasePill = memo(function ActivityPhrasePill({ conversationId }: ActivityPhrasePillProps) {
  useSyncExternalStore(subscribe, getVersion, getVersion)
  const phrase = conversationId ? getActivityPhrase(conversationId) : undefined
  const show = !!phrase

  return (
    <Collapse show={show}>
      {show && (
        <div className="mt-1 flex items-center gap-2 px-4 py-1 text-[11px] font-mono text-muted-foreground/60">
          <span className="inline-block size-1.5 bg-accent rounded-full animate-pulse" />
          <span className="text-cyan-400/70 truncate">{phrase}</span>
        </div>
      )}
    </Collapse>
  )
})
