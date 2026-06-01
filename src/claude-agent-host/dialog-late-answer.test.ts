/**
 * Agent-host late-answer delivery tests.
 *
 * After a dialog times out the pending entry is deleted, so a subsequent result
 * (from the user re-displaying the expired dialog) has no pending promise to
 * resolve. The broker tags such results `_late`; resolveDialog must then deliver
 * a labeled late answer to the agent (or silently consume a late cancel).
 */

import { afterEach, describe, expect, it } from 'bun:test'
import type { DialogResult } from '../shared/dialog-schema'
import { closeMcpChannel, initMcpChannel, resolveDialog } from './mcp-channel'

interface Delivered {
  content: string
  meta: Record<string, string>
}

function initCapturing(): Delivered[] {
  const delivered: Delivered[] = []
  initMcpChannel({ onDeliverMessage: (content, meta) => delivered.push({ content, meta }) })
  return delivered
}

afterEach(async () => {
  await closeMcpChannel()
})

describe('resolveDialog late-answer branch', () => {
  it('delivers a labeled late answer for an expired (no-pending) dialog tagged _late', () => {
    const delivered = initCapturing()
    const result: DialogResult = {
      _action: 'submit',
      _timeout: false,
      _cancelled: false,
      _late: true,
      _dialogTitle: 'Pick a color',
      color: 'blue',
    }

    const handled = resolveDialog('dlg-abc12345', result)

    expect(handled).toBe(true)
    expect(delivered).toHaveLength(1)
    expect(delivered[0].meta.status).toBe('late')
    expect(delivered[0].meta.dialog_id).toBe('dlg-abc12345')
    expect(delivered[0].content).toContain('Late answer to dialog "Pick a color"')
    expect(delivered[0].content).toContain('"color": "blue"')
    // Internal underscore-prefixed keys must never leak into the delivered values.
    expect(delivered[0].content).not.toContain('_late')
    expect(delivered[0].content).not.toContain('_dialogTitle')
  })

  it('silently consumes a late CANCEL -- the agent already heard about the timeout', () => {
    const delivered = initCapturing()
    const result: DialogResult = { _action: 'submit', _timeout: false, _cancelled: true, _late: true }

    const handled = resolveDialog('dlg-cancel', result)

    expect(handled).toBe(true)
    expect(delivered).toHaveLength(0)
  })

  it('ignores a stale/duplicate result with no pending entry and no _late tag', () => {
    const delivered = initCapturing()
    const result: DialogResult = { _action: 'submit', _timeout: false, _cancelled: false }

    const handled = resolveDialog('dlg-unknown', result)

    expect(handled).toBe(false)
    expect(delivered).toHaveLength(0)
  })
})
