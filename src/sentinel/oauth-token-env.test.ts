/**
 * Tier 1 unit tests for `oauth-token-env` -- token injection + ANTHROPIC_*
 * neutralisation, in both the full-env (delete) and delta (shadow) shapes.
 */
import { describe, expect, test } from 'bun:test'
import { applyOAuthToken, applyOAuthTokenDelta } from './oauth-token-env'

describe('applyOAuthToken (full child env)', () => {
  test('no-op when token is undefined', () => {
    const env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'sk-host', PATH: '/bin' }
    applyOAuthToken(env, undefined)
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBe('sk-host')
  })

  test('injects token and deletes inherited ANTHROPIC_* creds', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_API_KEY: 'sk-host',
      ANTHROPIC_AUTH_TOKEN: 'tok-host',
      PATH: '/bin',
    }
    applyOAuthToken(env, 'sk-ant-oat')
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat')
    expect('ANTHROPIC_API_KEY' in env).toBe(false)
    expect('ANTHROPIC_AUTH_TOKEN' in env).toBe(false)
    expect(env.PATH).toBe('/bin') // untouched
  })

  test('profile.env override of ANTHROPIC_API_KEY survives the strip', () => {
    const env: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'sk-from-profile' }
    applyOAuthToken(env, 'sk-ant-oat', { ANTHROPIC_API_KEY: 'sk-from-profile' })
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-from-profile') // operator override wins
  })
})

describe('applyOAuthTokenDelta (worker delta over daemon base env)', () => {
  test('no-op when token is undefined', () => {
    const delta: Record<string, string> = {}
    applyOAuthTokenDelta(delta, undefined)
    expect(delta).toEqual({})
  })

  test('injects token and shadows ANTHROPIC_* with empty strings', () => {
    const delta: Record<string, string> = {}
    applyOAuthTokenDelta(delta, 'sk-ant-oat')
    expect(delta.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat')
    expect(delta.ANTHROPIC_API_KEY).toBe('')
    expect(delta.ANTHROPIC_AUTH_TOKEN).toBe('')
  })

  test('profile.env override is NOT shadowed', () => {
    const delta: Record<string, string> = { ANTHROPIC_API_KEY: 'sk-from-profile' }
    applyOAuthTokenDelta(delta, 'sk-ant-oat', { ANTHROPIC_API_KEY: 'sk-from-profile' })
    expect(delta.CLAUDE_CODE_OAUTH_TOKEN).toBe('sk-ant-oat')
    expect(delta.ANTHROPIC_API_KEY).toBe('sk-from-profile')
    expect(delta.ANTHROPIC_AUTH_TOKEN).toBe('') // not overridden -> still shadowed
  })
})
