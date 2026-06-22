import { describe, expect, test } from 'bun:test'
import { assembleContext } from './context-assembly'
import type { ProjectOverviewRow } from './overview'

function row(over: Partial<ProjectOverviewRow> & { project: string }): ProjectOverviewRow {
  return { projectUri: `claude://d/${over.project}`, brief: '', live: 0, working: 0, needsYou: 0, ...over }
}

describe('assembleContext', () => {
  test('renders the universe (fleet by project) with counts', () => {
    const ctx = assembleContext({
      rows: [row({ project: 'arr', live: 2, working: 1, needsYou: 1, idleMin: 3 })],
      durableMemory: '',
      recent: [],
    })
    expect(ctx).toContain('FLEET (by project):')
    expect(ctx).toContain('- arr: 2 live, 1 working, 1 needs-you, idle 3m')
  })

  test('includes condensed project briefs as the MEMORY layer', () => {
    const ctx = assembleContext({
      rows: [row({ project: 'arr', brief: 'arr is a media indexer' })],
      durableMemory: '',
      recent: [],
    })
    expect(ctx).toContain('PROJECT MEMORY (condensed):')
    expect(ctx).toContain('## arr')
    expect(ctx).toContain('arr is a media indexer')
  })

  test('an idle project that exists only in memory shows in the universe', () => {
    const ctx = assembleContext({ rows: [row({ project: 'arr', brief: 'past work' })], durableMemory: '', recent: [] })
    expect(ctx).toContain('- arr: idle (in memory)')
  })

  test('includes durable notes and the recent session window', () => {
    const ctx = assembleContext({
      rows: [],
      durableMemory: '- user prefers Haiku',
      recent: [{ ts: 1, intent: 'what is going on', reply: 'two projects are live' }],
    })
    expect(ctx).toContain('DURABLE NOTES:')
    expect(ctx).toContain('user prefers Haiku')
    expect(ctx).toContain('RECENT (this session):')
    expect(ctx).toContain('you: what is going on')
    expect(ctx).toContain('desk: two projects are live')
  })

  test('token budget keeps the highest-priority briefs and notes the dropped count', () => {
    const brief = 'x'.repeat(300)
    const rows = Array.from({ length: 10 }, (_, i) => row({ project: `p${i}`, live: 1, brief }))
    const ctx = assembleContext({ rows, durableMemory: '', recent: [], tokenBudget: 300 }) // ~1200 chars
    expect(ctx).toMatch(/\+\d+ more projects? in memory/)
    const kept = (ctx.match(/## p\d/g) ?? []).length
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(10)
  })

  test('empty everything -> empty string', () => {
    expect(assembleContext({ rows: [], durableMemory: '', recent: [] })).toBe('')
  })
})
