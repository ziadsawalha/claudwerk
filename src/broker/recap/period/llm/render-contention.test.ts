import { describe, expect, it } from 'bun:test'
import type { ContentionDigest } from '../gather/contention-types'
import { renderContentionSection } from './render-contention'

const empty: ContentionDigest = {
  fileCollisions: [],
  mainTreeEdits: [],
  fanout: [],
  scanned: { conversationsWithEdits: 0, editEvents: 0, filesTouched: 0, collisionCandidates: 0 },
}

describe('renderContentionSection', () => {
  it('returns "" when absent or empty (so the caller omits the block)', () => {
    expect(renderContentionSection(undefined)).toBe('')
    expect(renderContentionSection(empty)).toBe('')
  })

  it('renders a same-file collision with concurrent + independent-agents flags', () => {
    const out = renderContentionSection({
      ...empty,
      fileCollisions: [
        {
          file: 'src/ws-server.ts',
          concurrent: true,
          crossLineage: true,
          parties: [
            { conversationId: 'conv_aaaa1111', firstEditAt: 1, lastEditAt: 2, editCount: 3, inWorktree: false },
            { conversationId: 'conv_bbbb2222', firstEditAt: 2, lastEditAt: 4, editCount: 1, inWorktree: false },
          ],
        },
      ],
    })
    expect(out).toContain('CONTENTION')
    expect(out).toContain('SAME-FILE COLLISIONS (1)')
    expect(out).toContain('src/ws-server.ts')
    expect(out).toContain('CONCURRENT + INDEPENDENT-AGENTS')
    expect(out).toContain('(main) x3')
  })

  it('renders main-tree and fan-out sections', () => {
    const out = renderContentionSection({
      ...empty,
      mainTreeEdits: [
        {
          conversationId: 'conv_cccc3333',
          projectUri: 'claude://default/x',
          mainTreeEditCount: 5,
          concurrentSiblings: ['conv_dddd4444'],
        },
      ],
      fanout: [
        { rootConversationId: 'conv_root0000', children: ['conv_k1', 'conv_k2', 'conv_k3'], peakConcurrency: 3 },
      ],
    })
    expect(out).toContain('MAIN-TREE EDITS WHILE BUSY (1)')
    expect(out).toContain('5 edit(s) OUTSIDE any worktree')
    expect(out).toContain('SPAWN FAN-OUT (1)')
    expect(out).toContain('peak 3 active at once')
  })
})
