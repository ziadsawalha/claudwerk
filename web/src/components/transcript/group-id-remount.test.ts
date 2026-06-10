/**
 * Regression test for the "Edit diffs re-render on every transcript row" bug.
 *
 * Root cause: the virtualizer keyed each group's wrapper <div> on the group's
 * TAIL entry seq (stableGroupKey). The active (last) group grows at its tail on
 * every streamed entry, so its key changed every tick -> React unmounted +
 * remounted the whole group subtree -> every DiffView/EditDiff was a FRESH mount
 * (useState reset, Shiki re-tokenize, EditDiff useMemo recompute). `memo` and
 * patchesEqual are powerless against a remount -- they guard a preserved
 * instance, not a new one.
 *
 * Fix: each group carries a stable `id` (assignGroupIds), reconciled across
 * regroups so it survives BOTH a tail-append AND a head-prune/prepend. The
 * virtualizer keys on that id, so the active group's subtree is reused.
 *
 * Two layers of coverage:
 *   1. assignGroupIds unit tests -- the reconciliation invariant in isolation.
 *   2. useIncrementalGroups renderHook tests -- proves the hook actually WIRES
 *      assignGroupIds in (the failure mode the old isolated memo test missed).
 */

import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { TranscriptEntry } from '@/lib/types'
import { assignGroupIds, type DisplayGroup, useIncrementalGroups } from './grouping'

// Build a DisplayGroup whose entries carry the given seqs. id optional.
function mkGroup(type: DisplayGroup['type'], seqs: number[], id?: string): DisplayGroup {
  return {
    type,
    timestamp: 't',
    entries: seqs.map(seq => ({ seq }) as unknown as TranscriptEntry),
    ...(id ? { id } : {}),
  }
}

describe('assignGroupIds reconciliation', () => {
  it('assigns deterministic ids when there is no prior (first pass)', () => {
    const groups = [mkGroup('assistant', [1, 2]), mkGroup('user', [3])]
    assignGroupIds(groups, null)
    expect(groups[0].id).toBe('assistant-s1')
    expect(groups[1].id).toBe('user-s3')
  })

  it('keeps a group id stable across a TAIL-APPEND (the streaming bug)', () => {
    const prev = [mkGroup('assistant', [1, 2])]
    assignGroupIds(prev, null)
    const prevId = prev[0].id
    // Active group grew at its tail (seq 3 appended). Fresh object, no id yet.
    const next = [mkGroup('assistant', [1, 2, 3])]
    assignGroupIds(next, prev)
    expect(next[0].id).toBe(prevId) // <- stable -> virtualizer key holds -> no remount
  })

  it('keeps a group id stable across a HEAD-PRUNE (capped conversation)', () => {
    // Prior: a boundary group + a tail group.
    const prev = [mkGroup('assistant', [1, 2]), mkGroup('user', [3]), mkGroup('assistant', [4, 5])]
    assignGroupIds(prev, null)
    const boundaryId = prev[0].id
    const tailId = prev[2].id
    // Head prune drops seq 1 (boundary group loses its head) AND a new entry 6
    // lands on the tail group. Both groups are freshly rebuilt (no id).
    const next = [mkGroup('assistant', [2]), mkGroup('user', [3]), mkGroup('assistant', [4, 5, 6])]
    assignGroupIds(next, prev)
    expect(next[0].id).toBe(boundaryId) // carried via shared entry s2 (last-resort lookup)
    expect(next[2].id).toBe(tailId) // carried via shared first entry s4
  })

  it('gives a genuinely new group a fresh, non-colliding id', () => {
    const prev = [mkGroup('assistant', [1, 2])]
    assignGroupIds(prev, null)
    const next = [mkGroup('assistant', [1, 2], prev[0].id), mkGroup('user', [3])]
    assignGroupIds(next, prev)
    expect(next[0].id).toBe(prev[0].id) // ref-preserved (already had id) -> kept
    expect(next[1].id).toBe('user-s3') // new
    expect(next[1].id).not.toBe(next[0].id)
  })

  it('does not collide when a prior group SPLITS into two', () => {
    const prev = [mkGroup('assistant', [1, 2, 3])]
    assignGroupIds(prev, null)
    const splitId = prev[0].id
    const next = [mkGroup('assistant', [1]), mkGroup('assistant', [2, 3])]
    assignGroupIds(next, prev)
    expect(next[0].id).toBe(splitId) // first claimant wins
    expect(next[1].id).not.toBe(splitId) // second derives its own
    expect(next[1].id).toBe('assistant-s2')
  })

  it('does not mutate a ref-preserved group that already carries an id', () => {
    const preserved = mkGroup('assistant', [1, 2], 'assistant-s1')
    assignGroupIds([preserved], null)
    expect(preserved.id).toBe('assistant-s1')
  })
})

// Minimal assistant/user entries that processEntry groups predictably.
function asst(seq: number, text: string): TranscriptEntry {
  return {
    type: 'assistant',
    timestamp: 't',
    seq,
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  } as unknown as TranscriptEntry
}
function usr(seq: number, text: string): TranscriptEntry {
  return {
    type: 'user',
    timestamp: 't',
    seq,
    message: { role: 'user', content: text },
  } as unknown as TranscriptEntry
}

describe('useIncrementalGroups wires stable group ids', () => {
  // cacheKey omitted -> per-instance cache, isolated per renderHook (no
  // module-cache pollution across tests).
  it('keeps every group id stable when a new entry appends to the active group', () => {
    const base = [asst(1, 'first turn'), usr(2, 'reply'), asst(3, 'second turn')]
    const { result, rerender } = renderHook(({ entries }) => useIncrementalGroups(entries), {
      initialProps: { entries: base },
    })
    const before = result.current.groups.map(g => g.id)
    expect(before).toHaveLength(3)
    expect(before.every(Boolean)).toBe(true)

    // seq 4 (another assistant entry) merges into the active group at its tail.
    rerender({ entries: [...base, asst(4, 'still working')] })
    const after = result.current.groups.map(g => g.id)
    expect(after).toEqual(before) // ALL ids stable -- including the active group's
  })

  it('assigns a fresh id to a genuinely new trailing group without disturbing prior ids', () => {
    const base = [asst(1, 'turn'), usr(2, 'reply')]
    const { result, rerender } = renderHook(({ entries }) => useIncrementalGroups(entries), {
      initialProps: { entries: base },
    })
    const before = result.current.groups.map(g => g.id)
    rerender({ entries: [...base, asst(3, 'new turn')] })
    const after = result.current.groups.map(g => g.id)
    expect(after.slice(0, before.length)).toEqual(before) // prior ids untouched
    expect(after).toHaveLength(before.length + 1)
    expect(new Set(after).size).toBe(after.length) // all unique
  })
})

describe('useIncrementalGroups backfill breaks (prepend anchor granularity)', () => {
  // Native anchorTo:'end' anchoring is ITEM-granular: a prepend that merges
  // into the reader's boundary group slides content under them uncompensated.
  // breakSeqs forces the boundary entry to start a NEW group so prepended
  // entries form separate items above. (2026-06-10 scroll-back-to-top bug.)
  it('splits at the boundary seq and keeps the boundary group id stable across a prepend', () => {
    const breaks = new Set<number>()
    const tail = [asst(100, 'boundary turn'), usr(101, 'reply'), asst(102, 'latest')]
    const { result, rerender } = renderHook(
      ({ entries, signal }) => useIncrementalGroups(entries, undefined, signal, breaks),
      { initialProps: { entries: tail, signal: 100 } },
    )
    const boundaryId = result.current.groups[0].id
    expect(result.current.groups).toHaveLength(3)

    // Backfill: register the break at the old top entry, prepend older
    // assistant entries that would otherwise MERGE into the boundary group,
    // and flip the reset signal (as the windowing does via regroupSignal).
    breaks.add(100)
    const prepended = [asst(98, 'older turn'), asst(99, 'older still'), ...tail]
    rerender({ entries: prepended, signal: 98 })

    const after = result.current.groups
    // The prepended assistant entries form their OWN group; the boundary
    // entry starts a fresh group below them (no merge across the break).
    expect(after[0].entries.map(e => (e as { seq?: number }).seq)).toEqual([98, 99])
    expect(after[1].entries[0]).toMatchObject({ seq: 100 })
    // Boundary group id carried (firstK match) -> virtualizer key stable ->
    // native anchor finds it and compensates by its start shift.
    expect(after[1].id).toBe(boundaryId)
  })

  it('without a break, the same prepend merges into the boundary group (the bug shape)', () => {
    const tail = [asst(100, 'boundary turn'), usr(101, 'reply')]
    const { result, rerender } = renderHook(
      ({ entries, signal }) => useIncrementalGroups(entries, undefined, signal, undefined),
      { initialProps: { entries: tail, signal: 100 } },
    )
    expect(result.current.groups).toHaveLength(2)
    rerender({ entries: [asst(98, 'older'), asst(99, 'older2'), ...tail], signal: 98 })
    // Documents the merge behavior the break exists to prevent.
    expect(result.current.groups[0].entries.map(e => (e as { seq?: number }).seq)).toEqual([98, 99, 100])
  })
})
