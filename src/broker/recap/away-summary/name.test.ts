import { describe, expect, it } from 'bun:test'
import { sanitizeSuggestedName } from './name'

describe('sanitizeSuggestedName', () => {
  it('passes through an already-clean name', () => {
    expect(sanitizeSuggestedName('internet research')).toBe('internet research')
  })

  it('keeps type prefixes with a colon', () => {
    expect(sanitizeSuggestedName('bug: invalid name')).toBe('bug: invalid name')
    expect(sanitizeSuggestedName('feat: somefeature')).toBe('feat: somefeature')
  })

  it('lowercases', () => {
    expect(sanitizeSuggestedName('Fix Spawn Timeout')).toBe('fix spawn timeout')
  })

  it('strips special characters', () => {
    expect(sanitizeSuggestedName('feat!: "recap" (names)')).toBe('feat: recap names')
  })

  it('normalizes separators to spaces', () => {
    expect(sanitizeSuggestedName('recap_intent/name.fix')).toBe('recap intent name fix')
  })

  it('collapses whitespace and trims edge punctuation', () => {
    expect(sanitizeSuggestedName('  - bug:   spawn   timeout - ')).toBe('bug: spawn timeout')
  })

  it('caps length at a word boundary', () => {
    const out = sanitizeSuggestedName('a very long conversation name that keeps going and going forever')
    expect(out).not.toBeNull()
    expect((out as string).length).toBeLessThanOrEqual(48)
    expect(out).not.toMatch(/\s$/)
  })

  it('rejects null, empty, and garbage-only input', () => {
    expect(sanitizeSuggestedName(null)).toBeNull()
    expect(sanitizeSuggestedName('')).toBeNull()
    expect(sanitizeSuggestedName('!!! ???')).toBeNull()
    expect(sanitizeSuggestedName('ab')).toBeNull()
  })
})
