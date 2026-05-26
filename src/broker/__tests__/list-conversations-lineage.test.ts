/**
 * list_conversations lineage filters + tree format.
 *
 * Two surfaces:
 *  - The pure renderLineageTree() helper (forest of trees, filtered subsets,
 *    orphan parents as forest roots).
 *  - The MCP tool wiring uses the same conversation-store the broker uses --
 *    we exercise the filter shapes via the store + a hand-rolled filter call
 *    that mirrors the tool's logic. We don't spin up the MCP transport here;
 *    the deprecation noise on mcp.tool() makes that overkill for what's
 *    really three lines of filter logic.
 */

import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConversationStore } from '../conversation-store'
import { type LineageRow, renderLineageTree } from '../routes/mcp-server'
import { createSqliteDriver } from '../store/sqlite/driver'

function freshStore() {
  const dataDir = mkdtempSync(join(tmpdir(), 'list-conversations-lineage-'))
  return createSqliteDriver({ type: 'sqlite', dataDir })
}

function row(over: Partial<LineageRow> & Pick<LineageRow, 'conversationId'>): LineageRow {
  return {
    title: over.conversationId,
    status: 'active',
    agentHostType: 'claude',
    project: 'claude://default/proj',
    directChildCount: 0,
    ...over,
  }
}

describe('renderLineageTree', () => {
  it('returns a placeholder when no rows are provided', () => {
    expect(renderLineageTree([])).toBe('(no conversations)')
  })

  it('renders a single root with no children', () => {
    const out = renderLineageTree([row({ conversationId: 'conv-A', title: 'alpha' })])
    expect(out).toContain('conv-A')
    expect(out).toContain('alpha')
    // No branch glyphs for a lone root.
    expect(out).not.toContain('├──')
    expect(out).not.toContain('└──')
  })

  it('renders parent + children with box-drawing branches', () => {
    const rows: LineageRow[] = [
      row({ conversationId: 'conv-A', title: 'root', directChildCount: 2 }),
      row({ conversationId: 'conv-B', title: 'kid-1', parentConversationId: 'conv-A', rootConversationId: 'conv-A' }),
      row({ conversationId: 'conv-C', title: 'kid-2', parentConversationId: 'conv-A', rootConversationId: 'conv-A' }),
    ]
    const out = renderLineageTree(rows)
    expect(out).toContain('conv-A')
    expect(out).toContain('├── conv-B')
    expect(out).toContain('└── conv-C')
  })

  it('treats orphan parents (parent not in row set) as forest roots', () => {
    // conv-B's parent conv-A is filtered out -- conv-B should still surface
    // as a root so it's not lost.
    const rows: LineageRow[] = [
      row({ conversationId: 'conv-B', parentConversationId: 'conv-A', rootConversationId: 'conv-A' }),
    ]
    const out = renderLineageTree(rows)
    expect(out).toContain('conv-B')
    expect(out).not.toContain('├──')
  })

  it('renders nested grandchildren with continuation pipes', () => {
    const rows: LineageRow[] = [
      row({ conversationId: 'conv-A', title: 'root', directChildCount: 1 }),
      row({
        conversationId: 'conv-B',
        title: 'mid',
        parentConversationId: 'conv-A',
        rootConversationId: 'conv-A',
        directChildCount: 1,
      }),
      row({
        conversationId: 'conv-C',
        title: 'leaf',
        parentConversationId: 'conv-B',
        rootConversationId: 'conv-A',
      }),
    ]
    const out = renderLineageTree(rows)
    expect(out).toContain('conv-A')
    expect(out).toContain('└── conv-B')
    expect(out).toContain('    └── conv-C')
  })

  it('annotates roots whose children fell outside the filtered set', () => {
    // directChildCount comes from the unfiltered store; surface it so callers
    // know the row has descendants they didn't ask for.
    const rows: LineageRow[] = [row({ conversationId: 'conv-A', title: 'root', directChildCount: 3 })]
    expect(renderLineageTree(rows)).toContain('(+3 children)')
  })
})

describe('list_conversations lineage filter logic', () => {
  it('rootConversationId selects the conversation and every descendant', () => {
    const cs = createConversationStore({ store: freshStore() })
    cs.createConversation('conv-A', 'claude://default/proj')
    cs.createConversation('conv-B', 'claude://default/proj', undefined, [], [], {
      parentConversationId: 'conv-A',
      rootConversationId: 'conv-A',
    })
    cs.createConversation('conv-C', 'claude://default/proj', undefined, [], [], {
      parentConversationId: 'conv-B',
      rootConversationId: 'conv-A',
    })
    cs.createConversation('conv-X', 'claude://default/proj') // unrelated root

    const rootId = 'conv-A'
    const filtered = cs
      .getAllConversations()
      .filter(c => c.id === rootId || c.rootConversationId === rootId)
      .map(c => c.id)
      .sort()
    expect(filtered).toEqual(['conv-A', 'conv-B', 'conv-C'])
  })

  it('parentConversationId returns direct children only', () => {
    const cs = createConversationStore({ store: freshStore() })
    cs.createConversation('conv-A', 'claude://default/proj')
    cs.createConversation('conv-B', 'claude://default/proj', undefined, [], [], {
      parentConversationId: 'conv-A',
      rootConversationId: 'conv-A',
    })
    cs.createConversation('conv-C', 'claude://default/proj', undefined, [], [], {
      parentConversationId: 'conv-B', // grandchild -- must NOT show up
      rootConversationId: 'conv-A',
    })

    const parentId = 'conv-A'
    const filtered = cs
      .getAllConversations()
      .filter(c => c.parentConversationId === parentId)
      .map(c => c.id)
      .sort()
    expect(filtered).toEqual(['conv-B'])
  })
})
