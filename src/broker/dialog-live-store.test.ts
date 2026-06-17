import { describe, expect, it } from 'bun:test'
import type { DialogSnapshot } from '../shared/dialog-live'
import {
  initialLiveSlot,
  MAX_EVENT_STATE_BYTES,
  MAX_SNAPSHOT_BYTES,
  mergeLiveSlot,
  withinEventStateCap,
  withinSnapshotCap,
} from './dialog-live-store'

const snap = (over: Partial<DialogSnapshot> = {}): DialogSnapshot => ({
  dialogId: 'd1',
  layout: { title: 't', body: [] },
  state: {},
  seq: 1,
  status: 'open',
  ...over,
})

describe('dialog-live-store', () => {
  it('initialLiveSlot mirrors the host register (seq 0 / open / empty state)', () => {
    const slot = initialLiveSlot('d1', { title: 'Live', body: [] }, 1000)
    expect(slot.snapshot).toEqual({
      dialogId: 'd1',
      layout: { title: 'Live', body: [] },
      state: {},
      seq: 0,
      status: 'open',
    })
    expect(slot.interactor).toBeUndefined()
    expect(slot.updatedAt).toBe(1000)
  })

  it('mergeLiveSlot preserves the interactor lock + event seq across same-dialog patches', () => {
    const prev = { dialogId: 'd1', snapshot: snap({ seq: 1 }), interactor: 'jonas', lastEventSeq: 3, updatedAt: 1 }
    const next = mergeLiveSlot(prev, snap({ seq: 2 }), 2)
    expect(next.snapshot.seq).toBe(2)
    expect(next.interactor).toBe('jonas')
    expect(next.lastEventSeq).toBe(3)
  })

  it('mergeLiveSlot resets the lock when a NEW dialogId replaces the slot', () => {
    const prev = { dialogId: 'd1', snapshot: snap(), interactor: 'jonas', lastEventSeq: 3, updatedAt: 1 }
    const next = mergeLiveSlot(prev, snap({ dialogId: 'd2' }), 2)
    expect(next.dialogId).toBe('d2')
    expect(next.interactor).toBeUndefined()
    expect(next.lastEventSeq).toBeUndefined()
  })

  it('enforces snapshot + event byte caps', () => {
    expect(withinSnapshotCap(snap())).toBe(true)
    expect(withinSnapshotCap({ blob: 'x'.repeat(MAX_SNAPSHOT_BYTES + 1) })).toBe(false)
    expect(withinEventStateCap({ a: 1 })).toBe(true)
    expect(withinEventStateCap({ blob: 'x'.repeat(MAX_EVENT_STATE_BYTES + 1) })).toBe(false)
  })
})
