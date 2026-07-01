// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectOrder } from '@/lib/types'
import {
  isProjectInWorkspace,
  loadConversationWorkspace,
  saveConversationWorkspace,
  WORKSPACE_ALL,
} from './workspace-membership'

const order: ProjectOrder = {
  tree: [],
  workspaceTrees: {
    ws1: [
      { id: 'claude:///a', type: 'project' },
      { id: 'g1', type: 'group', name: 'Group', children: [{ id: 'claude:///b', type: 'project' }] },
    ],
    ws2: [{ id: 'claude:///a', type: 'project' }], // same project also lives in ws2 (many-to-many)
  },
}

describe('isProjectInWorkspace (membership is per-workspace, not single-home)', () => {
  it('is true for EVERY workspace a project belongs to', () => {
    expect(isProjectInWorkspace(order, 'ws1', 'claude:///a')).toBe(true)
    expect(isProjectInWorkspace(order, 'ws2', 'claude:///a')).toBe(true)
  })

  it('finds a project nested inside a group', () => {
    expect(isProjectInWorkspace(order, 'ws1', 'claude:///b')).toBe(true)
  })

  it('is false for a workspace the project is not in', () => {
    expect(isProjectInWorkspace(order, 'ws2', 'claude:///b')).toBe(false)
  })
})

describe('conversation -> workspace memory (record + remember)', () => {
  beforeEach(() => localStorage.clear())

  it('returns undefined before anything is recorded', () => {
    expect(loadConversationWorkspace('conv1')).toBeUndefined()
  })

  it('remembers the workspace a conversation was last viewed in', () => {
    saveConversationWorkspace('conv1', 'ws2')
    expect(loadConversationWorkspace('conv1')).toBe('ws2')
  })

  it('records the "All" view with the WORKSPACE_ALL sentinel (distinct from unrecorded)', () => {
    saveConversationWorkspace('conv1', WORKSPACE_ALL)
    expect(loadConversationWorkspace('conv1')).toBe(WORKSPACE_ALL)
    expect(loadConversationWorkspace('other')).toBeUndefined()
  })

  it('overwrites on re-record and keeps conversations independent', () => {
    saveConversationWorkspace('conv1', 'ws1')
    saveConversationWorkspace('conv2', 'ws2')
    saveConversationWorkspace('conv1', WORKSPACE_ALL)
    expect(loadConversationWorkspace('conv1')).toBe(WORKSPACE_ALL)
    expect(loadConversationWorkspace('conv2')).toBe('ws2')
  })
})
