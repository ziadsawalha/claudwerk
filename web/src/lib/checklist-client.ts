/**
 * Checklist WS client (non-React). Owns the per-project cache, the request/reply
 * plumbing, and the live `checklist_changed` subscription. The React surface
 * (useChecklist) is a thin wrapper in hooks/use-checklist.ts.
 *
 * Mirrors the project-board pattern: a per-project cache keyed by project URI,
 * request/reply via a shared `checklistHandler` store slot, and broadcasts so a
 * change in one browser session shows up in every other permitted one at once.
 *
 * Wire shape (dashboard <-> broker):
 *   checklist_list/create/set_status/update/delete/replace/archive/purge { project, requestId, ... }
 *     -> checklist_list_result { open } | checklist_op_result { ok } | checklist_archive_result { items }
 *   checklist_changed { project, open }  live broadcast (the fresh active list)
 */

import type { ChecklistItem, ChecklistStatus } from '@shared/protocol'
import { useConversationsStore } from '@/hooks/use-conversations'
import { parseChecklistInput } from './checklist-parse'

interface ChecklistCache {
  open: ChecklistItem[]
  loaded: boolean
  inflight: boolean
  subscribers: Set<() => void>
}

const REQUEST_TIMEOUT_MS = 12_000
const caches = new Map<string, ChecklistCache>()
const cacheVersions = new WeakMap<ChecklistCache, number>()
const pending = new Map<
  string,
  {
    resolve: (data: Record<string, unknown>) => void
    reject: (err: Error) => void
    timeout: ReturnType<typeof setTimeout>
  }
>()
let handlerInstalled = false

function ensureCache(projectUri: string): ChecklistCache {
  let cache = caches.get(projectUri)
  if (!cache) {
    cache = { open: [], loaded: false, inflight: false, subscribers: new Set() }
    caches.set(projectUri, cache)
  }
  return cache
}

function notify(cache: ChecklistCache): void {
  cacheVersions.set(cache, (cacheVersions.get(cache) ?? 0) + 1)
  for (const sub of cache.subscribers) sub()
}

/** Live broadcast of the fresh active list. Returns true if it handled the msg. */
function applyChecklistBroadcast(msg: Record<string, unknown>): boolean {
  if (msg.type !== 'checklist_changed') return false
  const cache = caches.get(msg.project as string)
  if (cache) {
    cache.open = (msg.open as ChecklistItem[]) ?? []
    cache.loaded = true
    notify(cache)
  }
  return true
}

/** Resolve (or reject) the pending request matching msg.requestId. */
function resolveChecklistReply(msg: Record<string, unknown>): void {
  const requestId = msg.requestId as string | undefined
  if (!requestId) return
  const p = pending.get(requestId)
  if (!p) return
  clearTimeout(p.timeout)
  pending.delete(requestId)
  if (msg.ok === false) p.reject(new Error('checklist op failed'))
  else p.resolve(msg)
}

export function installChecklistHandler(): void {
  if (handlerInstalled) return
  handlerInstalled = true
  useConversationsStore.setState({
    checklistHandler: (msg: Record<string, unknown>) => {
      if (!applyChecklistBroadcast(msg)) resolveChecklistReply(msg)
    },
  })
}

function sendWire(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID()
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('checklist request timed out'))
    }, REQUEST_TIMEOUT_MS)
    pending.set(requestId, { resolve, reject, timeout })
    useConversationsStore.getState().sendWsMessage({ ...payload, requestId })
  })
}

// ─── Cache surface used by the React hook ───────────────────────────────

export interface ChecklistApi {
  open: ChecklistItem[]
  loading: boolean
}

const EMPTY: ChecklistItem[] = []
export const EMPTY_CHECKLIST_API: ChecklistApi = { open: EMPTY, loading: false }
const snapshotCache = new WeakMap<ChecklistCache, { version: number; api: ChecklistApi }>()

export function subscribeChecklist(projectUri: string, onChange: () => void): () => void {
  const cache = ensureCache(projectUri)
  cache.subscribers.add(onChange)
  return () => cache.subscribers.delete(onChange)
}

export function getChecklistSnapshot(projectUri: string): ChecklistApi {
  const cache = ensureCache(projectUri)
  const version = cacheVersions.get(cache) ?? 0
  const cached = snapshotCache.get(cache)
  if (cached && cached.version === version) return cached.api
  const api: ChecklistApi = { open: cache.open, loading: !cache.loaded }
  snapshotCache.set(cache, { version, api })
  return api
}

/** Seed a project's open list once via `checklist_list` (idempotent). */
export function seedChecklist(projectUri: string): void {
  const cache = ensureCache(projectUri)
  if (cache.loaded || cache.inflight) return
  cache.inflight = true
  sendWire({ type: 'checklist_list', project: projectUri })
    .then(res => {
      cache.open = (res.open as ChecklistItem[]) ?? []
      cache.loaded = true
      notify(cache)
    })
    .catch(() => {
      /* leave loaded=false; a reconnect or a later broadcast retries */
    })
    .finally(() => {
      cache.inflight = false
    })
}

// ─── Imperative actions (inline block + modals) ─────────────────────────

/** Parse quick-add input (one line or a markdown paste) and create the items. */
export function addChecklistItems(projectUri: string, raw: string): Promise<unknown> {
  const items = parseChecklistInput(raw)
  if (items.length === 0) return Promise.resolve()
  return sendWire({ type: 'checklist_create', project: projectUri, items })
}

export function setChecklistStatus(projectUri: string, id: string, status: ChecklistStatus): Promise<unknown> {
  return sendWire({ type: 'checklist_set_status', project: projectUri, id, status })
}

export function editChecklistItem(projectUri: string, id: string, text: string): Promise<unknown> {
  return sendWire({ type: 'checklist_update', project: projectUri, id, text })
}

export function removeChecklistItem(projectUri: string, id: string): Promise<unknown> {
  return sendWire({ type: 'checklist_delete', project: projectUri, id })
}

export function replaceChecklist(
  projectUri: string,
  items: Array<{ text: string; status: ChecklistStatus; createdAt?: number; resolvedAt?: number }>,
): Promise<unknown> {
  return sendWire({ type: 'checklist_replace', project: projectUri, items })
}

/** One-shot fetch of the active (open + in_progress) items (bulk editor seed). */
export async function fetchChecklistOpen(projectUri: string): Promise<ChecklistItem[]> {
  installChecklistHandler()
  const res = await sendWire({ type: 'checklist_list', project: projectUri })
  return (res.open as ChecklistItem[]) ?? []
}

/** One-shot fetch of the resolved (archived) items for the completed view. */
export async function fetchChecklistArchive(projectUri: string): Promise<ChecklistItem[]> {
  installChecklistHandler()
  const res = await sendWire({ type: 'checklist_archive', project: projectUri })
  return (res.items as ChecklistItem[]) ?? []
}

/** Bulk-delete done items older than `olderThanMs`. Returns the count removed. */
export async function purgeChecklistArchive(projectUri: string, olderThanMs: number): Promise<number> {
  const res = await sendWire({ type: 'checklist_purge', project: projectUri, olderThanMs })
  return typeof res.purged === 'number' ? res.purged : 0
}
