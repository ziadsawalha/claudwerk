import { describe, expect, it } from 'bun:test'
import { formatTranscriptWindow } from './transcript-window-format'

const conv = { id: 'conv_abc', project: 'claude://default/x', title: 'demo' }

describe('formatTranscriptWindow', () => {
  it('renders empty result with hint', () => {
    const out = formatTranscriptWindow([], conv)
    expect(out).toContain('No entries')
  })

  it('renders header per entry with seq, type, time', () => {
    const out = formatTranscriptWindow(
      [
        {
          seq: 42,
          type: 'user',
          timestamp: 1779298804081,
          content: { message: { role: 'user', content: [{ type: 'text', text: 'hi there' }] } },
        },
      ],
      conv,
    )
    expect(out).toContain('seq 42  user')
    expect(out).toContain('hi there')
  })

  it('extracts assistant text + tool_use blocks', () => {
    const out = formatTranscriptWindow(
      [
        {
          seq: 1,
          type: 'assistant',
          timestamp: 1779298804081,
          content: {
            message: {
              role: 'assistant',
              content: [
                { type: 'text', text: 'here you go' },
                { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
              ],
            },
          },
        },
      ],
      conv,
    )
    expect(out).toContain('here you go')
    expect(out).toContain('[tool_use Bash]')
    expect(out).toContain('"command":"ls"')
  })

  it('renders tool_result canonical content, ignores raw/toolUseResult dups', () => {
    const stdout = '"permission_denied"\n"permission_error"'
    const entry = {
      seq: 10,
      type: 'user',
      timestamp: 1779298804081,
      content: {
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu_1',
              content: stdout,
              is_error: false,
              raw: { backend: 'claude', name: 'Bash', content: stdout, toolUseResult: { stdout, stderr: '' } },
              result: { kind: 'shell', stdout },
              toolUseResult: { stdout, stderr: '' },
            },
          ],
        },
      },
    }
    const out = formatTranscriptWindow([entry], conv)
    expect(out).toContain('[tool_result]')
    expect(out).toContain(stdout)
    // The duplicate wrappers MUST NOT appear in output:
    expect(out).not.toContain('toolUseResult')
    expect(out).not.toContain('"raw"')
    expect(out).not.toContain('backend')
  })

  it('flags tool_result errors', () => {
    const out = formatTranscriptWindow(
      [
        {
          seq: 1,
          type: 'user',
          timestamp: 1779298804081,
          content: { message: { role: 'user', content: [{ type: 'tool_result', content: 'boom', is_error: true }] } },
        },
      ],
      conv,
    )
    expect(out).toContain('[tool_result ERROR]')
    expect(out).toContain('boom')
  })

  it('elides large base64 image blocks', () => {
    const fakeBase64 = 'A'.repeat(8192)
    const out = formatTranscriptWindow(
      [
        {
          seq: 1,
          type: 'user',
          timestamp: 1779298804081,
          content: {
            message: {
              role: 'user',
              content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fakeBase64 } }],
            },
          },
        },
      ],
      conv,
    )
    expect(out).toContain('[image image/png')
    expect(out).toContain('KB elided')
    expect(out).not.toContain(fakeBase64)
  })

  it('truncates per-entry bodies past maxBytesPerEntry with head/tail and omitted byte count', () => {
    const huge = `${'a'.repeat(5000)}b${'c'.repeat(5000)}`
    const out = formatTranscriptWindow(
      [
        {
          seq: 1,
          type: 'user',
          timestamp: 1779298804081,
          content: { message: { role: 'user', content: [{ type: 'text', text: huge }] } },
        },
      ],
      conv,
      { maxBytesPerEntry: 500 },
    )
    expect(out).toContain('omitted')
    expect(out.length).toBeLessThan(huge.length)
    expect(out.startsWith('Conversation:')).toBe(true)
  })

  it('always prints next/prev walk pointers', () => {
    const out = formatTranscriptWindow(
      [
        {
          seq: 5,
          type: 'user',
          timestamp: 1,
          content: { message: { role: 'user', content: [{ type: 'text', text: 'a' }] } },
        },
        {
          seq: 6,
          type: 'assistant',
          timestamp: 2,
          content: { message: { role: 'assistant', content: [{ type: 'text', text: 'b' }] } },
        },
      ],
      conv,
    )
    expect(out).toContain('Next:')
    expect(out).toContain('aroundSeq: 11') // last 6 + 5
    expect(out).toContain('Prev:')
    expect(out).toContain('aroundSeq: 0') // first 5 - 5
  })

  it('falls back to compact json for unknown internal events', () => {
    const out = formatTranscriptWindow(
      [{ seq: 1, type: 'launch_started', timestamp: 1, content: { kind: 'spawn', launchId: 'L1' } }],
      conv,
    )
    expect(out).toContain('seq 1  launch_started')
    expect(out).toContain('"launchId":"L1"')
    // single-line compact json, no indented multi-line dump
    expect(out).not.toContain('\n  "launchId"')
  })
})
