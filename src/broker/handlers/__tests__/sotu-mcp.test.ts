import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SotuView } from '../../../shared/protocol'
import { initSotuStore, projectSlug } from '../../sotu'
import { recordContribution } from '../../sotu/contribute'
import { readQueue } from '../../sotu/queue'
import { registerSotuMcpHandlers } from '../sotu-mcp'
import {
  flushHandler as flush,
  HARNESS_PROJECT as PROJECT,
  runHandler as run,
  trustSettings as settings,
} from './sotu-harness'

// The Phase-5 read surfaces: get_state_of_union (lazy-regen-if-stale read) +
// sotu_contribute (belt-and-suspenders write through the same chokepoint). The
// engine is NOT started here, so maybeDistillOnRead is a no-op -- the read serves
// the FREE floor (chronicle files + live queue), which is exactly what we assert.

beforeAll(() => {
  registerSotuMcpHandlers()
})

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sotu-mcp-'))
  initSotuStore(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('get_state_of_union handler', () => {
  it('rejects a non-benevolent agent-host with a clean error + requestId', () => {
    const { replies } = run('get_state_of_union_request', { requestId: 'g-1' }, {}, settings('default'))
    expect(replies[0]).toMatchObject({ type: 'get_state_of_union_result', ok: false, requestId: 'g-1' })
    expect(replies[0].error).toBe('Requires benevolent trust level')
  })

  it('rejects when no project can be resolved', () => {
    const { replies } = run('get_state_of_union_request', { requestId: 'g-2' }, {}, settings('benevolent'))
    expect(replies[0]).toMatchObject({ type: 'get_state_of_union_result', ok: false, error: 'no resolvable project' })
  })

  it('serves the free-floor view for the caller project (claims + CONTENDED)', async () => {
    const slug = projectSlug(PROJECT)
    recordContribution(slug, {
      kind: 'callout',
      convId: 'conv-a',
      ts: 1000,
      type: 'lock',
      payload: 'editing',
      weight: 'high',
      target: { kind: 'claim', path: 'src/x.ts' },
    })
    recordContribution(slug, {
      kind: 'callout',
      convId: 'conv-b',
      ts: 2000,
      type: 'lock',
      payload: 'editing too',
      weight: 'high',
      target: { kind: 'claim', path: 'src/x.ts' },
    })
    const { replies } = run(
      'get_state_of_union_request',
      { requestId: 'g-3' },
      { conversationId: 'conv-a' },
      settings('benevolent'),
    )
    await flush()
    expect(replies).toHaveLength(1)
    const r = replies[0] as { ok: boolean; view: SotuView; requestId: string }
    expect(r).toMatchObject({ ok: true, requestId: 'g-3' })
    expect(r.view.project).toBe(PROJECT)
    expect(r.view.holds).toHaveLength(1)
    expect(r.view.holds[0]).toMatchObject({ target: 'src/x.ts', contended: true })
  })

  it('honors an explicit projectUri', async () => {
    const { replies } = run(
      'get_state_of_union_request',
      { requestId: 'g-4', projectUri: 'claude://host/other' },
      { conversationId: 'conv-a' },
      settings('benevolent'),
    )
    await flush()
    expect((replies[0] as { view: SotuView }).view.project).toBe('claude://host/other')
  })
})

describe('sotu_contribute handler', () => {
  it('rejects a non-benevolent agent-host', () => {
    const { replies } = run(
      'sotu_contribute_request',
      { requestId: 's-1', noteType: 'insight', payload: 'x' },
      { conversationId: 'conv-a' },
      settings('default'),
    )
    expect(replies[0]).toMatchObject({ type: 'sotu_contribute_result', ok: false, requestId: 's-1' })
  })

  it('rejects a missing/invalid noteType or payload', () => {
    const bad = run(
      'sotu_contribute_request',
      { requestId: 's-2', noteType: 'bogus', payload: 'x' },
      { conversationId: 'conv-a' },
      settings('benevolent'),
    )
    expect(bad.replies[0]).toMatchObject({ ok: false, error: 'sotu_contribute requires noteType + payload' })
  })

  it('records through the chokepoint + broadcasts + acks (with a claim target)', () => {
    const { replies, broadcasts } = run(
      'sotu_contribute_request',
      { requestId: 's-3', noteType: 'lock', payload: 'refactor', target: { kind: 'claim', path: 'src/y.ts' } },
      { conversationId: 'conv-a' },
      settings('benevolent'),
    )
    expect(replies[0]).toMatchObject({ type: 'sotu_contribute_result', ok: true, requestId: 's-3', pendingContribs: 3 })
    const q = readQueue(projectSlug(PROJECT))
    expect(q[0]).toMatchObject({
      kind: 'callout',
      type: 'lock',
      payload: 'refactor',
      target: { kind: 'claim', path: 'src/y.ts' },
    })
    expect(broadcasts[0].msg).toMatchObject({ type: 'sotu_contribution', latest: { kind: 'callout' } })
  })
})
