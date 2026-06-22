import { describe, expect, test } from 'bun:test'
import { buildScoutPrompt, launchProjectScout, type SpawnFn } from './context-builder'
import type { DeskProject } from './projects'

const dp = (over: Partial<DeskProject> = {}): DeskProject => ({
  key: 'k',
  projectUri: 'claude://default/Users/jonas/projects/arr',
  slug: 'arr',
  label: 'arr',
  cwd: '/Users/jonas/projects/arr',
  ...over,
})

describe('buildScoutPrompt', () => {
  test('is read-only and ends by reporting back via the MCP tool', () => {
    const p = buildScoutPrompt('arr', 'claude://default/x/arr')
    expect(p).toContain('SCOUT')
    expect(p).toContain('report_project_context')
    expect(p).toContain('project="claude://default/x/arr"')
    expect(p).toMatch(/do NOT (modify|write)/i)
  })
})

describe('launchProjectScout', () => {
  test('spawns a Haiku scout in the project cwd', async () => {
    let seen: { cwd: string; intent: string; model?: string } | undefined
    const spawn: SpawnFn = async req => {
      seen = req
      return { conversationId: 'scout1' }
    }
    const out = await launchProjectScout(dp(), spawn)
    expect(out.conversationId).toBe('scout1')
    expect(seen?.cwd).toBe('/Users/jonas/projects/arr')
    expect(seen?.model).toBe('haiku')
    expect(seen?.intent).toContain('report_project_context')
  })

  test('refuses a project with no local path', async () => {
    const spawn: SpawnFn = async () => ({ conversationId: 'x' })
    await expect(launchProjectScout(dp({ cwd: null }), spawn)).rejects.toThrow(/no local filesystem path/)
  })
})
