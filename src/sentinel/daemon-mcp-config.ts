/**
 * Sentinel-side writer for a daemon worker's host MCP config.
 *
 * At a NEW/RESUME daemon dispatch the sentinel computes the worker's
 * deterministic /mcp endpoint (`daemonMcpEndpoint`), writes the `--mcp-config`
 * JSON pointing at it to an owner-only temp file, and returns both the path
 * (baked into the worker argv) and the endpoint (handed to the daemon-host via
 * `CLAUDWERK_MCP_ENDPOINT`). Kept out of `daemon-dispatch.ts`, which is
 * deliberately side-effect-free.
 */
import { daemonMcpConfigJson, daemonMcpEndpoint } from '../shared/daemon-mcp-endpoint'
import { secureTmpPath, writeSecureFileSync } from '../shared/secure-temp'

export interface DaemonMcpConfig {
  /** The deterministic `http://127.0.0.1:<port>/mcp` endpoint. */
  endpoint: string
  /** Absolute path of the written mcp-config JSON (worker `--mcp-config`). */
  configPath: string
}

/**
 * Compute the conversation's host MCP endpoint and write its mcp-config JSON.
 * Deterministic: same conversationId -> same endpoint AND same config path, so
 * a re-dispatch overwrites in place rather than littering temp files. `write`
 * is injected for tests; production uses the 0600 secure writer.
 */
export function writeDaemonMcpConfig(
  conversationId: string,
  write: (path: string, data: string) => void = writeSecureFileSync,
): DaemonMcpConfig {
  const endpoint = daemonMcpEndpoint(conversationId)
  const configPath = secureTmpPath(`daemon-mcp-${conversationId}.json`)
  write(configPath, daemonMcpConfigJson(endpoint))
  return { endpoint, configPath }
}
