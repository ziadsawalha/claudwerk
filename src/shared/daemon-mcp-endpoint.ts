/**
 * Deterministic per-conversation MCP endpoint for daemon-hosted workers.
 *
 * Unlike the claude agent host -- which spawns `claude` ITSELF and so can write
 * its `--mcp-config` after the local /mcp server has bound a free port (see
 * `claude-agent-host/index.ts` + `local-server.ts`) -- a daemon worker's
 * `claude` process is dispatched by the cc-daemon BEFORE the daemon-host has
 * bound anything. The `--mcp-config` URL therefore has to be fixed UP FRONT.
 *
 * The sentinel computes this endpoint at dispatch, writes the worker's
 * mcp-config to point at it, and hands the SAME endpoint to the daemon-host via
 * `CLAUDWERK_MCP_ENDPOINT` so the host binds exactly this port. Chicken-egg is
 * fine: MCP connects on the first tool call, by which point the host server is
 * up. Determinism (same conversationId -> same port) means a host restart
 * re-binds the identical endpoint the worker was launched against, instead of
 * silently drifting to a dead port the way a re-scanned port would.
 *
 * Phase 2 of the MCP toolset unification (`mcp-phase3-PLAN.md`). Phase 3 (the
 * daemon-host local server) consumes `parseDaemonMcpEndpointPort` to bind.
 */

/** Env var carrying the endpoint URL from the sentinel to the daemon-host. */
export const DAEMON_MCP_ENDPOINT_ENV = 'CLAUDWERK_MCP_ENDPOINT'

/** mcp-config server key. Matches the claude-host config (`mcpServers.rclaude`). */
export const DAEMON_MCP_SERVER_NAME = 'rclaude'

/** Loopback port band -- distinct from claude-host's 19000-19899 so a daemon
 *  host and a claude host on the same machine never fight for a port. */
const PORT_BASE = 20000
const PORT_SPAN = 2000

/**
 * djb2-style string hash, byte-identical to the claude-host local-server port
 * derivation (`local-server.ts`). Returns a non-negative integer.
 */
function hashConversationId(conversationId: string): number {
  const h = conversationId.split('').reduce((acc, c) => ((acc << 5) - acc + c.charCodeAt(0)) | 0, 0)
  return Math.abs(h)
}

/** Deterministic loopback port for a conversation's daemon-host /mcp server. */
export function daemonMcpPort(conversationId: string): number {
  return PORT_BASE + (hashConversationId(conversationId) % PORT_SPAN)
}

/** Deterministic `http://127.0.0.1:<port>/mcp` endpoint for a conversation. */
export function daemonMcpEndpoint(conversationId: string): string {
  return `http://127.0.0.1:${daemonMcpPort(conversationId)}/mcp`
}

/**
 * The mcp-config JSON CC reads via `--mcp-config`: a single streamable-HTTP
 * server keyed `rclaude`, the same shape the claude host writes.
 */
export function daemonMcpConfigJson(endpoint: string): string {
  return JSON.stringify({ mcpServers: { [DAEMON_MCP_SERVER_NAME]: { type: 'http', url: endpoint } } })
}

/**
 * Parse the loopback port back out of a `CLAUDWERK_MCP_ENDPOINT` value (the
 * daemon-host side, Phase 3). Returns null for a malformed / portless URL.
 */
export function parseDaemonMcpEndpointPort(endpoint: string | undefined): number | null {
  if (!endpoint) return null
  try {
    const port = Number(new URL(endpoint).port)
    return Number.isInteger(port) && port > 0 ? port : null
  } catch {
    return null
  }
}
