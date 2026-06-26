/**
 * Citation-grounding metric tests (Phase 6) -- the bard-lying detector.
 */

import { describe, expect, it } from 'bun:test'
import { scoreGrounding } from './grounding'
import { type Chronicle, type Contribution, emptyChronicle } from './types'

function chronicleCiting(nowIds: string[], doneIds: string[] = []): Chronicle {
  const c = emptyChronicle()
  c.now = nowIds.map(id => ({ convId: id, detail: `now ${id}`, ts: 1 }))
  c.justDone = doneIds.map(id => ({ convId: id, detail: `done ${id}`, ts: 1 }))
  return c
}

function digest(convId: string): Contribution {
  return { kind: 'turn_digest', convId, ts: 1, intent: 'work' }
}

describe('scoreGrounding', () => {
  it('perfect grounding when every cited conv is in the input', () => {
    const chronicle = chronicleCiting(['a', 'b'])
    const live = [digest('a'), digest('b')]
    const g = scoreGrounding(chronicle, live)
    expect(g.precision).toBe(1)
    expect(g.coverage).toBe(1)
    expect(g.unknownCited).toBe(0)
    expect(g.citedConvs).toBe(2)
    expect(g.knownConvs).toBe(2)
  })

  it('flags a hallucinated/stale citation (cited but not in input)', () => {
    const chronicle = chronicleCiting(['a', 'ghost'])
    const live = [digest('a')]
    const g = scoreGrounding(chronicle, live)
    expect(g.unknownCited).toBe(1)
    expect(g.precision).toBe(0.5) // (2 - 1) / 2
    expect(g.coverage).toBe(1) // the one known conv (a) is cited
  })

  it('coverage drops when the chronicle omits input conversations', () => {
    const chronicle = chronicleCiting(['a'])
    const live = [digest('a'), digest('b'), digest('c'), digest('d')]
    const g = scoreGrounding(chronicle, live)
    expect(g.precision).toBe(1) // a is real -> no lies
    expect(g.coverage).toBe(0.25) // 1 of 4 known convs cited
    expect(g.knownConvs).toBe(4)
  })

  it('dedupes across now + justDone and ignores empty convIds', () => {
    const chronicle = chronicleCiting(['a', 'a', ''], ['a', 'b'])
    const live = [
      digest('a'),
      digest('b'),
      { kind: 'git_scan', convId: '', ts: 1, git: { branches: [], scannedAt: 1 } },
    ]
    const g = scoreGrounding(chronicle, live as Contribution[])
    expect(g.citedConvs).toBe(2) // a, b -- empty dropped, dups collapsed
    expect(g.knownConvs).toBe(2) // a, b -- git_scan empty convId dropped
    expect(g.unknownCited).toBe(0)
  })

  it('empty chronicle + empty input reads as perfectly grounded', () => {
    const g = scoreGrounding(emptyChronicle(), [])
    expect(g.precision).toBe(1)
    expect(g.coverage).toBe(1)
    expect(g.citedConvs).toBe(0)
    expect(g.knownConvs).toBe(0)
  })

  it('a chronicle citing nothing over a busy queue has full precision, zero coverage', () => {
    const g = scoreGrounding(emptyChronicle(), [digest('a'), digest('b')])
    expect(g.precision).toBe(1) // cites nothing -> cannot lie
    expect(g.coverage).toBe(0) // accounts for none of the input
  })
})
