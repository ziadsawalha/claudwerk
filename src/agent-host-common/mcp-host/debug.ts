/**
 * Debug-log indirection for the shared host MCP server.
 *
 * This module lives in src/shared/, so it cannot reach into any agent host's
 * own logger. Each host injects its logger once via setMcpHostDebug() at init;
 * the default is a no-op so the shared server is usable standalone (tests,
 * hosts without a file logger). Behavior-preserving: claude-agent-host wires its
 * existing `debug` in, so every call routes to the same place as before.
 */
let logFn: (msg: string) => void = () => {}

export function setMcpHostDebug(fn: (msg: string) => void): void {
  logFn = fn
}

export function debug(msg: string): void {
  logFn(msg)
}
