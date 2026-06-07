/**
 * Convert a broker WebSocket URL to its HTTP(S) origin.
 *
 * The broker serves both WS (agent host channel) and HTTP (REST + /mcp) on the
 * same origin, so HTTP-backed tools derive their base URL from the WS one.
 */
export function wsToHttpUrl(url: string): string {
  return url.replace('ws://', 'http://').replace('wss://', 'https://')
}
