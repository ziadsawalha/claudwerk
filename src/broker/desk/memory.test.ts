import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatRequest, ChatResponse } from '../recap/shared/openrouter-client'
import { appendMemoryFacts, digestTurn, readMemory, setDispatchMemoryFile } from './memory'

beforeEach(() => {
  setDispatchMemoryFile(join(mkdtempSync(join(tmpdir(), 'desk-mem-')), 'dispatch-memory.md'))
})
afterEach(() => {
  setDispatchMemoryFile('') // reset
})

const chatReturning =
  (content: string) =>
  async (_r: ChatRequest): Promise<ChatResponse> => ({ content, raw: {}, usage: {} as never, model: 'm' })

describe('memory file', () => {
  it('round-trips appended facts as dated bullets', () => {
    expect(readMemory()).toBe('')
    appendMemoryFacts(['prefers bun over npm', 'project ships to ghcr'], 1_700_000_000_000)
    const mem = readMemory()
    expect(mem).toContain('prefers bun over npm')
    expect(mem).toContain('project ships to ghcr')
    expect(mem).toMatch(/^- \[\d{4}-\d{2}-\d{2}\] /m)
  })

  it('ignores an empty fact list', () => {
    appendMemoryFacts([], Date.now())
    expect(readMemory()).toBe('')
  })

  it('caps the memory it returns (oldest dropped)', () => {
    const big = 'x'.repeat(3000)
    appendMemoryFacts([big, big], 1_700_000_000_000) // ~6000 chars > 4000 cap
    expect(readMemory().length).toBeLessThanOrEqual(4000)
  })
})

describe('digestTurn', () => {
  it('returns up to 3 durable facts from the JSON reply', async () => {
    const facts = await digestTurn(
      { intent: 'remember I like haiku', reply: 'noted' },
      chatReturning('{"facts":["likes haiku","a","b","c"]}'),
    )
    expect(facts).toEqual(['likes haiku', 'a', 'b']) // capped to 3
  })

  it('returns nothing for an empty or malformed digest', async () => {
    expect(await digestTurn({ intent: 'hi', reply: 'hey' }, chatReturning('{"facts":[]}'))).toEqual([])
    expect(await digestTurn({ intent: 'hi', reply: 'hey' }, chatReturning('not json'))).toEqual([])
  })
})
