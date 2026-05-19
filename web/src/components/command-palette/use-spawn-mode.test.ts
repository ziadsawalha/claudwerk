/**
 * Unit tests for parseSpawnInput -- the command-palette spawn input parser.
 *
 * Phase 6 added support for the `@sentinel:profile` shorthand. These tests
 * lock in the shorthand parse and the backwards-compat paths (`@sentinel`
 * with no profile, bare path, full claude:// URI with userinfo).
 */

import { describe, expect, it } from 'vitest'
import { parseSpawnInput } from './use-spawn-mode'

describe('parseSpawnInput', () => {
  it('parses a bare path with no sentinel or profile', () => {
    expect(parseSpawnInput('/abs/path')).toEqual({ path: '/abs/path' })
    expect(parseSpawnInput('~/projects/foo')).toEqual({ path: '~/projects/foo' })
  })

  it('parses @sentinel with no profile (backwards compat)', () => {
    expect(parseSpawnInput('@beast ./foo')).toEqual({ sentinel: 'beast', path: './foo' })
    expect(parseSpawnInput('@beast')).toEqual({ sentinel: 'beast', path: '' })
  })

  it('parses @sentinel:profile shorthand', () => {
    expect(parseSpawnInput('@beast:work ./foo')).toEqual({
      sentinel: 'beast',
      profile: 'work',
      path: './foo',
    })
    expect(parseSpawnInput('@beast:work')).toEqual({
      sentinel: 'beast',
      profile: 'work',
      path: '',
    })
  })

  it('parses @sentinel: with no profile suffix (mid-typing)', () => {
    // User has typed the colon but no profile name yet -- the parser still
    // returns a sentinel so the dir lookup keeps working; profile is left
    // undefined so the sentinel applies its defaultSelection.
    expect(parseSpawnInput('@beast: /abs')).toEqual({
      sentinel: 'beast',
      path: '/abs',
    })
  })

  it('parses full claude:// URI with profile userinfo', () => {
    expect(parseSpawnInput('claude://work@beast/abs/path')).toEqual({
      sentinel: 'beast',
      profile: 'work',
      path: '/abs/path',
    })
  })

  it('parses claude:// URI without profile userinfo', () => {
    expect(parseSpawnInput('claude://beast/abs/path')).toEqual({
      sentinel: 'beast',
      path: '/abs/path',
    })
  })
})
