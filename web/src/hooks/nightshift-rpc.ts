/**
 * Shared nightshift wire plumbing.
 *
 * The control panel routes every nightshift RPC reply through ONE store slot
 * (`nightshiftHandler`, dispatched by use-websocket.ts). Both the snapshot hook
 * (use-nightshift) and the queue hook (use-nightshift-queue) ride this module so
 * they can coexist on that single slot: requests resolve by `requestId`, and
 * `nightshift_event` broadcasts fan out to every registered listener (each hook
 * decides whether the event concerns its project and refetches).
 */

import { useConversationsStore } from './use-conversations'

const REQUEST_TIMEOUT_MS = 12_000

interface PendingRequest {
  resolve: (data: Record<string, unknown>) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const pendingRequests = new Map<string, PendingRequest>()

/** A live nightshift beat: a write op persisted for some project. */
export interface NightshiftEventMsg {
  project: string
  event: string
  runId?: string
}

const eventListeners = new Set<(e: NightshiftEventMsg) => void>()
let handlerInstalled = false

/** Send one nightshift RPC and await its matching `nightshift_result`. */
export function sendNightshiftRpc(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId)
      reject(new Error('nightshift request timed out'))
    }, REQUEST_TIMEOUT_MS)
    pendingRequests.set(requestId, { resolve, reject, timeout })
    useConversationsStore.getState().sendWsMessage({ ...payload, requestId })
  })
}

/** Subscribe to nightshift live beats. Returns an unsubscribe fn. */
export function onNightshiftEvent(fn: (e: NightshiftEventMsg) => void): () => void {
  eventListeners.add(fn)
  return () => eventListeners.delete(fn)
}

/** Resolve the pending promise for a `nightshift_result` reply. */
function resolvePending(msg: Record<string, unknown>): void {
  const requestId = msg.requestId as string | undefined
  const pending = requestId ? pendingRequests.get(requestId) : undefined
  if (!pending || !requestId) return
  clearTimeout(pending.timeout)
  pendingRequests.delete(requestId)
  if (msg.ok === false) pending.reject(new Error((msg.error as string) ?? 'nightshift error'))
  else pending.resolve(msg)
}

/** Fan a `nightshift_event` beat out to every listener. */
function fanEvent(msg: Record<string, unknown>): void {
  const project = msg.project as string | undefined
  if (!project) return
  const beat: NightshiftEventMsg = { project, event: String(msg.event ?? ''), runId: msg.runId as string }
  for (const fn of eventListeners) fn(beat)
}

/** Install the single shared handler (idempotent). */
export function installNightshiftHandler(): void {
  if (handlerInstalled) return
  handlerInstalled = true
  useConversationsStore.setState({
    nightshiftHandler: (msg: Record<string, unknown>) => {
      if (msg.type === 'nightshift_result') resolvePending(msg)
      else if (msg.type === 'nightshift_event') fanEvent(msg)
    },
  })
}
