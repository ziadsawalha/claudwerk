/**
 * Web Debug Control handlers (broker side).
 *
 * Three control-panel-originated messages:
 *   web_control_advertise  -> register/refresh an opted-in browser
 *   web_control_revoke     -> explicit early opt-out
 *   web_control_response   -> resolve a pending web_control_request (by requestId)
 *
 * The outbound web_control_request is sent by the MCP `web_*` tools via
 * src/broker/web-control.ts (not a handler). The advertise/revoke/response trio is
 * gated to the control-panel role -- share viewers must never opt a browser into
 * control.
 *
 * Plus one AGENT-HOST-originated message:
 *   web_control_relay      -> bridge a web-control op from the HOST MCP site
 *
 * In-process agents talk to the host MCP server, which has no direct line to the
 * broker's web-control registry. The host `web_*` tools mint a brokerRpc and send
 * `web_control_relay`; this handler resolves the target (explicit clientId or the
 * implicit single client) and runs the op via the SAME sendWebControlRequest /
 * listWebControlClients the broker MCP site uses, then replies
 * web_control_relay_response (matched by requestId). Gated to the agent-host role.
 * Boundary-clean: reads only op/args/clientId/requestId, never ccSessionId.
 */

import { WEB_CONTROL_OPS, type WebControlOp } from '../../shared/protocol'
import type { HandlerContext, MessageData, MessageHandler } from '../handler-context'
import { AGENT_HOST_ONLY, registerHandlers } from '../message-router'
import {
  advertiseWebControl,
  listWebControlClients,
  resolveImplicitClient,
  resolveWebControlResponse,
  revokeWebControl,
  sendWebControlRequest,
} from '../web-control'

const OP_SET = new Set<string>(WEB_CONTROL_OPS)

function sanitizeCaps(raw: unknown): WebControlOp[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((c): c is WebControlOp => typeof c === 'string' && OP_SET.has(c))
}

const webControlAdvertise: MessageHandler = (ctx: HandlerContext, data: MessageData) => {
  const clientId = typeof data.clientId === 'string' ? data.clientId : ''
  const grantId = typeof data.grantId === 'string' ? data.grantId : ''
  const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : 0
  const capabilities = sanitizeCaps(data.capabilities)
  const label = typeof data.label === 'string' ? data.label.slice(0, 200) : undefined

  if (!clientId || !grantId || !expiresAt || capabilities.length === 0) {
    ctx.reply({
      type: 'web_control_advertise_ack',
      ok: false,
      error: 'web_control_advertise requires clientId, grantId, expiresAt, and at least one capability',
    })
    return
  }

  const { expiresAt: effective } = advertiseWebControl(ctx.ws, {
    clientId,
    grantId,
    expiresAt,
    capabilities,
    label,
  })
  // Echo the broker-clamped expiry so the browser can align its local countdown.
  ctx.reply({ type: 'web_control_advertise_ack', ok: true, clientId, grantId, expiresAt: effective })
}

const webControlRevoke: MessageHandler = (ctx: HandlerContext, data: MessageData) => {
  const clientId = typeof data.clientId === 'string' ? data.clientId : ''
  if (clientId) revokeWebControl(clientId, 'client_revoke')
  ctx.reply({ type: 'web_control_revoke_ack', ok: true, clientId })
}

const webControlResponse: MessageHandler = (_ctx: HandlerContext, data: MessageData) => {
  const requestId = typeof data.requestId === 'string' ? data.requestId : ''
  if (!requestId) return
  resolveWebControlResponse({
    requestId,
    ok: data.ok !== false,
    result: data.result,
    error: typeof data.error === 'string' ? data.error : undefined,
  })
}

/** Coerce a loose `args` field to a plain object (drop arrays / non-objects). */
function relayArgs(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/** Resolve the relay target: an explicit clientId, else the implicit single client. */
function relayTarget(data: MessageData): { clientId: string } | { error: string } {
  const explicit = typeof data.clientId === 'string' && data.clientId ? data.clientId : undefined
  return explicit ? { clientId: explicit } : resolveImplicitClient()
}

const EXECUTE_SCRIPT_DEFAULT_MS = 20_000
const EXECUTE_SCRIPT_MAX_MS = 60 * 60 * 1000 // 1h ceiling (Jonas)
// The browser races the script at timeoutMs; the broker must wait a touch longer
// than the browser so the browser's own timeout reply wins (legible error).
const RELAY_BUFFER_MS = 5_000

function clampScriptTimeout(raw: unknown): number {
  const requested = typeof raw === 'number' ? raw : EXECUTE_SCRIPT_DEFAULT_MS
  return Math.min(Math.max(1000, requested), EXECUTE_SCRIPT_MAX_MS)
}

/** execute_script is benevolent-only. This host-relay is the ONLY entry (the
 *  external broker MCP never registers web_execute_script), so this is the gate. */
function scriptForbidden(ctx: HandlerContext, op: string): boolean {
  return op === 'execute_script' && ctx.callerSettings?.trustLevel !== 'benevolent'
}

/** Send opts for execute_script: a long per-op timeout matching the script timeout
 *  (so the browser's own timeout reply wins), plus the server-half AUDIT log. Other
 *  ops use the default timeout (undefined). */
function scriptOpts(
  ctx: HandlerContext,
  op: string,
  args: Record<string, unknown>,
  clientId: string,
): { timeoutMs: number } | undefined {
  if (op !== 'execute_script') return undefined
  const timeoutMs = clampScriptTimeout(args.timeoutMs)
  const code = typeof args.code === 'string' ? args.code : ''
  const caller = ctx.ws.data.conversationId ? String(ctx.ws.data.conversationId).slice(0, 8) : '?'
  console.log(
    `[web-control][audit] execute_script client=${clientId} caller=${caller} ` +
      `codeLen=${code.length} timeoutMs=${timeoutMs} preview=${JSON.stringify(code.slice(0, 120))}`,
  )
  return { timeoutMs: timeoutMs + RELAY_BUFFER_MS }
}

/** agent host -> broker: relay one web-control op (or a list_clients read) from the
 *  host MCP site. The broker owns grant state; the agent host only forwards. */
const webControlRelay: MessageHandler = async (ctx: HandlerContext, data: MessageData) => {
  const requestId = typeof data.requestId === 'string' ? data.requestId : ''
  if (!requestId) return
  const reply = (r: { ok: boolean; result?: unknown; error?: string }) =>
    ctx.reply({ type: 'web_control_relay_response', requestId, ...r })

  const op = typeof data.op === 'string' ? data.op : ''
  if (!op) return reply({ ok: false, error: 'web_control_relay requires op' })
  // Broker-local registry read -- no browser hop.
  if (op === 'list_clients') return reply({ ok: true, result: listWebControlClients() })
  if (!OP_SET.has(op)) return reply({ ok: false, error: `unknown web-control op '${op}'` })
  // Trust gate before resolving a target -- reject unauthorized eval up front.
  if (scriptForbidden(ctx, op)) return reply({ ok: false, error: 'web_execute_script requires benevolent trust level' })

  const target = relayTarget(data)
  if ('error' in target) return reply({ ok: false, error: target.error })

  const args = relayArgs(data.args)
  const r = await sendWebControlRequest(
    target.clientId,
    op as WebControlOp,
    args,
    scriptOpts(ctx, op, args, target.clientId),
  )
  reply({ ok: r.ok, result: r.result, error: r.error })
}

export function registerWebControlHandlers(): void {
  registerHandlers(
    {
      web_control_advertise: webControlAdvertise,
      web_control_revoke: webControlRevoke,
      web_control_response: webControlResponse,
    },
    ['control-panel'],
  )
  registerHandlers({ web_control_relay: webControlRelay }, AGENT_HOST_ONLY)
}
