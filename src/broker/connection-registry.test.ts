import { beforeEach, describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import {
  buildConnectionInfoList,
  deriveRole,
  findConnectionById,
  getAllConnectionEntries,
  recordInboundForSocket,
  registerConnection,
  unregisterConnection,
} from './connection-registry'
import type { ConversationStore } from './conversation-store'
import type { WsData } from './handler-context'

// Minimal store stub -- buildConnectionInfoList only calls these three.
const store = {
  getSubscriberEntryForWs: () => undefined,
  getSentinelConnection: () => undefined,
  getConversation: () => undefined,
} as unknown as ConversationStore

function makeWs(data: Partial<WsData>): ServerWebSocket<WsData> {
  return { data: { ...data } } as ServerWebSocket<WsData>
}

// Registry is module-global; clean it between tests.
beforeEach(() => {
  for (const entry of getAllConnectionEntries()) unregisterConnection(entry.ws)
})

describe('connection-registry', () => {
  test('register populates the registry; unregister removes it', () => {
    const ws = makeWs({ wsConnId: 'conn_abc', isControlPanel: true, userName: 'jonas' })
    expect(getAllConnectionEntries()).toHaveLength(0)

    registerConnection(ws)
    expect(getAllConnectionEntries()).toHaveLength(1)
    expect(findConnectionById('conn_abc')?.ws).toBe(ws)

    unregisterConnection(ws)
    expect(getAllConnectionEntries()).toHaveLength(0)
    expect(findConnectionById('conn_abc')).toBeUndefined()
  })

  test('register without a wsConnId is a no-op (guards the old empty-list bug)', () => {
    registerConnection(makeWs({ isControlPanel: true }))
    expect(getAllConnectionEntries()).toHaveLength(0)
  })

  test('buildConnectionInfoList surfaces a registered web socket', () => {
    registerConnection(makeWs({ wsConnId: 'conn_web', isControlPanel: true, userName: 'jonas', connectedAt: 123 }))
    const list = buildConnectionInfoList(store)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ connectionId: 'conn_web', role: 'web', identity: 'jonas', connectedAt: 123 })
  })

  test('recordInboundForSocket tallies bytes + message count', () => {
    const ws = makeWs({ wsConnId: 'conn_io', conversationId: 'conv_x' })
    registerConnection(ws)
    recordInboundForSocket(ws, 100)
    recordInboundForSocket(ws, 40)
    const conn = buildConnectionInfoList(store).find(c => c.connectionId === 'conn_io')
    expect(conn?.bytesIn).toBe(140)
    expect(conn?.msgsIn).toBe(2)
  })

  test('deriveRole maps wsData flags to roles', () => {
    expect(deriveRole({ isSentinel: true } as WsData)).toBe('sentinel')
    expect(deriveRole({ sentinelId: 'snt_1' } as WsData)).toBe('sentinel')
    expect(deriveRole({ isGateway: true } as WsData)).toBe('gateway')
    expect(deriveRole({ isShare: true } as WsData)).toBe('share')
    expect(deriveRole({ isControlPanel: true } as WsData)).toBe('web')
    expect(deriveRole({ conversationId: 'conv_x' } as WsData)).toBe('agent-host')
    expect(deriveRole({ userName: 'jonas', userAgent: 'Mozilla' } as WsData)).toBe('web')
    expect(deriveRole({} as WsData)).toBe('unknown')
  })
})
