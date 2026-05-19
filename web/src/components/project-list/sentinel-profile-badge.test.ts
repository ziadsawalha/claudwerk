/**
 * extractProfileFromProjectUri -- pulls the URI userinfo (profile name) out
 * of a `claude://profile@host/path` project URI. The badge renderer keys
 * off this to decide whether to show a profile badge for a conversation.
 */

import { describe, expect, it } from 'vitest'
import { extractProfileFromProjectUri } from './sentinel-profile-badge'

describe('extractProfileFromProjectUri', () => {
  it('returns the profile name from a claude://profile@host URI', () => {
    expect(extractProfileFromProjectUri('claude://work@beast/Users/jonas/foo')).toBe('work')
  })

  it('returns undefined when the URI has no userinfo', () => {
    expect(extractProfileFromProjectUri('claude://beast/Users/jonas/foo')).toBeUndefined()
    expect(extractProfileFromProjectUri('claude:///Users/jonas/foo')).toBeUndefined()
  })

  it('returns undefined for the wildcard or unparseable input', () => {
    expect(extractProfileFromProjectUri(undefined)).toBeUndefined()
    expect(extractProfileFromProjectUri('*')).toBeUndefined()
    expect(extractProfileFromProjectUri('')).toBeUndefined()
    expect(extractProfileFromProjectUri('not a url')).toBeUndefined()
  })

  it('decodes percent-encoded userinfo', () => {
    // `parseProjectUri` (server-side) decodes the userinfo; mirror that here.
    expect(extractProfileFromProjectUri('claude://work-alt@beast/x')).toBe('work-alt')
  })
})
