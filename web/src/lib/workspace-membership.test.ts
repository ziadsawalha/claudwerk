import { describe, expect, it } from 'vitest'
import type { ProjectOrder } from '@/lib/types'
import { isProjectInWorkspace, workspaceForProject } from './workspace-membership'

const order: ProjectOrder = {
  tree: [],
  workspaceTrees: {
    ws1: [
      { id: 'claude:///a', type: 'project' },
      {
        id: 'g1',
        type: 'group',
        name: 'Group',
        children: [{ id: 'claude:///b', type: 'project' }],
      },
    ],
    ws2: [{ id: 'claude:///c', type: 'project' }],
  },
}

describe('workspaceForProject', () => {
  it('finds the owning workspace for a top-level project', () => {
    expect(workspaceForProject(order, 'claude:///a')).toBe('ws1')
  })

  it('finds the owning workspace for a project nested in a group', () => {
    expect(workspaceForProject(order, 'claude:///b')).toBe('ws1')
  })

  it('resolves a project in a different workspace', () => {
    expect(workspaceForProject(order, 'claude:///c')).toBe('ws2')
  })

  it('returns null for a project in no workspace', () => {
    expect(workspaceForProject(order, 'claude:///none')).toBeNull()
  })

  it('returns null when there are no workspace trees', () => {
    expect(workspaceForProject({ tree: [] }, 'claude:///a')).toBeNull()
  })
})

describe('isProjectInWorkspace', () => {
  it('is true only for the owning workspace', () => {
    expect(isProjectInWorkspace(order, 'ws1', 'claude:///a')).toBe(true)
    expect(isProjectInWorkspace(order, 'ws2', 'claude:///a')).toBe(false)
  })
})
