import { useEffect, useRef } from 'react'
import { DispatchDesk } from './dispatch-desk'
import { DispatchGreeting } from './dispatch-greeting'
import { useDispatchStore } from './dispatch-store'
import { DispatchTail } from './dispatch-tail'
import { DispatchTranscript } from './dispatch-transcript'

/** The desk's scrollable body. Empty = the concierge greets you + shows what's on
 *  its desk. Otherwise it renders the STREAMED living history (the persistent
 *  conversation, the source of truth) plus a quiet in-flight tail. Decoupled from
 *  reloads -- the history is restored on open, never reset to blank. */
// fallow-ignore-next-line complexity -- a presentational && chain; score is coverage-inflated, not real risk
export function DispatchFlow() {
  const turns = useDispatchStore(s => s.history?.transcript)
  const hasDecisions = useDispatchStore(s => s.decisions.length > 0)
  const pending = useDispatchStore(s => s.pending)
  const endRef = useRef<HTMLDivElement>(null)

  const empty = !turns?.length && !hasDecisions

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to newest on change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns?.length, pending])

  if (empty) {
    return (
      <div className="dispatch-scroll min-h-0 flex-1 overflow-y-auto">
        <DispatchGreeting />
        <DispatchDesk />
      </div>
    )
  }

  return (
    <div className="dispatch-scroll min-h-0 flex-1 overflow-y-auto">
      <DispatchTranscript turns={turns ?? []} />
      <DispatchTail />
      <div ref={endRef} />
    </div>
  )
}
