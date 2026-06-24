import { describe, expect, it } from 'bun:test'
import { layoutDiagram } from './diagram-layout'
import type { Scene } from './draw-dsl'

const scene: Scene = {
  v: 1,
  layout: 'flow',
  nodes: [
    { id: 'p', kind: 'box', title: 'Parent', variant: 'blue' },
    { id: 'a', kind: 'box', title: 'Child A', variant: 'gold' },
    { id: 'b', kind: 'box', title: 'Child B', variant: 'gold' },
    { id: 'z', kind: 'box', title: 'A much wider end box here', variant: 'green' },
  ],
  edges: [
    { from: 'p', to: 'a', text: 'go' },
    { from: 'p', to: 'b' },
    { from: 'a', to: 'z' },
    { from: 'b', to: 'z' },
  ],
}

const byId = (boxes: ReturnType<typeof layoutDiagram>['boxes'], id: string) => boxes.find(b => b.id === id)!

describe('layoutDiagram', () => {
  const { boxes, conns } = layoutDiagram(scene)
  const spine = (b: { x: number; w: number }): number => b.x + b.w / 2

  it('gives every single-box rank the same width, centred on one spine', () => {
    const p = byId(boxes, 'p')
    const z = byId(boxes, 'z')
    expect(p.w).toBe(z.w) // uniform width = widest natural box
    expect(spine(p)).toBeCloseTo(spine(z)) // same vertical axis
  })

  it('packs siblings to split the spine width and stay centred under it', () => {
    const a = byId(boxes, 'a')
    const b = byId(boxes, 'b')
    const p = byId(boxes, 'p')
    expect(a.w).toBeCloseTo(b.w)
    const mid = (Math.min(a.x, b.x) + Math.max(a.x + a.w, b.x + b.w)) / 2
    expect(mid).toBeCloseTo(spine(p))
  })

  it('classifies fan-out as a split (with label) and fan-in as a merge', () => {
    const split = conns.find(c => c.kind === 'split')
    expect(split?.kind).toBe('split')
    if (split?.kind === 'split') {
      expect(split.children).toHaveLength(2)
      expect(split.label).toBe('go')
    }
    const merge = conns.find(c => c.kind === 'merge')
    if (merge?.kind === 'merge') expect(merge.parents).toHaveLength(2)
  })
})
