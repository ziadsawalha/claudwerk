/**
 * session-observer -- derive a daemon worker's `ccSessionId` WITHOUT a hook.
 *
 * claude-agent-host learns CC's session id from the SessionStart hook (PTY) or
 * the stream-json init message (headless). Neither fires here: the Claude Code
 * daemon owns the worker process, so claudewerk never installs a hook into it
 * and never reads its stdout.
 *
 * The daemon's `list` control op fills the gap. Every `JobRecord` carries a
 * `sessionId` -- CC's ephemeral run id -- which IS the `ccSessionId` in
 * claudewerk's identity model (see the IDENTITY MODEL covenant). We poll
 * `list`, find our worker by its short id, and report its `sessionId`:
 *
 *   - first non-empty `sessionId`  -> the worker has booted; the host attaches.
 *   - `sessionId` changes          -> a `/clear` inside the worker rotated CC's
 *                                     run id; the host re-points its transcript
 *                                     watcher and tells the broker to reset.
 *   - worker leaves the roster     -> the job ended; the host shuts down.
 *
 * Polling (not `subscribe`) is deliberate: it is a handful of bytes per second
 * over a Unix socket, survives a transient daemon restart without special
 * handling, and needs no held connection to babysit. `ccSessionId` rotation is
 * rare (only `/clear`), so sub-second latency is not required.
 */
import { list } from '../shared/cc-daemon/ops'
import type { ListResponse } from '../shared/cc-daemon/types'

/** How often to poll the daemon `list` op, in milliseconds. */
const DEFAULT_POLL_INTERVAL_MS = 1000

export interface DaemonSessionObserverOptions {
  /** Path to the daemon `control.sock`. */
  controlSock: string
  /** The 8-hex short id of the worker this conversation hosts. */
  daemonShort: string
  /** Fired with the worker's `ccSessionId`: once on boot, then on each change. */
  onSessionId: (ccSessionId: string) => void
  /** Fired once when the worker leaves the roster (job ended / removed). */
  onGone?: () => void
  /** Fired on a `list` failure. Polling continues -- the daemon may be transient. */
  onError?: (err: Error) => void
  /** Poll cadence. Default 1000ms. */
  pollIntervalMs?: number
  /**
   * Override the `list` call -- test seam. Defaults to the real cc-daemon
   * `list` op. Lets unit tests drive the observer against a fake roster with
   * no socket (see plan section 10, Tier 1).
   */
  listFn?: (sockPath: string) => Promise<ListResponse>
}

export interface DaemonSessionObserver {
  /** Stop polling. Idempotent. */
  stop(): void
}

/**
 * Start observing the daemon worker `daemonShort` for its `ccSessionId`.
 * Polling begins immediately; the returned handle only exposes `stop()`.
 */
export function observeDaemonSession(opts: DaemonSessionObserverOptions): DaemonSessionObserver {
  const pollList = opts.listFn ?? list
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS

  let lastSessionId: string | null = null
  /** True once the worker has been seen in the roster at least once -- gates
   *  `onGone` so a slow-to-register worker is not mistaken for a dead one. */
  let everSeen = false
  let goneFired = false
  let stopped = false
  let polling = false

  async function poll(): Promise<void> {
    if (stopped || polling) return
    polling = true
    try {
      const resp = await pollList(opts.controlSock)
      if (stopped) return
      const job = resp.jobs.find(j => j.short === opts.daemonShort)

      if (!job) {
        // The worker is absent. Before it has ever been seen this is just a
        // startup race (the daemon has not registered the job yet) -- keep
        // waiting. After it HAS been seen, absence means the job ended.
        if (everSeen && !goneFired) {
          goneFired = true
          opts.onGone?.()
        }
        return
      }

      everSeen = true
      const sessionId = job.sessionId
      if (sessionId && sessionId !== lastSessionId) {
        lastSessionId = sessionId
        opts.onSessionId(sessionId)
      }
    } catch (err) {
      if (!stopped) opts.onError?.(err instanceof Error ? err : new Error(String(err)))
    } finally {
      polling = false
    }
  }

  const timer: ReturnType<typeof setInterval> = setInterval(poll, pollIntervalMs)
  // Kick an immediate first poll so a fast-booting worker is not delayed by a
  // full interval before the host can attach.
  void poll()

  return {
    stop(): void {
      stopped = true
      clearInterval(timer)
    },
  }
}
