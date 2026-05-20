/**
 * cc-version-watcher -- detect Claude Code daemon version / protocol changes.
 *
 * The sentinel pings the daemon control socket on boot and on a poll interval.
 * `ping` returns `{ version, proto }`; we compare against the last-seen pair
 * persisted to disk and emit one `cc_version_changed` event on every diff.
 *
 * The factory is a pure seam: ping / load / persist / emit are injected, the
 * `runOnce` method drives one full cycle, and `start` / `stop` add the timer.
 * This makes the diff logic unit-testable without a real socket or filesystem.
 *
 * LOG EVERYTHING -- every version diff logs prev/next on both axes plus the
 * observed-at timestamp; every ping failure logs the error tail. No-change
 * polls are silent except in debug.
 *
 * EVERYTHING IS A STRUCTURED MESSAGE -- `emit` carries a typed
 * `CcVersionChanged` payload; the broker handler persists + broadcasts it.
 */
import type { CcVersionChanged } from '../shared/protocol'

/** Last-seen pair persisted between sentinel restarts. Both null on first run. */
export interface LastSeenCcVersion {
  version: string | null
  proto: number | null
}

/** Result of a ping against the daemon control socket. */
export interface PingResult {
  version: string
  proto: number
}

export interface CcVersionWatcherOptions {
  /** Ping the control socket. Returns `null` when the daemon is unreachable. */
  ping: () => Promise<PingResult | null>
  /** Read the persisted last-seen pair (sync -- called once at start + once per cycle). */
  loadLastSeen: () => LastSeenCcVersion
  /** Persist a new last-seen pair after a diff fires. */
  persistLastSeen: (next: LastSeenCcVersion) => void
  /** Emit a `CcVersionChanged` event when a diff is observed. */
  emit: (event: CcVersionChanged) => void
  /** Diagnostic hook -- called on every ping failure. Pure side-channel. */
  onError?: (err: Error) => void
  /** Poll interval in ms. Default 60_000. */
  intervalMs?: number
  /** Sentinel id stamped onto every emitted event. */
  sentinelId: string
  /** Clock seam -- defaults to `Date.now`. */
  now?: () => number
}

export interface CcVersionWatcher {
  /** Begin polling. Idempotent. */
  start(): void
  /** Stop polling + release the timer. Idempotent. */
  stop(): void
  /** Run one cycle synchronously -- the unit-test seam. */
  runOnce(): Promise<void>
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/**
 * Compute whether a ping result differs from the last-seen pair. Returns the
 * diff payload (sans `sentinelId` / `observedAt`) or `null` when they match.
 *
 * First observation after install: lastSeen.version === null AND the ping
 * succeeds -- this counts as a diff with `fromVersion: null`. Same for proto.
 */
export function diffCcVersion(
  prev: LastSeenCcVersion,
  next: PingResult,
): { fromVersion: string | null; toVersion: string; fromProto: number | null; toProto: number } | null {
  const versionChanged = prev.version !== next.version
  const protoChanged = prev.proto !== next.proto
  if (!versionChanged && !protoChanged) return null
  return {
    fromVersion: prev.version,
    toVersion: next.version,
    fromProto: prev.proto,
    toProto: next.proto,
  }
}

/**
 * Build a watcher. Pure factory: no side effects until `start()` or `runOnce()`.
 */
export function createCcVersionWatcher(opts: CcVersionWatcherOptions): CcVersionWatcher {
  const intervalMs = opts.intervalMs ?? 60_000
  const now = opts.now ?? Date.now
  let timer: ReturnType<typeof setInterval> | null = null
  let running = false
  let inFlight = false

  async function runOnce(): Promise<void> {
    if (inFlight) return
    inFlight = true
    try {
      let pingResult: PingResult | null
      try {
        pingResult = await opts.ping()
      } catch (err) {
        opts.onError?.(toError(err))
        return
      }
      if (!pingResult) return // daemon unreachable -- silent skip
      const prev = opts.loadLastSeen()
      const diff = diffCcVersion(prev, pingResult)
      if (!diff) return
      const event: CcVersionChanged = {
        type: 'cc_version_changed',
        sentinelId: opts.sentinelId,
        ...diff,
        observedAt: now(),
      }
      opts.persistLastSeen({ version: pingResult.version, proto: pingResult.proto })
      opts.emit(event)
    } finally {
      inFlight = false
    }
  }

  return {
    start(): void {
      if (running) return
      running = true
      void runOnce() // immediate cycle on start
      timer = setInterval(() => {
        void runOnce()
      }, intervalMs)
    },
    stop(): void {
      running = false
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
    runOnce,
  }
}
