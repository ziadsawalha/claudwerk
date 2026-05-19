/**
 * use-daemon-roster -- live daemon worker roster for the spawn dialog's
 * ATTACH mode.
 *
 * The broker forwards each sentinel's daemon roster as a `daemon_roster`
 * message (ccSessionId stripped); use-websocket-handlers stores it per sentinel
 * in `daemonRosters`. This hook flattens every sentinel's jobs into one list,
 * tags each job with the sentinel that owns it (so the ATTACH spawn can route),
 * and -- when `requestOnMount` is set -- asks the broker to replay the cached
 * roster so a freshly-loaded dashboard does not wait for the next sentinel poll.
 */

import type { DaemonRosterJob } from '@shared/protocol'
import { useEffect, useMemo } from 'react'
import { useConversationsStore, wsSend } from './use-conversations'

/** A roster job tagged with the sentinel that owns it. */
export interface DaemonRosterEntry extends DaemonRosterJob {
  /** Sentinel that owns the worker -- routes the ATTACH spawn. */
  sentinelId?: string
  sentinelAlias?: string
}

export interface DaemonRosterView {
  /** Every live daemon worker across all sentinels, newest dispatch first. */
  jobs: DaemonRosterEntry[]
  /** True when at least one sentinel reports a reachable `claude daemon`. */
  daemonPresent: boolean
  /** True once any roster (even an empty one) has been received. */
  hasRoster: boolean
  /** Newest `observedAt` across all sentinel rosters, 0 when none seen. */
  observedAt: number
}

const EMPTY_ROSTERS: Record<string, never> = {}

/**
 * Read the flattened daemon roster. Pass `requestOnMount` (the spawn dialog
 * does, when ATTACH is the active mode) to trigger a broker replay request on
 * mount and on every reconnect.
 */
export function useDaemonRoster(requestOnMount = false): DaemonRosterView {
  const rosters = useConversationsStore(s => s.daemonRosters)
  const connectSeq = useConversationsStore(s => s.connectSeq)

  useEffect(() => {
    if (!requestOnMount) return
    // Re-request on every reconnect (connectSeq bump) so a roster missed while
    // the socket was down is replayed once it is back.
    wsSend('daemon_roster_request')
  }, [requestOnMount, connectSeq])

  return useMemo(() => {
    const map = rosters ?? EMPTY_ROSTERS
    const forwards = Object.values(map)
    const jobs: DaemonRosterEntry[] = []
    let daemonPresent = false
    let observedAt = 0
    for (const fwd of forwards) {
      if (fwd.daemonPresent) daemonPresent = true
      if (fwd.observedAt > observedAt) observedAt = fwd.observedAt
      for (const job of fwd.jobs) {
        jobs.push({ ...job, sentinelId: fwd.sentinelId, sentinelAlias: fwd.sentinelAlias })
      }
    }
    // Newest dispatch first -- startedAt descending, unknowns last.
    jobs.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    return { jobs, daemonPresent, hasRoster: forwards.length > 0, observedAt }
  }, [rosters])
}
