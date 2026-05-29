import { describe, expect, it } from 'bun:test'
import { isRecapInFlight, isRecapResumable, isRecapTerminal, type RecapStatus } from './protocol'

describe('recap status classification', () => {
  it('terminal = done/partial/failed/cancelled (NOT interrupted)', () => {
    const terminal: RecapStatus[] = ['done', 'partial', 'failed', 'cancelled']
    for (const s of terminal) expect(isRecapTerminal(s)).toBe(true)
    for (const s of ['queued', 'gathering', 'rendering', 'interrupted'] as RecapStatus[]) {
      expect(isRecapTerminal(s)).toBe(false)
    }
  })

  it('in-flight = queued/gathering/rendering (boot-sweep targets)', () => {
    for (const s of ['queued', 'gathering', 'rendering'] as RecapStatus[]) expect(isRecapInFlight(s)).toBe(true)
    for (const s of ['done', 'partial', 'failed', 'interrupted', 'cancelled'] as RecapStatus[]) {
      expect(isRecapInFlight(s)).toBe(false)
    }
  })

  it('resumable = interrupted only', () => {
    expect(isRecapResumable('interrupted')).toBe(true)
    for (const s of ['queued', 'gathering', 'rendering', 'done', 'partial', 'failed', 'cancelled'] as RecapStatus[]) {
      expect(isRecapResumable(s)).toBe(false)
    }
  })

  it('a status is never both in-flight and terminal', () => {
    const all: RecapStatus[] = [
      'queued',
      'gathering',
      'rendering',
      'done',
      'partial',
      'failed',
      'interrupted',
      'cancelled',
    ]
    for (const s of all) expect(isRecapInFlight(s) && isRecapTerminal(s)).toBe(false)
  })
})
