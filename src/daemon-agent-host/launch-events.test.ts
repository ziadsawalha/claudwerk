import { describe, expect, it } from 'bun:test'
import type { AgentHostMessage } from '../shared/protocol'
import { createDaemonLaunchEvents } from './launch-events'

interface FakeTransport {
  sent: AgentHostMessage[]
  isUp: boolean
  send: (m: AgentHostMessage) => void
  isConnected: () => boolean
}

function makeTransport(isUp = true): FakeTransport {
  const state = { sent: [] as AgentHostMessage[], isUp }
  return {
    get sent() {
      return state.sent
    },
    get isUp() {
      return state.isUp
    },
    set isUp(v: boolean) {
      state.isUp = v
    },
    send: m => state.sent.push(m),
    isConnected: () => state.isUp,
  }
}

describe('createDaemonLaunchEvents -- emit + buffer', () => {
  it('emits an event over the transport and buffers it', () => {
    const t = makeTransport(true)
    const logs: string[] = []
    const events = createDaemonLaunchEvents({
      conversationId: 'conv_test1234567',
      daemonMode: 'new',
      transport: t,
      log: m => logs.push(m),
    })

    events.emit('dispatch_requested', { detail: 'about to dispatch' })

    expect(t.sent).toHaveLength(1)
    expect(t.sent[0]).toMatchObject({
      type: 'daemon_launch_event',
      conversationId: 'conv_test1234567',
      step: 'dispatch_requested',
      daemonMode: 'new',
      detail: 'about to dispatch',
    })
    expect(events.bufferLength()).toBe(1)
  })

  it('buffers but does NOT send while transport is down, then replays on reconnect', () => {
    const t = makeTransport(false)
    const events = createDaemonLaunchEvents({
      conversationId: 'conv_test1234567',
      daemonMode: 'attach',
      transport: t,
      log: () => {},
    })

    events.emit('attach_started')
    events.emit('attach_retry', { detail: 'ENOJOB' })
    expect(t.sent).toHaveLength(0)
    expect(events.bufferLength()).toBe(2)

    t.isUp = true
    events.replay()
    expect(t.sent).toHaveLength(2)
    expect(t.sent[0]).toMatchObject({ step: 'attach_started' })
    expect(t.sent[1]).toMatchObject({ step: 'attach_retry', detail: 'ENOJOB' })
  })

  it('caps the buffer at 500 events', () => {
    const t = makeTransport(false)
    const events = createDaemonLaunchEvents({
      conversationId: 'conv_test1234567',
      daemonMode: 'new',
      transport: t,
      log: () => {},
    })

    for (let i = 0; i < 600; i++) events.emit('attach_retry', { detail: `try=${i}` })
    expect(events.bufferLength()).toBe(500)
  })

  it('stamps the short on subsequent emits after setShort is called', () => {
    const t = makeTransport(true)
    const events = createDaemonLaunchEvents({
      conversationId: 'conv_test1234567',
      daemonMode: 'new',
      transport: t,
      log: () => {},
    })

    events.emit('dispatch_requested')
    events.setShort('abcd1234')
    events.emit('worker_dispatched')

    expect(t.sent[0]).toMatchObject({ step: 'dispatch_requested', short: undefined })
    expect(t.sent[1]).toMatchObject({ step: 'worker_dispatched', short: 'abcd1234' })
  })
})
