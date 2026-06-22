import { describe, expect, it } from 'bun:test'
import { buildControlToolset, type ControlToolDeps } from './control-tools'
import type { ToolContext } from './tool-def'

const ctx: ToolContext = {}

function spyDeps(): { deps: ControlToolDeps; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {}
  const rec =
    (name: string, ret: unknown) =>
    (...args: unknown[]) => {
      calls[name] = args
      return ret as never
    }
  const deps: ControlToolDeps = {
    listConversations: rec('listConversations', [{ id: 'a', status: 'idle' }]) as ControlToolDeps['listConversations'],
    inject: rec('inject', Promise.resolve({ conversationId: 'a', delivered: true })) as ControlToolDeps['inject'],
    interrupt: rec('interrupt', Promise.resolve({ conversationId: 'a' })) as ControlToolDeps['interrupt'],
    terminate: rec('terminate', Promise.resolve({ conversationId: 'a' })) as ControlToolDeps['terminate'],
    spawn: rec('spawn', Promise.resolve({ conversationId: 'new' })) as ControlToolDeps['spawn'],
    revive: rec('revive', Promise.resolve({ conversationId: 'a' })) as ControlToolDeps['revive'],
    configure: rec(
      'configure',
      Promise.resolve({ conversationId: 'a', applied: ['model'] }),
    ) as ControlToolDeps['configure'],
    link: rec('link', Promise.resolve({ linked: true })) as ControlToolDeps['link'],
    unlink: rec('unlink', Promise.resolve({ unlinked: true })) as ControlToolDeps['unlink'],
    readEvents: rec('readEvents', Promise.resolve([])) as ControlToolDeps['readEvents'],
  }
  return { deps, calls }
}

describe('buildControlToolset', () => {
  it('exposes list_conversations + the full control surface', () => {
    const ts = buildControlToolset(spyDeps().deps)
    expect(Object.keys(ts).sort()).toEqual(
      [
        'configure',
        'inject',
        'interrupt',
        'link',
        'list_conversations',
        'read_events',
        'revive',
        'spawn',
        'terminate',
        'unlink',
      ].sort(),
    )
  })

  it('maps nullable args to undefined (list_conversations)', async () => {
    const { deps, calls } = spyDeps()
    const ts = buildControlToolset(deps)
    await ts.list_conversations.execute({ status: null, filter: null }, ctx)
    expect(calls.listConversations).toEqual([{ status: undefined, filter: undefined }])
  })

  it('passes through spawn args (nullable -> undefined)', async () => {
    const { deps, calls } = spyDeps()
    const ts = buildControlToolset(deps)
    await ts.spawn.execute({ intent: 'do it', project: 'p', profile: null, worktree: 'wt' }, ctx)
    expect(calls.spawn).toEqual([{ intent: 'do it', project: 'p', profile: undefined, worktree: 'wt' }])
  })

  it('forwards inject + link positional args', async () => {
    const { deps, calls } = spyDeps()
    const ts = buildControlToolset(deps)
    await ts.inject.execute({ conversationId: 'a', message: 'hi' }, ctx)
    await ts.link.execute({ fromConversationId: 'a', toConversationId: 'b' }, ctx)
    expect(calls.inject).toEqual(['a', 'hi'])
    expect(calls.link).toEqual(['a', 'b'])
  })
})
