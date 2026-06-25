/**
 * useNightshiftQueue -- the nightshift OUTLOOK data: tasks assigned to a project's
 * queue, awaiting a run. Decoupled from runs, so it works on a fresh project with
 * zero runs. Thin wrapper over the shared per-project resource.
 *
 * Wire:
 *   queue_list -> { ok, queue }   enqueue -> { ok, queued }   dequeue -> { ok, removed }
 *   nightshift_event { event:'queue_update' } -> re-fetch.
 */

import type { NightshiftEnqueueInput, NightshiftQueueItem } from '@shared/nightshift-types'
import { createNightshiftResource } from './nightshift-resource'
import { sendNightshiftRpc } from './nightshift-rpc'

const resource = createNightshiftResource<NightshiftQueueItem[]>({
  op: 'queue_list',
  extract: resp => (resp.queue as NightshiftQueueItem[] | undefined) ?? [],
})

export interface NightshiftQueueState {
  queue: NightshiftQueueItem[] | undefined
  loading: boolean
  error: string | null
  refetch: () => void
}

export function useNightshiftQueue(projectUri: string | null): NightshiftQueueState {
  const { data, loading, error, refetch } = resource.useResource(projectUri)
  return { queue: data, loading, error, refetch }
}

/** Assign one task to a project's nightshift queue. Resolves after the queue refetches. */
export async function enqueueNightshiftTask(
  projectUri: string,
  input: Omit<NightshiftEnqueueInput, 'project'>,
): Promise<void> {
  await sendNightshiftRpc({
    type: 'nightshift_request',
    project: projectUri,
    op: 'enqueue',
    enqueue: { ...input, project: projectUri },
  })
  await resource.refetch(projectUri)
}

/** Remove one queued task by id. */
export async function dequeueNightshiftTask(projectUri: string, id: string): Promise<void> {
  await sendNightshiftRpc({ type: 'nightshift_request', project: projectUri, op: 'dequeue', dequeueId: id })
  await resource.refetch(projectUri)
}
