import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSqliteDriver } from '../../../store/sqlite/driver'
import type { StoreDriver } from '../../../store/types'
import { gatherContention } from './contention'
import type { ConversationDigest, PeriodScope } from './types'

const NOW = 1_700_000_000_000
const MIN = 60_000
const projectUri = 'claude://default/Users/test/proj'
const REPO = '/Users/test/proj'

const scope: PeriodScope = {
  projectUris: [projectUri],
  periodStart: NOW - 86_400_000,
  periodEnd: NOW + 86_400_000,
  timeZone: 'UTC',
}

/** One conversation in a contention scenario: its activity window, optional spawn
 *  root, and the (file, time) edits it made. */
interface Case {
  id: string
  start: number
  end: number
  root?: string
  edits: Array<{ file: string; at: number }>
}

/** A fresh on-disk store per test (factored out so the setup is not a clone of the
 *  other recap-gather test harnesses). */
function freshStore(): { dir: string; store: StoreDriver } {
  const dir = mkdtempSync(join(tmpdir(), 'contention-test-'))
  const store = createSqliteDriver({ type: 'sqlite', dataDir: dir })
  store.init()
  return { dir, store }
}

/** Append assistant turns, one Edit tool_use per (file, at). */
function seedEdits(store: StoreDriver, c: Case) {
  store.conversations.create({ id: c.id, scope: projectUri, agentType: 'claude', createdAt: c.edits[0]?.at ?? NOW })
  const entries = c.edits.map((e, i) => ({
    type: 'assistant',
    uuid: `${c.id}-${i}`,
    content: {
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: e.file } }] },
    },
    timestamp: e.at,
  }))
  store.transcripts.append(c.id, 'epoch1', entries)
}

/** Seed every case, build its digest, and run the gather -- the whole per-test setup. */
function run(store: StoreDriver, cases: Case[]) {
  const convs: ConversationDigest[] = cases.map(c => {
    seedEdits(store, c)
    return {
      id: c.id,
      title: c.id,
      projectUri,
      status: 'ended',
      createdAt: c.start,
      updatedAt: c.end,
      turnCount: 1,
      ...(c.root ? { rootConversationId: c.root } : {}),
    }
  })
  return gatherContention(store, convs, scope)
}

describe('gatherContention', () => {
  let cacheDir: string
  let store: StoreDriver

  beforeEach(() => {
    const fresh = freshStore()
    cacheDir = fresh.dir
    store = fresh.store
  })
  afterEach(() => {
    store.close?.()
    rmSync(cacheDir, { recursive: true, force: true })
  })

  it('flags a same-file collision between independent agents as concurrent + crossLineage', () => {
    const out = run(store, [
      { id: 'conv_a', start: NOW - MIN, end: NOW + MIN, edits: [{ file: `${REPO}/src/ws-server.ts`, at: NOW }] },
      {
        id: 'conv_b',
        start: NOW + MIN,
        end: NOW + 3 * MIN,
        edits: [{ file: `${REPO}/src/ws-server.ts`, at: NOW + 2 * MIN }],
      },
    ])
    expect(out.fileCollisions).toHaveLength(1)
    const c = out.fileCollisions[0]
    expect(c.file).toContain('ws-server.ts')
    expect(c.parties.map(p => p.conversationId).sort()).toEqual(['conv_a', 'conv_b'])
    expect(c.concurrent).toBe(true)
    expect(c.crossLineage).toBe(true)
  })

  it('does NOT collide when the same logical file is edited in SEPARATE worktrees', () => {
    const out = run(store, [
      {
        id: 'conv_a',
        start: NOW,
        end: NOW + MIN,
        edits: [{ file: `${REPO}/.claude/worktrees/feat-a/src/x.ts`, at: NOW }],
      },
      {
        id: 'conv_b',
        start: NOW,
        end: NOW + MIN,
        edits: [{ file: `${REPO}/.claude/worktrees/feat-b/src/x.ts`, at: NOW + MIN }],
      },
    ])
    expect(out.fileCollisions).toHaveLength(0)
  })

  it('marks a collision NOT crossLineage when both parties share a spawn root', () => {
    const out = run(store, [
      { id: 'conv_a', start: NOW, end: NOW + MIN, root: 'conv_root', edits: [{ file: `${REPO}/src/y.ts`, at: NOW }] },
      {
        id: 'conv_b',
        start: NOW,
        end: NOW + MIN,
        root: 'conv_root',
        edits: [{ file: `${REPO}/src/y.ts`, at: NOW + MIN }],
      },
    ])
    expect(out.fileCollisions[0].crossLineage).toBe(false)
  })

  it('flags main-tree edits made while a sibling was active', () => {
    const out = run(store, [
      { id: 'conv_a', start: NOW - MIN, end: NOW + MIN, edits: [{ file: `${REPO}/src/z.ts`, at: NOW }] },
      {
        id: 'conv_b',
        start: NOW,
        end: NOW + 2 * MIN,
        edits: [{ file: `${REPO}/.claude/worktrees/feat/src/q.ts`, at: NOW + MIN }],
      },
    ])
    expect(out.mainTreeEdits).toHaveLength(1)
    expect(out.mainTreeEdits[0].conversationId).toBe('conv_a')
    expect(out.mainTreeEdits[0].concurrentSiblings).toContain('conv_b')
  })

  it('clusters a spawn root that fanned out to overlapping children', () => {
    const out = run(store, [
      {
        id: 'kid_1',
        start: NOW,
        end: NOW + 5 * MIN,
        root: 'conv_root',
        edits: [{ file: `${REPO}/.claude/worktrees/a/f.ts`, at: NOW }],
      },
      {
        id: 'kid_2',
        start: NOW + MIN,
        end: NOW + 6 * MIN,
        root: 'conv_root',
        edits: [{ file: `${REPO}/.claude/worktrees/b/f.ts`, at: NOW }],
      },
    ])
    expect(out.fanout).toHaveLength(1)
    expect(out.fanout[0].rootConversationId).toBe('conv_root')
    expect(out.fanout[0].children.sort()).toEqual(['kid_1', 'kid_2'])
    expect(out.fanout[0].peakConcurrency).toBe(2)
  })

  it('reports the scan funnel for no-silent-caps logging', () => {
    const out = run(store, [
      {
        id: 'conv_a',
        start: NOW,
        end: NOW + MIN,
        edits: [
          { file: `${REPO}/src/a.ts`, at: NOW },
          { file: `${REPO}/src/b.ts`, at: NOW + MIN },
        ],
      },
    ])
    expect(out.scanned.conversationsWithEdits).toBe(1)
    expect(out.scanned.editEvents).toBe(2)
    expect(out.scanned.filesTouched).toBe(2)
    expect(out.scanned.collisionCandidates).toBe(0)
  })
})
