/**
 * useNightshift -- fetch + subscribe to the latest nightshift run snapshot.
 * Thin wrapper over the shared per-project resource (nightshift-resource.ts).
 *
 * Wire: nightshift_request { op:'snapshot', project } -> nightshift_result { ok, snapshot }.
 * Queue beats don't change the run snapshot, so they're ignored here.
 */

import type { NightshiftRunSnapshot } from '@shared/nightshift-types'
import { createNightshiftResource } from './nightshift-resource'

type Snapshot = NightshiftRunSnapshot | null

const resource = createNightshiftResource<Snapshot>({
  op: 'snapshot',
  extract: resp => (resp.snapshot as Snapshot | undefined) ?? null,
  ignoreEvent: event => event === 'queue_update',
})

export interface NightshiftState {
  snapshot: Snapshot | undefined
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useNightshift(projectUri: string | null): NightshiftState {
  const { data, loading, error, refetch } = resource.useResource(projectUri)
  return { snapshot: data, loading, error, refetch }
}
