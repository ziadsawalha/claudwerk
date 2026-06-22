/**
 * LIVE classifier test -- exercises the REAL Haiku LLM decision path via
 * OpenRouter. Opt-in (costs ~$0.0002/call): gated on DESK_LIVE_TEST so CI never
 * spends. Run with:
 *   DESK_LIVE_TEST=1 OPENROUTER_API_KEY=... bun test src/broker/desk/classify.live.test.ts
 */

import { describe, expect, it } from 'bun:test'
import { chat } from '../recap/shared/openrouter-client'
import { classifyDispatch, type DispatchRosterEntry } from './classify'

const live = process.env.DESK_LIVE_TEST ? describe : describe.skip

const roster: DispatchRosterEntry[] = [
  {
    conversationId: 'conv_mic',
    project: 'remote-claude',
    title: 'mic ducking bug fix',
    idleMs: 90_000,
    contextTokens: 35_000,
  },
  {
    conversationId: 'conv_recap',
    project: 'remote-claude',
    title: 'recap chunking',
    idleMs: 600_000,
    contextTokens: 60_000,
  },
  { conversationId: 'conv_yem', project: 'yemaya', title: 'AGM board prep', idleMs: 7_200_000, contextTokens: 20_000 },
  {
    conversationId: 'conv_dead',
    project: 'remote-claude',
    title: 'old auth refactor',
    ended: true,
    contextTokens: 120_000,
  },
]

live('classifyDispatch LIVE (Haiku)', () => {
  it('routes a clear continuation into the matching live conversation', async () => {
    const r = await classifyDispatch({ intent: 'the mic is still ducking the music, can you look again', roster }, chat)
    console.log(
      '[live] mic intent ->',
      JSON.stringify({ d: r.disposition, t: r.target, c: r.confidence, why: r.reasoning }),
    )
    expect(['route', 'ask']).toContain(r.disposition)
    if (r.disposition === 'route') expect(r.target).toBe('conv_mic')
  }, 30_000)

  it('spawns new for an unrelated fresh topic', async () => {
    const r = await classifyDispatch({ intent: 'set up a brand new marketing landing page from scratch', roster }, chat)
    console.log(
      '[live] new-topic ->',
      JSON.stringify({ d: r.disposition, t: r.target, c: r.confidence, why: r.reasoning }),
    )
    expect(['new', 'ask']).toContain(r.disposition)
  }, 30_000)

  it('revives when the intent points at the ended conversation', async () => {
    const r = await classifyDispatch({ intent: 'pick the old auth refactor back up where we left off', roster }, chat)
    console.log(
      '[live] revive ->',
      JSON.stringify({ d: r.disposition, t: r.target, c: r.confidence, why: r.reasoning }),
    )
    expect(['revive', 'ask']).toContain(r.disposition)
  }, 30_000)
})
