/**
 * Shared MCP `ToolResult` constructors -- the not-connected / error / JSON-payload
 * shapes every broker-RPC pass-through tool returns. Factored out so the recap,
 * sotu, and any future RPC tool module return identical envelopes (no per-tool
 * copies of the same three helpers).
 */

import type { ToolResult } from '../types'

/** The broker RPC sender is not wired yet (no live connection). */
export function notConnected(): ToolResult {
  return {
    content: [{ type: 'text', text: 'Error: broker connection not ready (no RPC sender)' }],
    isError: true,
  }
}

/** A plain error result with a human message. */
export function errResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }
}

/** A success result carrying a pretty-printed JSON payload. */
export function jsonResult(payload: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}
