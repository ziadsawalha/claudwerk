import { describe, expect, test } from 'bun:test'
import { DISPATCH_RECENCY_HALF_LIFE_MS } from './decay'
import { activeContextRows, composeProjectsOverview, type OverviewConv, type ProjectLike } from './overview'

const P = (key: string, label: string): ProjectLike => ({ key, label, projectUri: `claude://d/${label}` })
const conv = (projectKey: string, over: Partial<OverviewConv> = {}): OverviewConv => ({
  projectKey,
  ended: false,
  ...over,
})

describe('composeProjectsOverview', () => {
  const projects = [P('ka', 'arr'), P('kb', 'remote'), P('kc', 'idle-proj')]
  const briefs = new Map([
    ['ka', 'arr is a media indexer'],
    ['kb', 'remote is the broker'],
  ])

  test('includes projects with zero live conversations (the arr-with-nothing case)', () => {
    const rows = composeProjectsOverview(projects, briefs, [], 1000)
    expect(rows.map(r => r.project).sort()).toEqual(['arr', 'idle-proj', 'remote'])
    const idle = rows.find(r => r.project === 'idle-proj')
    expect(idle?.live).toBe(0)
    expect(idle?.brief).toBe('')
  })

  test('counts live / working / needs-you per project, ignoring ended', () => {
    const convs = [
      conv('ka', { liveState: 'working' }),
      conv('ka', { liveState: 'needs_you' }),
      conv('ka', { ended: true }),
      conv('kb', { liveState: 'blocked' }),
    ]
    const rows = composeProjectsOverview(projects, briefs, convs, 1000)
    const arr = rows.find(r => r.project === 'arr')
    expect(arr).toMatchObject({ live: 2, working: 1, needsYou: 1 })
    const remote = rows.find(r => r.project === 'remote')
    expect(remote).toMatchObject({ live: 1, needsYou: 1 }) // blocked counts as needs-you
  })

  test('orders attention-first, then by liveness, then recency', () => {
    const now = 1_000_000
    const convs = [
      conv('kb', { liveState: 'needs_you' }),
      conv('ka', { liveState: 'working', lastActivity: now - 60000 }),
    ]
    const rows = composeProjectsOverview(projects, briefs, convs, now)
    expect(rows[0].project).toBe('remote') // needs-you wins
    expect(rows[1].project).toBe('arr')
  })

  test('derives idleMin from the most recent activity', () => {
    const now = 1_000_000
    const rows = composeProjectsOverview([P('ka', 'arr')], briefs, [conv('ka', { lastActivity: now - 120000 })], now)
    expect(rows[0].idleMin).toBe(2)
  })

  test('conversations with no project key are skipped', () => {
    const rows = composeProjectsOverview([P('ka', 'arr')], briefs, [{ projectKey: null, ended: false }], 1000)
    expect(rows[0].live).toBe(0)
  })

  test('quiet projects order by DECAYED brief recency (recent vivid, stale fading)', () => {
    const now = 100 * DISPATCH_RECENCY_HALF_LIFE_MS
    const recencyByKey = new Map([
      ['ka', now - 5 * DISPATCH_RECENCY_HALF_LIFE_MS], // arr: stale
      ['kb', now - 0.5 * DISPATCH_RECENCY_HALF_LIFE_MS], // remote: recent
    ])
    const rows = composeProjectsOverview(projects, briefs, [], now, recencyByKey)
    expect(rows[0].project).toBe('remote') // freshest brief wins
    expect(rows[0].recencyWeight).toBeGreaterThan(rows[1].recencyWeight)
    expect(rows.find(r => r.project === 'idle-proj')?.recencyWeight).toBe(0) // never seen
  })

  test('a live conversation takes recency over a stale brief (max of the two)', () => {
    const now = 100 * DISPATCH_RECENCY_HALF_LIFE_MS
    const recencyByKey = new Map([['ka', now - 10 * DISPATCH_RECENCY_HALF_LIFE_MS]]) // ancient brief
    const rows = composeProjectsOverview([P('ka', 'arr')], briefs, [conv('ka', { lastActivity: now })], now)
    // No recencyByKey passed here -> live activity (now) drives it -> weight 1.
    expect(rows[0].recencyWeight).toBe(1)
    // And with the ancient brief present, the live max still wins.
    const rows2 = composeProjectsOverview(
      [P('ka', 'arr')],
      briefs,
      [conv('ka', { lastActivity: now })],
      now,
      recencyByKey,
    )
    expect(rows2[0].recencyWeight).toBe(1)
  })
})

describe('activeContextRows', () => {
  const now = 100 * DISPATCH_RECENCY_HALF_LIFE_MS
  const projects = [P('ka', 'fresh'), P('kb', 'stale'), P('kc', 'busy')]

  test('prunes stale QUIET projects below the floor, keeps fresh + live ones', () => {
    const recencyByKey = new Map([
      ['ka', now - 1 * DISPATCH_RECENCY_HALF_LIFE_MS], // fresh quiet (weight 0.5, kept)
      ['kb', now - 8 * DISPATCH_RECENCY_HALF_LIFE_MS], // stale quiet (~0.004, pruned)
    ])
    const convs = [conv('kc', { liveState: 'working', lastActivity: now })] // busy is live -> always kept
    const rows = composeProjectsOverview(projects, new Map(), convs, now, recencyByKey)
    const active = activeContextRows(rows).map(r => r.project)
    expect(active).toContain('fresh')
    expect(active).toContain('busy')
    expect(active).not.toContain('stale')
  })

  test('never prunes a live or needs-you project even with an ancient brief', () => {
    const recencyByKey = new Map([['kb', now - 50 * DISPATCH_RECENCY_HALF_LIFE_MS]])
    const convs = [conv('kb', { liveState: 'needs_you', lastActivity: now - 50 * DISPATCH_RECENCY_HALF_LIFE_MS })]
    const rows = composeProjectsOverview([P('kb', 'stale')], new Map(), convs, now, recencyByKey)
    expect(activeContextRows(rows).map(r => r.project)).toEqual(['stale'])
  })
})
