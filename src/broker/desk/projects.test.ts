import { describe, expect, test } from 'bun:test'
import { type DeskProject, pickProject, projectCwd, projectKeyOf, toDeskProject } from './projects'

function dp(slug: string, label: string, uri: string): DeskProject {
  return toDeskProject({ id: 1, scope: uri, slug, label, project_uri: uri })
}

describe('projectCwd', () => {
  test('extracts the path from a path-backed uri', () => {
    expect(projectCwd('claude://default/Users/jonas/projects/arr')).toBe('/Users/jonas/projects/arr')
  })
  test('returns null for a non-path uri', () => {
    expect(projectCwd('agent://openai/asst_abc')).toBeNull()
  })
  test('returns null for garbage', () => {
    expect(projectCwd('not a uri')).toBeNull()
  })
})

describe('projectKeyOf', () => {
  test('strips the conversation fragment so a project key is stable across sessions', () => {
    const a = projectKeyOf('claude://default/Users/jonas/projects/arr#conv-1')
    const b = projectKeyOf('claude://default/Users/jonas/projects/arr#conv-2')
    expect(a).toBe(b)
    expect(a).toBeTruthy()
  })
  test('null for empty / wildcard', () => {
    expect(projectKeyOf(null)).toBeNull()
    expect(projectKeyOf('*')).toBeNull()
    expect(projectKeyOf(undefined)).toBeNull()
  })
})

describe('toDeskProject', () => {
  test('uses stored label and derives cwd + key', () => {
    const p = dp('arr', 'Arr', 'claude://default/Users/jonas/projects/arr')
    expect(p.label).toBe('Arr')
    expect(p.cwd).toBe('/Users/jonas/projects/arr')
    expect(p.key).toBe(projectKeyOf('claude://default/Users/jonas/projects/arr') ?? '')
  })
  test('falls back to the path-tail label when none stored', () => {
    const p = toDeskProject({
      id: 2,
      scope: '',
      slug: 'remote-claude',
      label: null,
      project_uri: 'claude://default/x/remote-claude',
    })
    expect(p.label).toBe('remote-claude')
  })
})

describe('pickProject', () => {
  const projects = [
    dp('arr', 'Arr', 'claude://default/Users/jonas/projects/arr'),
    dp('remote-claude', 'remote-claude', 'claude://default/Users/jonas/projects/remote-claude'),
    dp('yemaya', 'Yemaya', 'claude://default/Users/jonas/projects/yemaya'),
  ]
  test('exact slug wins', () => {
    expect(pickProject(projects, 'arr')?.slug).toBe('arr')
  })
  test('case-insensitive label match', () => {
    expect(pickProject(projects, 'YEMAYA')?.slug).toBe('yemaya')
  })
  test('substring fallback', () => {
    expect(pickProject(projects, 'remote')?.slug).toBe('remote-claude')
  })
  test('no match -> null', () => {
    expect(pickProject(projects, 'nonexistent-xyz')).toBeNull()
  })
  test('empty -> null', () => {
    expect(pickProject(projects, '   ')).toBeNull()
  })
})
