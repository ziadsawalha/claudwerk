import { describe, expect, it } from 'vitest'
import type { Conversation } from '@/lib/types'
import { layoutCanvas, NODE_H, NODE_W } from './layout'

// layoutCanvas only reads id / project / status / lastActivity / stats /
// parentConversationId (+ label fields), so a tiny partial cast keeps the
// fixtures legible -- same convention as lineage.test.ts.
function conv(id: string, project: string, parentConversationId?: string, status = 'idle'): Conversation {
  return { id, project, parentConversationId, status, lastActivity: 1000, startedAt: 1 } as unknown as Conversation
}

const NOW = 2000

interface Rect {
  position: { x: number; y: number }
  width?: number
  height?: number
}

function rectsOverlap(s: Rect, t: Rect): boolean {
  const overlapX = s.position.x < t.position.x + (t.width ?? 0) && t.position.x < s.position.x + (s.width ?? 0)
  const overlapY = s.position.y < t.position.y + (t.height ?? 0) && t.position.y < s.position.y + (s.height ?? 0)
  return overlapX && overlapY
}

describe('layoutCanvas', () => {
  it('emits one project space per project plus one card per conversation', () => {
    const { nodes } = layoutCanvas(
      [conv('a', 'claude:///p1'), conv('b', 'claude:///p1'), conv('c', 'claude:///p2')],
      null,
      NOW,
    )
    const spaces = nodes.filter(n => n.type === 'projectSpace')
    const cards = nodes.filter(n => n.type === 'conversation')
    expect(spaces.map(s => s.id).sort()).toEqual(['space:claude:///p1', 'space:claude:///p2'])
    expect(cards).toHaveLength(3)
  })

  it('contains every card inside its project space rect', () => {
    const { nodes } = layoutCanvas([conv('a', 'claude:///p1'), conv('b', 'claude:///p1', 'a')], null, NOW)
    const space = nodes.find(n => n.id === 'space:claude:///p1')
    if (!space) throw new Error('space missing')
    for (const card of nodes.filter(n => n.type === 'conversation')) {
      expect(card.position.x).toBeGreaterThanOrEqual(space.position.x)
      expect(card.position.y).toBeGreaterThanOrEqual(space.position.y)
      expect(card.position.x + NODE_W).toBeLessThanOrEqual(space.position.x + (space.width ?? 0))
      expect(card.position.y + NODE_H).toBeLessThanOrEqual(space.position.y + (space.height ?? 0))
    }
  })

  it('draws spawn edges, dashed when crossing project spaces', () => {
    const { edges } = layoutCanvas(
      [conv('root', 'claude:///p1'), conv('kid', 'claude:///p1', 'root'), conv('far', 'claude:///p2', 'root')],
      null,
      NOW,
    )
    expect(edges.map(e => e.id).sort()).toEqual(['root->far', 'root->kid'])
    const within = edges.find(e => e.id === 'root->kid')
    const across = edges.find(e => e.id === 'root->far')
    expect(within?.style?.strokeDasharray).toBeUndefined()
    expect(across?.style?.strokeDasharray).toBe('6 5')
  })

  it('skips edges whose parent is not on the canvas', () => {
    const { edges } = layoutCanvas([conv('kid', 'claude:///p1', 'gone-parent')], null, NOW)
    expect(edges).toEqual([])
  })

  it('keeps project spaces from overlapping', () => {
    const list = [
      ...Array.from({ length: 6 }, (_, i) => conv(`a${i}`, 'claude:///p1')),
      ...Array.from({ length: 4 }, (_, i) => conv(`b${i}`, 'claude:///p2')),
      conv('c0', 'claude:///p3'),
    ]
    const { nodes } = layoutCanvas(list, null, NOW)
    const spaces = nodes.filter(n => n.type === 'projectSpace')
    const pairs = spaces.flatMap(s => spaces.filter(t => t.id !== s.id).map(t => [s, t] as const))
    for (const [s, t] of pairs) {
      expect(rectsOverlap(s, t)).toBe(false)
    }
  })

  it('marks the selected conversation', () => {
    const { nodes } = layoutCanvas([conv('a', 'claude:///p1'), conv('b', 'claude:///p1')], 'b', NOW)
    expect(nodes.find(n => n.id === 'b')?.selected).toBe(true)
    expect(nodes.find(n => n.id === 'a')?.selected).toBe(false)
  })
})
