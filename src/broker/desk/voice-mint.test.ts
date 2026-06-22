import { describe, expect, it } from 'bun:test'
import { buildVoiceSessionConfig, mintVoiceToken, REALTIME_MODEL } from './voice-mint'
import { voiceToolNames } from './voice-tools'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('buildVoiceSessionConfig', () => {
  it('wires the dispatch tool contract + realtime model', () => {
    const cfg = buildVoiceSessionConfig()
    expect(cfg.model).toBe(REALTIME_MODEL)
    expect(cfg.tools.map(t => t.name).sort()).toEqual([...voiceToolNames].sort())
    expect(cfg.audio.output.voice).toBeTruthy()
  })
})

describe('mintVoiceToken -- key protection', () => {
  it('mints an ephemeral token without leaking the key to the result', async () => {
    let sentAuth = ''
    let sentUrl = ''
    const fetcher = (async (url: string, init: RequestInit) => {
      sentUrl = String(url)
      sentAuth = String((init.headers as Record<string, string>).Authorization)
      return jsonResponse({ client_secret: { value: 'ek_ephemeral_123', expires_at: 999 } })
    }) as unknown as typeof fetch

    const out = await mintVoiceToken({ apiKey: 'sk-secret', fetcher, safetyId: 'desk-jonas' })
    expect(out.value).toBe('ek_ephemeral_123')
    expect(out.expiresAt).toBe(999)
    expect(out.model).toBe(REALTIME_MODEL)
    // The secret key went ONLY in the server->OpenAI Authorization header.
    expect(sentAuth).toBe('Bearer sk-secret')
    expect(sentUrl).toContain('openai.com/v1/realtime/client_secrets')
    expect(JSON.stringify(out)).not.toContain('sk-secret')
  })

  it('supports the flat {value} response shape too', async () => {
    const fetcher = (async () => jsonResponse({ value: 'ek_flat' })) as unknown as typeof fetch
    const out = await mintVoiceToken({ apiKey: 'sk', fetcher })
    expect(out.value).toBe('ek_flat')
  })

  it('throws a clear error when the key is missing', async () => {
    await expect(mintVoiceToken({ apiKey: '' })).rejects.toThrow('OPENAI_API_KEY not configured')
  })

  it('surfaces an OpenAI error status', async () => {
    const fetcher = (async () => jsonResponse({ error: 'nope' }, false, 401)) as unknown as typeof fetch
    await expect(mintVoiceToken({ apiKey: 'sk', fetcher })).rejects.toThrow('client_secrets 401')
  })

  it('throws when no token is present', async () => {
    const fetcher = (async () => jsonResponse({})) as unknown as typeof fetch
    await expect(mintVoiceToken({ apiKey: 'sk', fetcher })).rejects.toThrow('no token')
  })
})
