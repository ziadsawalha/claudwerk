/**
 * Broker-internal nightshift RPC. The orchestrator + scheduler need to read/write
 * the `.nightshift/` tree (config, queue, run artifacts) but the SENTINEL owns the
 * files. This resolves the owning sentinel for a project URI, sends one
 * `nightshift_op`, and awaits the `nightshift_result` -- the same resolve-target +
 * listener + timeout shape `handlers/nightshift.ts` uses, minus the dashboard socket.
 */

import { randomUUID } from 'node:crypto'
import type { ServerWebSocket } from 'bun'
import { parseProjectUri } from '../shared/project-uri'
import type { NightshiftOp, NightshiftResult } from '../shared/protocol'

const RPC_TIMEOUT_MS = 10_000

/** The op payload, minus the wire frame the sender fills in. */
export type NightshiftOpInput = Omit<NightshiftOp, 'type' | 'requestId' | 'projectRoot'>

/**
 * Minimal sentinel-RPC surface this helper needs. Both `ConversationStore` (the
 * orchestrator/scheduler caller) and the watchdog's `WatchdogDeps` structurally
 * satisfy it -- so all three share this ONE implementation instead of cloning it.
 */
export interface NightshiftRpcDeps {
  getSentinel: () => ServerWebSocket<unknown> | undefined
  getSentinelByAlias: (alias: string) => ServerWebSocket<unknown> | undefined
  addProjectListener: (requestId: string, cb: (result: unknown) => void) => void
  removeProjectListener: (requestId: string) => void
}

export function sendNightshiftOp(
  deps: NightshiftRpcDeps,
  project: string,
  op: NightshiftOpInput,
): Promise<NightshiftResult> {
  const parsed = parseProjectUri(project)
  const sentinel = (parsed.authority ? deps.getSentinelByAlias(parsed.authority) : undefined) ?? deps.getSentinel()
  return new Promise<NightshiftResult>(resolve => {
    const base = { type: 'nightshift_result' as const, requestId: '', op: op.op, ok: false }
    if (!sentinel) {
      resolve({ ...base, error: 'no sentinel connected for project' })
      return
    }
    const requestId = `ns-${randomUUID()}`
    const timeout = setTimeout(() => {
      deps.removeProjectListener(requestId)
      resolve({ ...base, requestId, error: 'sentinel timed out' })
    }, RPC_TIMEOUT_MS)
    deps.addProjectListener(requestId, result => {
      clearTimeout(timeout)
      resolve(result as NightshiftResult)
    })
    try {
      sentinel.send(JSON.stringify({ type: 'nightshift_op', requestId, projectRoot: parsed.path, ...op }))
    } catch {
      clearTimeout(timeout)
      deps.removeProjectListener(requestId)
      resolve({ ...base, requestId, error: 'sentinel send failed' })
    }
  })
}
