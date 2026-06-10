/**
 * Web-control MCP tools (host site).
 *
 * The broker-only `web_*` toolset, bridged to the HOST MCP server so in-process
 * agents (claude + daemon hosts) can drive an opted-in control-panel browser
 * (Phase 5 of plan-mcp-toolset-unification.md). Each tool relays its op to the
 * broker via the generic brokerRpc('web_control_relay', ...) helper -- no new
 * callbacks, no bespoke pending registry. The broker owns all grant state and
 * resolves the target browser (explicit clientId or the implicit single client);
 * these tools only forward op + clientId + args and surface the reply.
 *
 * Descriptions live in web-control-defs.ts, copied verbatim from the broker site
 * (src/broker/routes/mcp-server.ts) so the two binding sites never drift.
 */

import { brokerRpc, hasBrokerRpcSender } from './lib/broker-rpc'
import type { McpToolContext, ToolDef, ToolResult } from './types'
import { WEB_CONTROL_TOOL_DEFS, type WebToolDescriptor } from './web-control-defs'

// Ceiling above the broker's longest op timeout (screenshot, 60s). Quick ops
// resolve well before this; it only bounds a hung browser.
const RELAY_TIMEOUT_MS = 65_000

const CLIENT_ID_PROP = {
  clientId: { type: 'string', description: 'Target browser. Omit if exactly one is opted-in.' },
}

const NO_CLIENTS_TEXT =
  'No browser is opted-in to remote control. Ask the user to enable "Allow agent remote-control" in the control panel (Settings > System > Debug).'

function notConnected(): ToolResult {
  return { content: [{ type: 'text', text: 'Error: broker connection not ready (no RPC sender)' }], isError: true }
}

function err(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

function asText(result: unknown): ToolResult {
  const text = typeof result === 'string' ? result : JSON.stringify(result ?? { ok: true }, null, 2)
  return { content: [{ type: 'text', text }] }
}

/** The explicit clientId for a tool call, or undefined to let the broker pick the
 *  implicit single client. web_list_clients takes no clientId param. */
function relayClientId(def: WebToolDescriptor, p: Record<string, unknown>): string | undefined {
  if (def.noClientId) return undefined
  return typeof p.clientId === 'string' && p.clientId ? p.clientId : undefined
}

/** Format the broker reply; list_clients gets a friendly empty hint (broker parity). */
function formatRelayResult(def: WebToolDescriptor, result: unknown): ToolResult {
  if (def.op === 'list_clients' && Array.isArray(result) && result.length === 0) {
    return { content: [{ type: 'text', text: NO_CLIENTS_TEXT }] }
  }
  return asText(result)
}

function buildToolDef(def: WebToolDescriptor): ToolDef {
  const properties = def.noClientId ? def.properties : { ...CLIENT_ID_PROP, ...def.properties }
  return {
    description: def.description,
    inputSchema: { type: 'object', properties, ...(def.required?.length ? { required: def.required } : {}) },
    async handle(params) {
      if (!hasBrokerRpcSender()) return notConnected()
      const p = params as Record<string, unknown>
      const clientId = relayClientId(def, p)
      const args = def.buildArgs ? def.buildArgs(p) : {}
      const timeoutMs = def.relayTimeoutMs ? def.relayTimeoutMs(p) : RELAY_TIMEOUT_MS
      try {
        const res = await brokerRpc<{ ok: boolean; result?: unknown; error?: string }>(
          'web_control_relay',
          { op: def.op, ...(clientId ? { clientId } : {}), args },
          { timeoutMs },
        )
        return formatRelayResult(def, res.result)
      } catch (caught) {
        // brokerRpc rejects on an ok:false reply (e.g. no opted-in browser), so
        // every broker-side failure surfaces here as an isError tool result.
        return err(caught instanceof Error ? caught.message : String(caught))
      }
    },
  }
}

export function registerWebControlTools(_ctx: McpToolContext): Record<string, ToolDef> {
  const out: Record<string, ToolDef> = {}
  for (const def of WEB_CONTROL_TOOL_DEFS) out[def.name] = buildToolDef(def)
  return out
}
