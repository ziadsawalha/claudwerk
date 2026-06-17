import { describe, expect, test } from 'bun:test'
import type { DialogSnapshot } from '../../../shared/dialog-live'
import type { DialogLayout } from '../../../shared/dialog-schema'
import { OpenDialogRegistry } from '../open-dialogs'
import { registerDialogControlTools } from './dialog-control'
import type { McpChannelCallbacks, McpToolContext, ToolCtx } from './types'

function setup() {
  const openDialogs = new OpenDialogRegistry()
  const patches: Array<{ dialogId: string; baseSeq: number; snapshot: DialogSnapshot }> = []
  const reopens: DialogSnapshot[] = []
  const callbacks: McpChannelCallbacks = {
    onDialogPatch: (dialogId, baseSeq, _ops, snapshot) => patches.push({ dialogId, baseSeq, snapshot }),
    onDialogReopen: (_id, snapshot) => reopens.push(snapshot),
  }
  const ctx = { openDialogs, callbacks, elog: () => {} } as unknown as McpToolContext
  const tools = registerDialogControlTools(ctx)
  const layout: DialogLayout = { title: 'T', persistent: true, body: [{ type: 'Markdown', id: 'm', content: 'hi' }] }
  openDialogs.register('d1', layout)
  const call = (name: string, rawArgs: unknown) => tools[name].handle({}, { rawArgs } as ToolCtx)
  return { call, patches, reopens, openDialogs }
}

describe('dialog control tools', () => {
  test('update_dialog applies ops, bumps seq, emits patch', async () => {
    const { call, patches } = setup()
    const r = await call('update_dialog', { dialogId: 'd1', ops: [{ op: 'setState', key: 'k', value: 1 }] })
    expect(r.isError).toBeUndefined()
    expect(patches.length).toBe(1)
    expect(patches[0].baseSeq).toBe(0)
    expect(patches[0].snapshot.seq).toBe(1)
  })

  test('update_dialog rejects bad ops and unknown dialog', async () => {
    const { call, patches } = setup()
    expect((await call('update_dialog', { dialogId: 'd1', ops: [] })).isError).toBe(true)
    expect((await call('update_dialog', { dialogId: 'ghost', ops: [{ op: 'close' }] })).isError).toBe(true)
    expect(patches.length).toBe(0)
  })

  test('update_dialog reports conflicts without failing', async () => {
    const { call } = setup()
    const r = await call('update_dialog', {
      dialogId: 'd1',
      ops: [{ op: 'replace', id: 'ghost', block: { type: 'Markdown', id: 'ghost' } }],
    })
    expect(r.isError).toBeUndefined()
    expect(r.content[0].text).toContain('Conflicts')
  })

  test('close then reopen lifecycle', async () => {
    const { call, reopens, openDialogs } = setup()
    expect((await call('close_dialog', { dialogId: 'd1' })).isError).toBeUndefined()
    expect(openDialogs.get('d1')?.status).toBe('closed')
    // patching a closed dialog fails
    expect((await call('update_dialog', { dialogId: 'd1', ops: [{ op: 'close' }] })).isError).toBe(true)
    expect((await call('reopen_dialog', { dialogId: 'd1' })).isError).toBeUndefined()
    expect(reopens.length).toBe(1)
    expect(openDialogs.get('d1')?.status).toBe('open')
  })
})
