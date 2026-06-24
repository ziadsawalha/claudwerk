import { describe, expect, it } from 'bun:test'
import type { LiveStatus } from '../../../../shared/protocol'
import type { ConversationDigest } from '../gather/types'
import { renderStatusSection } from './render-status'

function conv(over: Partial<ConversationDigest> & { id: string }): ConversationDigest {
  return {
    id: over.id,
    title: over.title ?? 'A conversation',
    projectUri: 'claude://default/p',
    status: 'ended',
    createdAt: over.createdAt ?? 1000,
    updatedAt: over.updatedAt ?? 2000,
    turnCount: 3,
    rootConversationId: over.rootConversationId,
    liveStatus: over.liveStatus,
    liveStatusSuperseded: over.liveStatusSuperseded,
  }
}

function status(over: Partial<LiveStatus> = {}): LiveStatus {
  return { state: 'done', seq: 1, updatedAt: 2000, ...over }
}

describe('renderStatusSection', () => {
  it('returns empty string when no conversation carries a status (so the prompt omits it)', () => {
    expect(renderStatusSection([])).toBe('')
    expect(renderStatusSection([conv({ id: 'c1' })])).toBe('')
  })

  it('renders a standalone status with state + done detail, under the high-confidence header', () => {
    const out = renderStatusSection([
      conv({ id: 'abcd1234ef', title: 'Fix loop', liveStatus: status({ done: 'Fixed React #301 -> main 33fd2fcc' }) }),
    ])
    expect(out).toContain('HIGHEST-CONFIDENCE SIGNAL')
    expect(out).toContain('STANDALONE:')
    expect(out).toContain('abcd1234ef')
    expect(out).toContain('[done]')
    expect(out).toContain('done: Fixed React #301 -> main 33fd2fcc')
  })

  it('flags a superseded status and a safe-to-close one', () => {
    const out = renderStatusSection([
      conv({ id: 'sup1', liveStatus: status({ done: 'old claim' }), liveStatusSuperseded: true }),
      conv({ id: 'safe1', liveStatus: status({ safe_to_close: true, done: 'shipped' }) }),
    ])
    expect(out).toContain('SUPERSEDED')
    expect(out).toContain('safe-to-close')
  })

  it('groups conversations sharing a root into one CHAIN/LINEAGE block, oldest first', () => {
    const out = renderStatusSection([
      conv({
        id: 'link2',
        createdAt: 200,
        rootConversationId: 'root9999abcd',
        liveStatus: status({ done: 'phase 2' }),
      }),
      conv({
        id: 'link1',
        createdAt: 100,
        rootConversationId: 'root9999abcd',
        liveStatus: status({ done: 'phase 1' }),
      }),
    ])
    expect(out).toContain('CHAIN/LINEAGE root9999abcd (2 conversations')
    // oldest (link1) renders before link2
    expect(out.indexOf('link1')).toBeLessThan(out.indexOf('link2'))
    expect(out).not.toContain('STANDALONE')
  })

  it("treats a root that equals a conversation's own id as the same lineage bucket", () => {
    // originator (id == root for its children) + one child share a bucket
    const out = renderStatusSection([
      conv({ id: 'origin01', createdAt: 100, liveStatus: status({ done: 'handed to chain' }) }),
      conv({ id: 'child01', createdAt: 200, rootConversationId: 'origin01', liveStatus: status({ done: 'phase 1' }) }),
    ])
    expect(out).toContain('CHAIN/LINEAGE origin01 (2 conversations')
  })

  it('collapses multi-line status fields to one line and caps length', () => {
    const long = 'x'.repeat(400)
    const out = renderStatusSection([conv({ id: 'c1', liveStatus: status({ done: `line1\nline2\n${long}` }) })])
    expect(out).not.toContain('\n      done: line1\nline2')
    expect(out).toContain('…')
  })
})
