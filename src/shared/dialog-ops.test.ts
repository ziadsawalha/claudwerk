import { describe, expect, test } from 'bun:test'
import type { DialogOp, DialogSnapshot } from './dialog-live'
import { applyDialogOps, validateDialogOps } from './dialog-ops'

function snap(overrides: Partial<DialogSnapshot> = {}): DialogSnapshot {
  return {
    dialogId: 'd1',
    seq: 3,
    status: 'open',
    state: { name: 'ada' },
    layout: {
      title: 'T',
      body: [
        { type: 'Markdown', id: 'intro', content: 'hi' },
        { type: 'Group', id: 'box', label: 'g', children: [{ type: 'Markdown', id: 'inner', content: 'x' }] },
      ],
    },
    ...overrides,
  } as DialogSnapshot
}

describe('validateDialogOps', () => {
  test('rejects non-array / empty', () => {
    expect(validateDialogOps('nope').length).toBeGreaterThan(0)
    expect(validateDialogOps([]).length).toBeGreaterThan(0)
  })

  test('accepts a well-formed op list', () => {
    const ops: DialogOp[] = [
      { op: 'replace', id: 'intro', block: { type: 'Markdown', id: 'intro', content: 'bye' } },
      { op: 'setState', key: 'name', value: 'grace' },
      { op: 'remove', id: 'inner' },
      { op: 'busy', pending: true },
      { op: 'close' },
    ]
    expect(validateDialogOps(ops)).toEqual([])
  })

  test('flags missing fields + unknown op + after/into clash', () => {
    const errs = validateDialogOps([
      { op: 'replace', block: { type: 'Markdown' } },
      { op: 'append', block: { type: 'Markdown' }, after: 'a', into: 'b' },
      { op: 'setState' },
      { op: 'busy' },
      { op: 'frobnicate' },
    ] as unknown)
    expect(errs.length).toBe(5)
  })
})

describe('applyDialogOps', () => {
  test('does not mutate the input snapshot', () => {
    const s = snap()
    applyDialogOps(s, [{ op: 'replace', id: 'intro', block: { type: 'Markdown', id: 'intro', content: 'new' } }])
    expect((s.layout.body?.[0] as { content: string }).content).toBe('hi')
    expect(s.state.name).toBe('ada')
  })

  test('replace / remove / append (root + nested + into)', () => {
    const r = applyDialogOps(snap(), [
      { op: 'replace', id: 'intro', block: { type: 'Markdown', id: 'intro', content: 'new' } },
      { op: 'append', after: 'intro', block: { type: 'Divider', id: 'd' } },
      { op: 'append', into: 'box', block: { type: 'Markdown', id: 'inner2', content: 'y' } },
      { op: 'remove', id: 'inner' },
    ])
    expect(r.applied).toBe(4)
    expect(r.conflicts).toEqual([])
    const body = r.layout.body as Array<{ type: string; id: string; children?: unknown[] }>
    expect(body.map(b => b.id)).toEqual(['intro', 'd', 'box'])
    expect((body[0] as unknown as { content: string }).content).toBe('new')
    const box = body[2]
    expect((box.children as Array<{ id: string }>).map(c => c.id)).toEqual(['inner2'])
  })

  test('missing target ids become conflicts, not silent drops', () => {
    const r = applyDialogOps(snap(), [
      { op: 'replace', id: 'ghost', block: { type: 'Markdown', id: 'ghost', content: 'z' } },
      { op: 'append', into: 'nope', block: { type: 'Divider', id: 'd' } },
    ])
    expect(r.applied).toBe(0)
    expect(r.conflicts.length).toBe(2)
  })

  test('setState compare-and-swap: applies on match, conflicts on mismatch', () => {
    const ok = applyDialogOps(snap(), [{ op: 'setState', key: 'name', value: 'grace', expect: 'ada' }])
    expect(ok.state.name).toBe('grace')
    expect(ok.conflicts).toEqual([])

    const bad = applyDialogOps(snap(), [{ op: 'setState', key: 'name', value: 'grace', expect: 'lin' }])
    expect(bad.state.name).toBe('ada')
    expect(bad.conflicts.length).toBe(1)
  })

  test('unsetState removes key; close flips status', () => {
    const r = applyDialogOps(snap(), [{ op: 'unsetState', key: 'name' }, { op: 'close' }])
    expect('name' in r.state).toBe(false)
    expect(r.status).toBe('closed')
  })
})
