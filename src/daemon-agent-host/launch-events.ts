/**
 * Daemon Launch Events
 *
 * Structured, persistent timeline of the daemon worker dispatch + attach
 * lifecycle, mirroring `src/claude-agent-host/launch-events.ts` for the
 * daemon backend. EVERYTHING IS A STRUCTURED MESSAGE -- every dispatch /
 * attach / retry / re-attach / worker-gone transition lands on the wire as a
 * typed `daemon_launch_event` so the control panel renders the full timeline.
 *
 * Emit flow:
 *   NEW / RESUME  : (sentinel) dispatch_requested -> worker_dispatched ->
 *                   attach_started -> attach_retry* -> attached
 *   ATTACH        : attach_started -> attach_retry* -> attached
 *   Socket drop   : attach_lost -> reattached (or worker_gone)
 *   Worker exit   : worker_gone
 *
 * The daemon-host owns the 6 attach-side steps. The sentinel owns the 2
 * dispatch-side steps and emits them BEFORE this process exists -- the broker
 * persists those as transcript entries so a late dashboard sees them via
 * transcript_request even if no daemon-host socket replays them.
 *
 * Replay buffer: 500 events across this host's lifetime, replayed verbatim on
 * every transport reconnect (the broker may have lost broadcast subscribers
 * during the drop). Late dashboards see them via the broker's transcript-entry
 * persistence path.
 */

import type { HostTransport } from '../shared/host-transport'
import type { DaemonLaunchEvent, DaemonLaunchStep } from '../shared/protocol'

const REPLAY_BUFFER_LIMIT = 500

export interface DaemonLaunchEventsDeps {
  /** Stable conversation id stamped on every event. */
  conversationId: string
  /** new | resume | attach -- stamped on every event. */
  daemonMode: 'new' | 'resume' | 'attach'
  /** 8-hex worker short, stamped on events once known. May be set later. */
  short?: string
  /** Broker transport -- `send()` ships the event, `isConnected()` gates replay. */
  transport: Pick<HostTransport, 'send' | 'isConnected'>
  /** Engineer-facing log sink. */
  log: (msg: string) => void
}

export interface DaemonLaunchEvents {
  /** Set or update the worker short once dispatch returns it (sentinel side
   *  dispatch_requested fires WITHOUT a short -- worker_dispatched gives one). */
  setShort(short: string): void
  /** Emit one launch step. Appends to the buffer and ships over WS when up. */
  emit(step: DaemonLaunchStep, opts?: { detail?: string; raw?: Record<string, unknown> }): void
  /** Resend every buffered event -- called on transport (re)connect. */
  replay(): void
  /** Current buffer length -- test seam. */
  bufferLength(): number
}

/**
 * Build the launch-events surface for one daemon-backed conversation. Pure
 * (the buffer is closed-over state; not exported). The `transport` may not
 * be connected at the first `emit()` -- the event still buffers and replays
 * on the eventual `onConnected` hook.
 */
export function createDaemonLaunchEvents(deps: DaemonLaunchEventsDeps): DaemonLaunchEvents {
  const buffer: DaemonLaunchEvent[] = []
  let short = deps.short

  function emit(step: DaemonLaunchStep, opts: { detail?: string; raw?: Record<string, unknown> } = {}): void {
    const evt: DaemonLaunchEvent = {
      type: 'daemon_launch_event',
      conversationId: deps.conversationId,
      step,
      daemonMode: deps.daemonMode,
      short,
      detail: opts.detail,
      raw: opts.raw,
      t: Date.now(),
    }
    buffer.push(evt)
    if (buffer.length > REPLAY_BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - REPLAY_BUFFER_LIMIT)
    }
    if (deps.transport.isConnected()) {
      deps.transport.send(evt)
    }
    deps.log(
      `[launch] step=${step} mode=${deps.daemonMode}${short ? ` short=${short}` : ''}${
        opts.detail ? ` -- ${opts.detail}` : ''
      }`,
    )
  }

  function replay(): void {
    if (!deps.transport.isConnected()) return
    for (const evt of buffer) {
      deps.transport.send(evt)
    }
    deps.log(`[launch] replayed ${buffer.length} buffered event(s) on reconnect`)
  }

  return {
    setShort(next: string): void {
      short = next
    },
    emit,
    replay,
    bufferLength: () => buffer.length,
  }
}
