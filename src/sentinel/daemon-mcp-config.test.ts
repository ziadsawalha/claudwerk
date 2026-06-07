import { describe, expect, it } from 'bun:test'
import { daemonMcpEndpoint } from '../shared/daemon-mcp-endpoint'
import { writeDaemonMcpConfig } from './daemon-mcp-config'

const CONV = 'b8212d4d-1c36-4a9e-9f00-0123456789ab'

/** Capture writes instead of touching the filesystem. */
function fakeWriter() {
  const writes: Array<{ path: string; data: string }> = []
  return { write: (path: string, data: string) => writes.push({ path, data }), writes }
}

describe('writeDaemonMcpConfig', () => {
  it('returns the deterministic endpoint for the conversation', () => {
    const { write } = fakeWriter()
    const result = writeDaemonMcpConfig(CONV, write)
    expect(result.endpoint).toBe(daemonMcpEndpoint(CONV))
  })

  it('writes the mcp-config JSON pointing at that endpoint', () => {
    const { write, writes } = fakeWriter()
    const result = writeDaemonMcpConfig(CONV, write)
    expect(writes).toHaveLength(1)
    expect(writes[0].path).toBe(result.configPath)
    expect(JSON.parse(writes[0].data)).toEqual({
      mcpServers: { rclaude: { type: 'http', url: result.endpoint } },
    })
  })

  it('is deterministic -- same conversationId -> same endpoint AND config path', () => {
    const a = writeDaemonMcpConfig(CONV, () => {})
    const b = writeDaemonMcpConfig(CONV, () => {})
    expect(a.endpoint).toBe(b.endpoint)
    expect(a.configPath).toBe(b.configPath)
  })

  it('names the config path after the conversation', () => {
    const { write } = fakeWriter()
    const { configPath } = writeDaemonMcpConfig(CONV, write)
    expect(configPath).toContain(`daemon-mcp-${CONV}.json`)
  })
})
