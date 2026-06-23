import { describe, expect, test } from 'bun:test'
import type { ServerWebSocket } from 'bun'
import type { ConversationStore } from '../conversation-store'
import { broadcastToUser } from './shared'

/** A fake socket capturing what was sent, tagged with an authed userName. */
function sock(userName?: string) {
  const sent: string[] = []
  const ws = { data: { userName }, send: (s: string) => sent.push(s) } as unknown as ServerWebSocket<unknown>
  return { ws, sent }
}

function storeWith(...sockets: ServerWebSocket<unknown>[]): ConversationStore {
  return { getSubscribers: () => new Set(sockets) } as unknown as ConversationStore
}

describe('broadcastToUser', () => {
  test('delivers ONLY to sockets whose authed userName matches the userId', () => {
    const jonas1 = sock('jonas')
    const jonas2 = sock('jonas')
    const alice = sock('alice')
    const anon = sock(undefined)
    const store = storeWith(jonas1.ws, jonas2.ws, alice.ws, anon.ws)

    broadcastToUser(store, 'jonas', { type: 'dispatch_history', userId: 'jonas' })

    expect(jonas1.sent).toHaveLength(1) // every device the user has open...
    expect(jonas2.sent).toHaveLength(1)
    expect(JSON.parse(jonas1.sent[0]).userId).toBe('jonas')
    expect(alice.sent).toHaveLength(0) // ...and nobody else's
    expect(anon.sent).toHaveLength(0)
  })

  test('a null/empty userId matches nobody (anon state stays local)', () => {
    const anon = sock(undefined)
    const store = storeWith(anon.ws)
    broadcastToUser(store, null, { type: 'dispatch_history' })
    expect(anon.sent).toHaveLength(0)
  })

  test('a dead socket does not sink the rest of the broadcast', () => {
    const dead = {
      data: { userName: 'jonas' },
      send: () => {
        throw new Error('dead')
      },
    } as unknown as ServerWebSocket<unknown>
    const live = sock('jonas')
    broadcastToUser(storeWith(dead, live.ws), 'jonas', { type: 'dispatch_history' })
    expect(live.sent).toHaveLength(1)
  })
})
