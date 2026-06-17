import { describe, expect, test } from 'bun:test'
import type { DialogLayout } from '../../shared/dialog-schema'
import { OpenDialogRegistry } from './open-dialogs'

function layout(): DialogLayout {
  return { title: 'T', persistent: true, body: [{ type: 'Markdown', id: 'm', content: 'hi' }] }
}

describe('OpenDialogRegistry', () => {
  test('register seeds seq 0 / open', () => {
    const r = new OpenDialogRegistry()
    const s = r.register('d1', layout(), { k: 1 })
    expect(s.seq).toBe(0)
    expect(s.status).toBe('open')
    expect(s.state.k).toBe(1)
    expect(r.has('d1')).toBe(true)
  })

  test('applyOps bumps seq, reports conflicts, rejects unknown/stale/closed', () => {
    const r = new OpenDialogRegistry()
    r.register('d1', layout())

    const ok = r.applyOps('d1', [{ op: 'setState', key: 'k', value: 2 }])
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.snapshot.seq).toBe(1)

    const conflict = r.applyOps('d1', [{ op: 'replace', id: 'ghost', block: { type: 'Markdown', id: 'ghost' } }])
    expect(conflict.ok).toBe(true)
    if (conflict.ok) expect(conflict.conflicts.length).toBe(1)

    expect(r.applyOps('nope', [{ op: 'close' }])).toEqual({ ok: false, reason: 'unknown' })

    const stale = r.applyOps('d1', [{ op: 'setState', key: 'k', value: 3 }], 0)
    expect(stale).toMatchObject({ ok: false, reason: 'stale', currentSeq: 2 })
  })

  test('close → reopen lifecycle; closed cannot patch', () => {
    const r = new OpenDialogRegistry()
    r.register('d1', layout())

    const closed = r.close('d1')
    expect(closed.ok).toBe(true)
    if (closed.ok) expect(closed.snapshot.status).toBe('closed')

    expect(r.applyOps('d1', [{ op: 'setState', key: 'k', value: 9 }])).toMatchObject({ ok: false, reason: 'closed' })
    expect(r.close('d1')).toMatchObject({ ok: false, reason: 'closed' })

    const reopened = r.reopen('d1')
    expect(reopened.ok).toBe(true)
    if (reopened.ok) expect(reopened.snapshot.status).toBe('open')
    expect(r.reopen('d1')).toMatchObject({ ok: false, reason: 'open' })
  })

  test('orphan removes from host tracking and returns a record', () => {
    const r = new OpenDialogRegistry()
    r.register('d1', layout())
    const orphaned = r.orphan('d1')
    expect(orphaned?.status).toBe('orphaned')
    expect(r.has('d1')).toBe(false)
    expect(r.orphan('d1')).toBeUndefined()
  })

  test('openSnapshots excludes closed', () => {
    const r = new OpenDialogRegistry()
    r.register('a', layout())
    r.register('b', layout())
    r.close('b')
    expect(r.openSnapshots().map(s => s.dialogId)).toEqual(['a'])
  })
})
