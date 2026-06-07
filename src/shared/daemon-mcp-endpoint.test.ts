import { describe, expect, it } from 'bun:test'
import {
  DAEMON_MCP_ENDPOINT_ENV,
  DAEMON_MCP_SERVER_NAME,
  daemonMcpConfigJson,
  daemonMcpEndpoint,
  daemonMcpPort,
  parseDaemonMcpEndpointPort,
} from './daemon-mcp-endpoint'

const CONV_A = 'b8212d4d-1c36-4a9e-9f00-0123456789ab'
const CONV_B = 'a586e4d4-2222-4bbb-8ccc-fedcba987654'

describe('daemonMcpEndpoint -- determinism', () => {
  it('maps the same conversationId to the same endpoint every time', () => {
    expect(daemonMcpEndpoint(CONV_A)).toBe(daemonMcpEndpoint(CONV_A))
    expect(daemonMcpPort(CONV_A)).toBe(daemonMcpPort(CONV_A))
  })

  it('gives different conversations different ports (no global constant)', () => {
    expect(daemonMcpEndpoint(CONV_A)).not.toBe(daemonMcpEndpoint(CONV_B))
  })

  it('binds loopback in the 20000-21999 band on the /mcp path', () => {
    const port = daemonMcpPort(CONV_A)
    expect(port).toBeGreaterThanOrEqual(20000)
    expect(port).toBeLessThan(22000)
    expect(daemonMcpEndpoint(CONV_A)).toBe(`http://127.0.0.1:${port}/mcp`)
  })
})

describe('daemonMcpConfigJson', () => {
  it('emits a single streamable-http server keyed rclaude', () => {
    const endpoint = daemonMcpEndpoint(CONV_A)
    expect(JSON.parse(daemonMcpConfigJson(endpoint))).toEqual({
      mcpServers: { [DAEMON_MCP_SERVER_NAME]: { type: 'http', url: endpoint } },
    })
  })
})

describe('parseDaemonMcpEndpointPort -- daemon-host side', () => {
  it('round-trips the port the sentinel computed', () => {
    expect(parseDaemonMcpEndpointPort(daemonMcpEndpoint(CONV_A))).toBe(daemonMcpPort(CONV_A))
  })

  it('returns null for an absent or malformed endpoint', () => {
    expect(parseDaemonMcpEndpointPort(undefined)).toBeNull()
    expect(parseDaemonMcpEndpointPort('')).toBeNull()
    expect(parseDaemonMcpEndpointPort('not a url')).toBeNull()
    expect(parseDaemonMcpEndpointPort('http://127.0.0.1/mcp')).toBeNull()
  })
})

describe('DAEMON_MCP_ENDPOINT_ENV', () => {
  it('is the stable env-var name the sentinel and daemon-host agree on', () => {
    expect(DAEMON_MCP_ENDPOINT_ENV).toBe('CLAUDWERK_MCP_ENDPOINT')
  })
})
