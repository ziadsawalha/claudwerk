import { afterEach, beforeAll, describe, expect, it } from 'bun:test'
import type { HandlerContext, MessageData, WsData } from '../../handler-context'
import { routeMessage } from '../../message-router'
import { __resetWebControlForTests, listWebControlClients } from '../../web-control'
import { registerWebControlHandlers } from '../web-control'

beforeAll(() => {
  registerWebControlHandlers()
})

afterEach(() => {
  __resetWebControlForTests()
})

function run(
  type: string,
  data: MessageData,
  wsData: Partial<WsData>,
  callerSettings?: { trustLevel?: string },
): Record<string, unknown>[] {
  const replies: Record<string, unknown>[] = []
  const ctx = {
    ws: { data: wsData, send() {} },
    reply: (m: Record<string, unknown>) => replies.push(m),
    requirePermission: () => {},
    callerSettings,
    log: { info() {}, error() {}, debug() {} },
  } as unknown as HandlerContext
  routeMessage(ctx, type, data)
  return replies
}

const CONTROL_PANEL: Partial<WsData> = { userName: 'jonas', userAgent: 'TestBrowser/1.0', isControlPanel: true }
const ADVERTISE: MessageData = {
  clientId: 'web_h1',
  grantId: 'g1',
  expiresAt: Date.now() + 60_000,
  capabilities: ['screenshot', 'list_commands'],
  label: 'Mac / Chrome',
}

describe('web_control_advertise handler', () => {
  it('registers an opted-in browser for a control-panel caller', () => {
    const replies = run('web_control_advertise', { ...ADVERTISE }, CONTROL_PANEL)
    expect(replies[0]).toMatchObject({ type: 'web_control_advertise_ack', ok: true, clientId: 'web_h1' })
    expect(listWebControlClients().map(c => c.clientId)).toContain('web_h1')
  })

  it('rejects an agent-host caller via the router role gate (default-deny by role)', () => {
    const replies = run('web_control_advertise', { ...ADVERTISE, requestId: 'r1' }, {})
    expect(replies[0]).toMatchObject({ type: 'web_control_advertise_result', ok: false, requestId: 'r1' })
    expect(String(replies[0].error)).toContain('Forbidden')
    expect(listWebControlClients()).toHaveLength(0)
  })

  it('rejects an advertise with no capabilities', () => {
    const replies = run('web_control_advertise', { ...ADVERTISE, capabilities: [] }, CONTROL_PANEL)
    expect(replies[0]).toMatchObject({ type: 'web_control_advertise_ack', ok: false })
    expect(listWebControlClients()).toHaveLength(0)
  })

  it('drops unknown capability strings but keeps valid ones', () => {
    run('web_control_advertise', { ...ADVERTISE, capabilities: ['screenshot', 'rm_rf', 'send_prompt'] }, CONTROL_PANEL)
    const [c] = listWebControlClients()
    expect(c.capabilities).toEqual(['screenshot', 'send_prompt'])
  })
})

describe('web_control_revoke handler', () => {
  it('removes a client for a control-panel caller', () => {
    run('web_control_advertise', { ...ADVERTISE }, CONTROL_PANEL)
    expect(listWebControlClients()).toHaveLength(1)
    const replies = run('web_control_revoke', { clientId: 'web_h1' }, CONTROL_PANEL)
    expect(replies[0]).toMatchObject({ type: 'web_control_revoke_ack', ok: true })
    expect(listWebControlClients()).toHaveLength(0)
  })
})

describe('web_control_relay handler (host bridge)', () => {
  it('rejects a control-panel caller (relay is agent-host only)', () => {
    const replies = run('web_control_relay', { requestId: 'rl1', op: 'list_clients' }, CONTROL_PANEL)
    expect(replies[0]).toMatchObject({ type: 'web_control_relay_result', ok: false, requestId: 'rl1' })
    expect(String(replies[0].error)).toContain('Forbidden')
  })

  it('serves list_clients (broker-local) for an agent-host caller', () => {
    run('web_control_advertise', { ...ADVERTISE }, CONTROL_PANEL)
    const replies = run('web_control_relay', { requestId: 'rl2', op: 'list_clients' }, {})
    expect(replies[0]).toMatchObject({ type: 'web_control_relay_response', requestId: 'rl2', ok: true })
    const result = replies[0].result as Array<{ clientId: string }>
    expect(result.map(c => c.clientId)).toContain('web_h1')
  })

  it('rejects an unknown op', () => {
    const replies = run('web_control_relay', { requestId: 'rl3', op: 'rm_rf' }, {})
    expect(replies[0]).toMatchObject({ type: 'web_control_relay_response', requestId: 'rl3', ok: false })
    expect(String(replies[0].error)).toContain('unknown web-control op')
  })

  it('errors when no browser is opted-in and no clientId is given', () => {
    const replies = run('web_control_relay', { requestId: 'rl4', op: 'screenshot' }, {})
    expect(replies[0]).toMatchObject({ type: 'web_control_relay_response', requestId: 'rl4', ok: false })
    expect(String(replies[0].error)).toContain('No browser is opted-in')
  })

  it('rejects execute_script from a non-benevolent caller (before resolving a target)', () => {
    const replies = run('web_control_relay', { requestId: 'rl5', op: 'execute_script', code: 'return 1' }, {})
    expect(replies[0]).toMatchObject({ type: 'web_control_relay_response', requestId: 'rl5', ok: false })
    expect(String(replies[0].error)).toContain('benevolent trust level')
  })

  it('a benevolent caller passes the trust gate (then fails only on no opted-in client)', () => {
    const replies = run(
      'web_control_relay',
      { requestId: 'rl6', op: 'execute_script', code: 'return 1' },
      {},
      { trustLevel: 'benevolent' },
    )
    expect(replies[0]).toMatchObject({ type: 'web_control_relay_response', requestId: 'rl6', ok: false })
    // Past the trust gate -> the only remaining failure is target resolution.
    expect(String(replies[0].error)).toContain('No browser is opted-in')
  })
})
