/**
 * Universal control-debug dispatch (agent-host side).
 *
 * Receives a `debug_control_send` forwarded by the broker, runs the command
 * against CC's stream-json control channel (cc_control), and streams back
 * `debug_trace_event` breadcrumbs + a final `debug_control_result`. The
 * `daemon_op` channel is handled by the daemon-agent-host, not here.
 *
 * Every command is validated against the shared registry; unknown commands and
 * transport mismatches return a structured error result (never hang the modal).
 */

import { type ControlChannel, getControlCommandSpec } from '../shared/cc-control-commands'
import type { AgentHostMessage, DebugTraceEvent } from '../shared/protocol'
import type { AgentHostContext } from './agent-host-context'

export interface DebugDispatchRequest {
  traceId: string
  channel: string
  command: string
  payload: Record<string, unknown>
}

export async function dispatchDebugControl(ctx: AgentHostContext, req: DebugDispatchRequest): Promise<void> {
  const { traceId, channel, command, payload } = req
  const conversationId = ctx.conversationId
  const t0 = Date.now()

  const send = (m: AgentHostMessage) => ctx.wsClient?.send(m)
  const trace = (seam: DebugTraceEvent['seam'], extra: Partial<DebugTraceEvent> = {}) =>
    send({ type: 'debug_trace_event', traceId, conversationId, seam, t: Date.now(), ...extra } as AgentHostMessage)
  const result = (r: { ok: boolean; response?: unknown; error?: string; code?: string }) => {
    trace('agenthost_to_broker', { ok: r.ok, detail: r.error ?? r.code })
    send({
      type: 'debug_control_result',
      traceId,
      conversationId,
      channel: channel as 'cc_control' | 'daemon_op',
      command,
      ok: r.ok,
      response: r.response,
      error: r.error,
      code: r.code,
      elapsedMs: Date.now() - t0,
      t: Date.now(),
    } as AgentHostMessage)
  }

  trace('agenthost_recv', { detail: `${channel}:${command}` })

  const spec = getControlCommandSpec(channel as ControlChannel, command)
  if (!spec) {
    trace('error', { detail: 'unknown_command' })
    result({ ok: false, code: 'unknown_command', error: `Unknown command ${channel}:${command}` })
    return
  }

  if (channel !== 'cc_control') {
    // daemon_op is dispatched by the daemon-agent-host; this host cannot.
    trace('error', { detail: 'unsupported_transport' })
    result({ ok: false, code: 'unsupported_transport', error: `channel ${channel} not available on this host` })
    return
  }

  if (!ctx.streamProc) {
    trace('error', { detail: 'unsupported_transport' })
    result({
      ok: false,
      code: 'unsupported_transport',
      error: 'cc_control requires the headless (stream-json) transport',
    })
    return
  }

  trace('agenthost_to_cc', { detail: command, raw: payload })
  try {
    const resp = await ctx.streamProc.sendControlRequest(command, payload)
    trace('cc_to_agenthost', {
      ok: resp.ok,
      detail: resp.subtype,
      raw: { subtype: resp.subtype, response: resp.response, error: resp.error, timedOut: resp.timedOut },
    })
    result({
      ok: resp.ok,
      response: resp.response,
      error: resp.error,
      code: resp.timedOut ? 'timeout' : undefined,
    })
  } catch (e) {
    trace('error', { detail: e instanceof Error ? e.message : String(e) })
    result({ ok: false, error: e instanceof Error ? e.message : String(e) })
  }
}
