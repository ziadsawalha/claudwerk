/**
 * Generic per-project nightshift resource: a fetch-once-cache-and-subscribe store
 * backed by one RPC op, refetched on live beats. Both the snapshot hook and the
 * queue hook are thin wrappers over this -- the cache/subscribe/refetch machinery
 * lives here once instead of being copied per hook.
 */

import { useEffect, useSyncExternalStore } from 'react'
import { installNightshiftHandler, onNightshiftEvent, sendNightshiftRpc } from './nightshift-rpc'

interface Cache<T> {
  data: T | undefined
  loading: boolean
  error: string | null
  inflight: Promise<void> | null
  subs: Set<() => void>
}

export interface ResourceState<T> {
  data: T | undefined
  loading: boolean
  error: string | null
  refetch: () => void
}

interface ResourceOpts<T> {
  /** The nightshift RPC op this resource reads. */
  op: string
  /** Pull the typed payload out of the RPC reply. */
  extract: (resp: Record<string, unknown>) => T
  /** Return true to IGNORE a live beat (e.g. the queue ignores nothing, the snapshot ignores queue_update). */
  ignoreEvent?: (event: string) => boolean
}

export interface NightshiftResource<T> {
  useResource: (projectUri: string | null) => ResourceState<T>
  /** Force a refetch (used after a write op resolves). */
  refetch: (projectUri: string) => Promise<void>
}

export function createNightshiftResource<T>(opts: ResourceOpts<T>): NightshiftResource<T> {
  const caches = new Map<string, Cache<T>>()
  const versions = new WeakMap<Cache<T>, number>()
  const stable = new WeakMap<Cache<T>, { version: number; state: ResourceState<T> }>()
  let eventBound = false

  const EMPTY: ResourceState<T> = { data: undefined, loading: false, error: null, refetch: () => {} }

  function ensure(uri: string): Cache<T> {
    let c = caches.get(uri)
    if (!c) {
      c = { data: undefined, loading: false, error: null, inflight: null, subs: new Set() }
      caches.set(uri, c)
    }
    return c
  }

  function notify(c: Cache<T>): void {
    versions.set(c, (versions.get(c) ?? 0) + 1)
    for (const sub of c.subs) sub()
  }

  function fetchInto(uri: string, c: Cache<T>): Promise<void> {
    if (c.inflight) return c.inflight
    const promise = (async () => {
      c.loading = true
      c.error = null
      notify(c)
      try {
        const resp = await sendNightshiftRpc({ type: 'nightshift_request', project: uri, op: opts.op })
        c.data = opts.extract(resp)
        c.error = resp.ok === false ? ((resp.error as string) ?? 'unknown error') : null
      } catch (err) {
        c.error = err instanceof Error ? err.message : String(err)
      } finally {
        c.loading = false
        c.inflight = null
        notify(c)
      }
    })()
    c.inflight = promise
    return promise
  }

  function bindEvents(): void {
    if (eventBound) return
    eventBound = true
    onNightshiftEvent(beat => {
      if (opts.ignoreEvent?.(beat.event)) return
      const c = caches.get(beat.project)
      if (c) void fetchInto(beat.project, c)
    })
  }

  function buildState(uri: string, c: Cache<T>): ResourceState<T> {
    const version = versions.get(c) ?? 0
    const cached = stable.get(c)
    if (cached && cached.version === version) return cached.state
    const state: ResourceState<T> = {
      data: c.data,
      loading: c.loading,
      error: c.error,
      refetch: () => {
        c.inflight = null
        void fetchInto(uri, c)
      },
    }
    stable.set(c, { version, state })
    return state
  }

  function useResource(projectUri: string | null): ResourceState<T> {
    useEffect(() => {
      installNightshiftHandler()
      bindEvents()
    }, [])

    const state = useSyncExternalStore<ResourceState<T>>(
      onChange => {
        if (!projectUri) return () => {}
        const c = ensure(projectUri)
        c.subs.add(onChange)
        return () => c.subs.delete(onChange)
      },
      () => (projectUri ? buildState(projectUri, ensure(projectUri)) : EMPTY),
      () => EMPTY,
    )

    useEffect(() => {
      if (!projectUri) return
      const c = ensure(projectUri)
      if (c.data === undefined && !c.inflight) void fetchInto(projectUri, c)
    }, [projectUri])

    return state
  }

  return { useResource, refetch: uri => fetchInto(uri, ensure(uri)) }
}
