/**
 * CONTRACT: Bun.serve ephemeral-port + WebSocket upgrade/echo.
 *
 * Mirrors broker/index.ts (main WS/HTTP server via server.upgrade) and
 * claude-agent-host/local-server.ts (port-scan with port:0 to find a free port,
 * plus the hook-callback HTTP endpoint).
 */

import { describe, expect, test } from 'bun:test'
import { waitFor } from './_helpers'

describe('Bun.serve + WebSocket contract', () => {
  test('port:0 assigns a real port; HTTP responds; WS upgrades and echoes', async () => {
    const server = Bun.serve({
      port: 0, // ephemeral -- the port-scan pattern local-server.ts relies on
      fetch(req, srv) {
        if (srv.upgrade(req)) return undefined
        return new Response('hi')
      },
      websocket: {
        message(ws, msg) {
          ws.send(`echo:${msg}`)
        },
      },
    })

    try {
      // port:0 must resolve to a concrete assigned port.
      expect(server.port).toBeGreaterThan(0)

      // Plain HTTP path.
      const res = await fetch(`http://localhost:${server.port}/`)
      expect(await res.text()).toBe('hi')

      // WebSocket upgrade + round-trip.
      const ws = new WebSocket(`ws://localhost:${server.port}/`)
      let received = ''
      let open = false
      ws.addEventListener('open', () => {
        open = true
        ws.send('ping')
      })
      ws.addEventListener('message', e => {
        received = String(e.data)
      })
      await waitFor(() => open, { label: 'ws open' })
      await waitFor(() => received === 'echo:ping', { label: 'ws echo' })
      expect(received).toBe('echo:ping')
      ws.close()
    } finally {
      server.stop(true)
    }
  })
})
