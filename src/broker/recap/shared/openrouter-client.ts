/**
 * Single OpenRouter HTTP client used by:
 *  - recap/away-summary (per-conversation 20-word recap)
 *  - recap/period      (long-form markdown digest)
 *  - voice-stream      (Deepgram refinement pass)
 *
 * Handles bearer auth, deadline-enforced timeout (Promise.race, NOT just
 * AbortController -- a hung provider response was observed to ignore signal
 * abort in Bun), exponential backoff on 5xx, Retry-After honouring on 429,
 * a SEPARATE (smaller) retry budget for timeouts, and normalised usage extraction.
 */

import { NoApiKeyError, OpenRouterError, RateLimitError, TimeoutError } from './errors'
import { type NormalizedUsage, normalizeUsage } from './pricing'

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_RETRIES = 3

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  system?: string
  user?: string
  messages?: ChatMessage[]
  maxTokens?: number
  temperature?: number
  responseFormat?: { type: 'json_object' } | { type: 'text' }
  timeoutMs?: number
  retries?: number
  /** Retries specifically for a TIMEOUT (the attempt exceeding timeoutMs).
   *  Defaults to `retries`. A slow/hung provider must NOT draw the full
   *  rate-limit retry budget -- e.g. 240s x 3 attempts = 12min of dead air
   *  (the recap-resilience incident). The recap pipeline passes 1. */
  timeoutRetries?: number
  /** Override fetch (test seam). Defaults to globalThis.fetch. */
  fetcher?: typeof fetch
  /** Override env lookup (test seam). Defaults to process.env. */
  apiKey?: string
}

export interface ChatResponse {
  content: string
  raw: unknown
  usage: NormalizedUsage
  model: string
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const apiKey = resolveApiKey(req)
  const retries = req.retries ?? DEFAULT_RETRIES
  const ctx: AttemptContext = {
    body: buildBody(req),
    fetcher: req.fetcher ?? globalThis.fetch,
    timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    apiKey,
    model: req.model,
    maxRetries: retries,
    timeoutRetries: req.timeoutRetries ?? retries,
  }
  return runWithRetry(ctx)
}

interface AttemptContext {
  body: Record<string, unknown>
  fetcher: typeof fetch
  timeoutMs: number
  apiKey: string
  model: string
  /** Retry budget for 429/5xx (the general transient-error budget). */
  maxRetries: number
  /** Retry budget for TimeoutError specifically (kept smaller on purpose). */
  timeoutRetries: number
}

// Timeouts and rate-limit/5xx errors draw from SEPARATE budgets: a hung provider
// should not consume the generous transient-error retries (and vice versa). A hard
// ceiling on total attempts guards against an alternating-error stream looping.
// fallow-ignore-next-line complexity
async function runWithRetry(ctx: AttemptContext): Promise<ChatResponse> {
  let timeoutRetriesUsed = 0
  let otherRetriesUsed = 0
  const hardCap = ctx.maxRetries + ctx.timeoutRetries + 1
  for (let total = 0; total < hardCap; total++) {
    try {
      return await attemptOnce(ctx)
    } catch (err) {
      if (!shouldRetry(err)) throw err
      if (err instanceof TimeoutError) {
        if (timeoutRetriesUsed >= ctx.timeoutRetries) throw err
        timeoutRetriesUsed++
        await sleep(backoffMs(timeoutRetriesUsed, err))
      } else {
        if (otherRetriesUsed >= ctx.maxRetries) throw err
        otherRetriesUsed++
        await sleep(backoffMs(otherRetriesUsed, err))
      }
    }
  }
  throw new OpenRouterError('unreachable')
}

function resolveApiKey(req: ChatRequest): string {
  const apiKey = req.apiKey ?? process.env.OPENROUTER_API_KEY
  if (!apiKey) throw new NoApiKeyError()
  return apiKey
}

// fallow-ignore-next-line complexity
function buildBody(req: ChatRequest): Record<string, unknown> {
  const messages = assembleMessages(req)
  if (messages.length === 0) throw new OpenRouterError('chat requires at least one message')
  return {
    model: req.model,
    messages,
    // Opt into OpenRouter's real billed cost + token accounting. Without this
    // the response carries no `usage.cost` and normalizeUsage falls back to a
    // LiteLLM price-table ESTIMATE (costSource='litellm'). With it we get the
    // actual charged amount (costSource='openrouter'). Verified live: the
    // response then includes `usage.cost` and a `cost_details` breakdown.
    usage: { include: true },
    ...(req.maxTokens != null && { max_tokens: req.maxTokens }),
    ...(req.temperature != null && { temperature: req.temperature }),
    ...(req.responseFormat && { response_format: req.responseFormat }),
  }
}

function assembleMessages(req: ChatRequest): ChatMessage[] {
  const messages: ChatMessage[] = req.messages ? [...req.messages] : []
  if (req.system) messages.unshift({ role: 'system', content: req.system })
  if (req.user) messages.push({ role: 'user', content: req.user })
  return messages
}

/**
 * One HTTP attempt, HARD-bounded by `timeoutMs`. The bound is enforced with a
 * Promise.race against a deadline, not by AbortController alone: a slow/hung
 * provider response (incident: a 707s Bedrock generation against a 240s timeout)
 * was NOT interrupted by `signal` abort in Bun, so the deadline IS the guarantee
 * and `ctrl.abort()` is best-effort socket cleanup layered on top. The race also
 * covers the body read (`res.json()` in parseResponse): headers can arrive
 * promptly while the body streams for minutes, so timing out only the fetch()
 * call would miss exactly the failure mode that bit us.
 */
async function attemptOnce(ctx: AttemptContext): Promise<ChatResponse> {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const work = (async (): Promise<ChatResponse> => {
    const res = await ctx.fetcher(ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ctx.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ctx.body),
      signal: ctrl.signal,
    })
    if (!res.ok) throw await errorForStatus(res)
    return parseResponse(ctx.model, res)
  })()
  // If the deadline wins, `work` keeps running until the leaked socket settles;
  // swallow its late rejection so it never surfaces as an unhandledRejection.
  work.catch(() => {})
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ctrl.abort()
          reject(new TimeoutError())
        }, ctx.timeoutMs)
      }),
    ])
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new TimeoutError()
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function errorForStatus(res: Response): Promise<Error> {
  // Read the body on EVERY non-2xx -- a bare status code is undebuggable. The
  // OpenRouter 400 body names the actual reason (bad model slug, param, etc).
  const body = await safeReadBody(res)
  if (res.status === 429) {
    const retryAfter = res.headers.get('retry-after')
    const retryMs = retryAfter ? Math.max(0, Number(retryAfter)) * 1000 : undefined
    return new RateLimitError(Number.isFinite(retryMs) ? retryMs : undefined)
  }
  const suffix = body ? `: ${body}` : ''
  return new OpenRouterError(
    `OpenRouter returned ${res.status} ${res.statusText}${suffix}`,
    res.status,
    undefined,
    body,
  )
}

/** Read the error body defensively -- never let body-reading mask the original
 *  HTTP error. Truncated so a huge HTML error page can't flood the logs. */
async function safeReadBody(res: Response): Promise<string | undefined> {
  try {
    const text = (await res.text()).trim()
    if (!text) return undefined
    return text.length > 1000 ? `${text.slice(0, 1000)}...[truncated]` : text
  } catch {
    return undefined
  }
}

async function parseResponse(model: string, res: Response): Promise<ChatResponse> {
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: Parameters<typeof normalizeUsage>[1]
    model?: string
  }
  const content = data.choices?.[0]?.message?.content?.trim() ?? ''
  if (!content) throw new OpenRouterError('OpenRouter returned an empty completion')
  return {
    content,
    raw: data,
    usage: normalizeUsage(model, data.usage),
    model: data.model ?? model,
  }
}

// fallow-ignore-next-line complexity
function shouldRetry(err: unknown): boolean {
  if (err instanceof RateLimitError) return true
  if (err instanceof TimeoutError) return true
  if (err instanceof OpenRouterError) {
    return err.status != null && err.status >= 500
  }
  return false
}

function backoffMs(attempt: number, err: unknown): number {
  if (err instanceof RateLimitError && err.retryAfterMs != null) return err.retryAfterMs
  return Math.min(8000, 250 * 2 ** (attempt - 1))
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}
