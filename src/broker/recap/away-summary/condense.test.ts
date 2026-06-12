import { describe, expect, it } from 'bun:test'
import type { TranscriptEntry } from '../../../shared/protocol'
import { condenseTranscript } from './condense'
import { AWAY_SUMMARY_MAX_ENTRY_CHARS, AWAY_SUMMARY_MAX_RECENT_ENTRIES } from './prompt'

function user(text: string): TranscriptEntry {
  return {
    type: 'user',
    uuid: crypto.randomUUID(),
    timestamp: '2026-06-12T10:00:00Z',
    message: { role: 'user', content: text },
  } as TranscriptEntry
}

function assistant(text: string): TranscriptEntry {
  return {
    type: 'assistant',
    uuid: crypto.randomUUID(),
    timestamp: '2026-06-12T10:00:01Z',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  } as TranscriptEntry
}

describe('condenseTranscript intent anchoring', () => {
  it('adds INITIAL REQUEST when the opening ask scrolled out of the recent window', () => {
    const entries: TranscriptEntry[] = [user('please implement the frobnicator with full test coverage')]
    for (let i = 0; i < AWAY_SUMMARY_MAX_RECENT_ENTRIES + 5; i++) {
      entries.push(assistant(`working on step ${i}`))
    }
    entries.push(user('commit it'), assistant('Committed and pushed @abc123.'))

    const out = condenseTranscript({ entries })
    expect(out).toContain('INITIAL REQUEST')
    expect(out).toContain('implement the frobnicator')
  })

  it('omits INITIAL REQUEST when the opening ask is still inside the recent window', () => {
    const entries = [user('quick question about bun'), assistant('answer'), user('thanks'), assistant('np')]
    const out = condenseTranscript({ entries })
    expect(out).not.toContain('INITIAL REQUEST')
    expect(out).toContain('quick question about bun')
  })

  it('caps a single oversized entry so later entries still fit', () => {
    const entries = [
      user('start'),
      assistant('x'.repeat(20_000)),
      user('the question that matters'),
      assistant('the answer that matters'),
    ]
    const out = condenseTranscript({ entries })
    expect(out).toContain('the question that matters')
    expect(out).toContain('the answer that matters')
    expect(out?.length).toBeLessThan(AWAY_SUMMARY_MAX_ENTRY_CHARS + 4000)
  })

  it('returns null for an empty transcript', () => {
    expect(condenseTranscript({ entries: [] })).toBeNull()
  })
})
