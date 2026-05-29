import { describe, expect, it } from 'bun:test'
import type { TranscriptEntry } from '../../shared/protocol'
import type { HandlerContext, MessageData } from '../handler-context'
import { transcriptEntries } from './transcript'

const e = (o: Record<string, unknown>): TranscriptEntry => o as unknown as TranscriptEntry

interface AddCall {
  conversationId: string
  entries: TranscriptEntry[]
  isInitial: boolean
}
interface SubCall extends AddCall {
  agentId: string
}
interface BroadcastCall {
  channel: string
  agentId?: string
  message: unknown
}

function fakeCtx() {
  const parentAdds: AddCall[] = []
  const subAdds: SubCall[] = []
  const broadcasts: BroadcastCall[] = []
  const ctx = {
    ws: { data: {} },
    conversations: {
      addTranscriptEntries: (conversationId: string, entries: TranscriptEntry[], isInitial: boolean) =>
        parentAdds.push({ conversationId, entries, isInitial }),
      addSubagentTranscriptEntries: (
        conversationId: string,
        agentId: string,
        entries: TranscriptEntry[],
        isInitial: boolean,
      ) => subAdds.push({ conversationId, agentId, entries, isInitial }),
      broadcastToChannel: (channel: string, _conversationId: string, message: unknown, agentId?: string) =>
        broadcasts.push({ channel, agentId, message }),
    },
  } as unknown as HandlerContext
  return { ctx, parentAdds, subAdds, broadcasts }
}

describe('transcriptEntries divert (Checkpoint A)', () => {
  it('routes parent entries to the parent ingest and agent chatter to its sub-scope', () => {
    const { ctx, parentAdds, subAdds, broadcasts } = fakeCtx()
    transcriptEntries(ctx, {
      conversationId: 'conv1',
      isInitial: false,
      entries: [
        e({ type: 'assistant', uuid: 'p1' }),
        e({ type: 'system', subtype: 'task_progress', uuid: 'a1', task_id: 'task_1' }),
        e({ type: 'system', subtype: 'task_progress', uuid: 'a2', task_id: 'task_1' }),
      ],
    } as unknown as MessageData)

    expect(parentAdds).toHaveLength(1)
    expect(parentAdds[0].entries.map(x => x.uuid)).toEqual(['p1'])

    expect(subAdds).toHaveLength(1)
    expect(subAdds[0].agentId).toBe('task_1')
    expect(subAdds[0].entries.map(x => x.uuid)).toEqual(['a1', 'a2'])

    // Parent channel broadcast carries only the parent entry (zero agent chatter).
    const parentBroadcast = broadcasts.find(b => b.channel === 'conversation:transcript')
    expect((parentBroadcast?.message as { entries: TranscriptEntry[] }).entries.map(x => x.uuid)).toEqual(['p1'])
    const subBroadcast = broadcasts.find(b => b.channel === 'conversation:subagent_transcript')
    expect(subBroadcast?.agentId).toBe('task_1')
  })

  it('an all-parent batch never touches the subagent path', () => {
    const { ctx, parentAdds, subAdds } = fakeCtx()
    transcriptEntries(ctx, {
      conversationId: 'conv1',
      entries: [e({ type: 'user', uuid: 'p1' })],
    } as unknown as MessageData)
    expect(parentAdds).toHaveLength(1)
    expect(subAdds).toHaveLength(0)
  })

  it('an all-agent batch skips the parent ingest entirely (no empty parent broadcast)', () => {
    const { ctx, parentAdds, subAdds, broadcasts } = fakeCtx()
    transcriptEntries(ctx, {
      conversationId: 'conv1',
      entries: [e({ type: 'system', subtype: 'task_progress', uuid: 'a1', task_id: 'task_1' })],
    } as unknown as MessageData)
    expect(parentAdds).toHaveLength(0)
    expect(subAdds).toHaveLength(1)
    expect(broadcasts.some(b => b.channel === 'conversation:transcript')).toBe(false)
  })
})
