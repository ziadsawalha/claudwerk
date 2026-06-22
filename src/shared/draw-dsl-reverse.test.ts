import { describe, expect, it } from 'bun:test'
import type { Scene } from './draw-dsl'
import { type RawElement, reverseScene } from './draw-dsl-reverse'

const base: Scene = {
  v: 1,
  nodes: [
    { id: 'a', kind: 'box', text: 'A' },
    { id: 'b', kind: 'box', text: 'B' },
  ],
}

// Baseline expand puts 'a' at (0,0) 160x60 and 'b' stacked below it.
function el(p: Partial<RawElement> & { id: string; type: string }): RawElement {
  return p
}

describe('reverseScene -- diff detection', () => {
  const elements: RawElement[] = [
    el({ id: 'a', type: 'rectangle', x: 50, y: 0, width: 160, height: 60, customData: { dslId: 'a', role: 'agent' } }),
    el({
      id: 'a-t',
      type: 'text',
      x: 10,
      y: 20,
      text: 'A2',
      containerId: 'a',
      customData: { dslId: 'a', role: 'agent' },
    }),
    el({
      id: 'b',
      type: 'rectangle',
      x: 0,
      y: 84,
      width: 200,
      height: 60,
      isDeleted: true,
      customData: { dslId: 'b', role: 'agent' },
    }),
    el({ id: 'note1', type: 'freedraw', x: 300, y: 300, width: 40, height: 12 }),
  ]
  const { scene, diff } = reverseScene(elements, base)

  it('detects a moved agent node', () => {
    expect(diff.moved.map(m => m.dslId)).toContain('a')
    expect(diff.moved.find(m => m.dslId === 'a')?.at).toEqual([50, 0])
  })

  it('detects a relabeled node from its bound text', () => {
    expect(diff.relabeled).toEqual([{ dslId: 'a', text: 'A2' }])
  })

  it('detects a removed (deleted) node', () => {
    expect(diff.removed).toContain('b')
  })

  it('treats a dsl-less element as the annotation layer', () => {
    expect(diff.added).toHaveLength(1)
    expect(diff.added[0]).toMatchObject({ id: 'note1', type: 'freedraw' })
  })

  it('surfaces an explicit customData.role on an annotation (forward-compat)', () => {
    const els: RawElement[] = [
      el({
        id: 'c1',
        type: 'text',
        x: 5,
        y: 5,
        width: 80,
        height: 20,
        text: 'fix this',
        customData: { role: 'comment' },
      }),
    ]
    const { diff } = reverseScene(els, base)
    expect(diff.added[0]).toMatchObject({ id: 'c1', text: 'fix this', role: 'comment' })
  })

  it('reconstructs the current scene as free-positioned nodes', () => {
    const a = scene.nodes.find(n => 'id' in n && n.id === 'a')
    expect(a).toMatchObject({ id: 'a', kind: 'box', at: [50, 0], text: 'A2' })
    // 'b' was deleted -> dropped from the reconstructed scene
    expect(scene.nodes.some(n => 'id' in n && n.id === 'b')).toBe(false)
    expect(scene.layout).toBe('free')
  })
})

describe('reverseScene -- resize', () => {
  it('flags a width/height change without a move', () => {
    const elements: RawElement[] = [
      el({ id: 'a', type: 'rectangle', x: 0, y: 0, width: 300, height: 60, customData: { dslId: 'a', role: 'agent' } }),
    ]
    const { diff } = reverseScene(elements, base)
    expect(diff.resized.map(r => r.dslId)).toContain('a')
    expect(diff.moved).toHaveLength(0)
  })
})

describe('reverseScene -- diagram-as-data round-trip', () => {
  it('reads customData.data back off a moved card item', () => {
    const dataBase: Scene = {
      v: 1,
      nodes: [{ id: 't1', kind: 'box', text: 'task', data: { taskId: 'x' } }],
    }
    const elements: RawElement[] = [
      el({
        id: 't1',
        type: 'rectangle',
        x: 400,
        y: 0,
        width: 160,
        height: 60,
        customData: { dslId: 't1', role: 'agent', data: { taskId: 'x' } },
      }),
    ]
    const { scene, diff } = reverseScene(elements, dataBase)
    expect(diff.moved.map(m => m.dslId)).toContain('t1')
    const t1 = scene.nodes.find(n => 'id' in n && n.id === 't1') as { data?: object }
    expect(t1.data).toEqual({ taskId: 'x' })
  })
})
