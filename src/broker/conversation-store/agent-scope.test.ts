import { describe, expect, it } from 'bun:test'
import type { TranscriptEntry } from '../../shared/protocol'
import { agentScopeOf, partitionByAgentScope } from './agent-scope'

const e = (o: Record<string, unknown>): TranscriptEntry => o as unknown as TranscriptEntry

describe('agentScopeOf', () => {
  it('returns null for a genuine parent entry (no discriminant)', () => {
    expect(agentScopeOf(e({ type: 'assistant', uuid: 'a', message: {} }))).toBeNull()
    expect(agentScopeOf(e({ type: 'user', uuid: 'u', message: {} }))).toBeNull()
    expect(agentScopeOf(e({ type: 'system', subtype: 'status' }))).toBeNull()
  })

  it('derives scope from task_id (system task frames)', () => {
    expect(agentScopeOf(e({ type: 'system', subtype: 'task_progress', task_id: 'task_1' }))).toBe('task_1')
  })

  it('derives scope from parent_tool_use_id (assistant/user subagent messages)', () => {
    expect(agentScopeOf(e({ type: 'assistant', parent_tool_use_id: 'toolu_9' }))).toBe('toolu_9')
  })

  it('accepts camelCase discriminant variants', () => {
    expect(agentScopeOf(e({ type: 'system', taskId: 'task_cc' }))).toBe('task_cc')
    expect(agentScopeOf(e({ type: 'assistant', parentToolUseId: 'toolu_cc' }))).toBe('toolu_cc')
    expect(agentScopeOf(e({ type: 'assistant', parentToolUseID: 'toolu_cc2' }))).toBe('toolu_cc2')
  })

  it('prefers task_id over parent_tool_use_id when both are present', () => {
    expect(agentScopeOf(e({ type: 'system', task_id: 'task_a', parent_tool_use_id: 'toolu_b' }))).toBe('task_a')
  })

  it('ignores empty-string and non-string discriminants', () => {
    expect(agentScopeOf(e({ type: 'system', task_id: '' }))).toBeNull()
    expect(agentScopeOf(e({ type: 'system', task_id: 123 }))).toBeNull()
  })
})

describe('partitionByAgentScope', () => {
  it('splits a mixed batch into parent + per-agent sub-batches preserving order', () => {
    const batch = [
      e({ type: 'user', uuid: 'p1' }),
      e({ type: 'system', subtype: 'task_progress', uuid: 'a1', task_id: 'task_1' }),
      e({ type: 'assistant', uuid: 'p2' }),
      e({ type: 'system', subtype: 'task_progress', uuid: 'a2', task_id: 'task_1' }),
      e({ type: 'assistant', uuid: 'b1', parent_tool_use_id: 'toolu_2' }),
    ]
    const { parent, agents } = partitionByAgentScope(batch)

    expect(parent.map(x => x.uuid)).toEqual(['p1', 'p2'])
    expect([...agents.keys()].sort()).toEqual(['task_1', 'toolu_2'])
    expect(agents.get('task_1')?.map(x => x.uuid)).toEqual(['a1', 'a2'])
    expect(agents.get('toolu_2')?.map(x => x.uuid)).toEqual(['b1'])
  })

  it('an all-parent batch yields zero agent scopes', () => {
    const { parent, agents } = partitionByAgentScope([
      e({ type: 'user', uuid: 'p' }),
      e({ type: 'assistant', uuid: 'q' }),
    ])
    expect(parent).toHaveLength(2)
    expect(agents.size).toBe(0)
  })

  it('an all-agent batch yields zero parent entries', () => {
    const { parent, agents } = partitionByAgentScope([
      e({ type: 'system', task_id: 't', uuid: '1' }),
      e({ type: 'system', task_id: 't', uuid: '2' }),
    ])
    expect(parent).toHaveLength(0)
    expect(agents.get('t')).toHaveLength(2)
  })

  it('an empty batch yields empty parent + no agents', () => {
    const { parent, agents } = partitionByAgentScope([])
    expect(parent).toHaveLength(0)
    expect(agents.size).toBe(0)
  })
})
