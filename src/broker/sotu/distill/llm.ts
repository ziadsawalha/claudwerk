/**
 * SOTU's own thin LLM-call primitive (Phase 4).
 *
 * recap's `runLlmCall` is PRIVATE to its orchestrator (welded to the recap row +
 * bundle); the Phase-0 seam decision was that SOTU writes its OWN wrapper composing
 * `chat()` + a `RecapLedger`, modeled on recap's but free of recap's deps. This is
 * that wrapper: time the call, record a COST-2 ledger entry on BOTH success and
 * failure (a failed distill still shows the tokens it burned), re-throw on error.
 *
 * Stage mapping (the design's own analogy -- "SCRIBE fold = recap's cheap map,
 * RECONCILE = recap's Opus reduce"): scribe -> `map`, reconcile -> `reduce`. So the
 * shared `RecapLedger` (a COST-2 ledger, keyed by `RecapLedgerStage`) is reused
 * verbatim with no SOTU-specific stage enum.
 */

import type { RecapLedgerStage } from '../../../shared/protocol'
import { type ChatRequest, chat, type NormalizedUsage, RecapLedger } from '../llm-engine'
import type { SotuDistillMode } from '../types'

/** Usage stand-in when `chat()` throws (timeout / 4xx / 5xx): the attempt happened
 *  but carries no token data. `costSource: 'unknown'` marks it. */
const ZERO_USAGE: NormalizedUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  costSource: 'unknown',
}

/** The scribe is the cheap frequent fold; the reconcile is the Opus reduce. */
function stageOf(mode: SotuDistillMode): RecapLedgerStage {
  return mode === 'reconcile' ? 'reduce' : 'map'
}

/** The injectable chat fn (tests pass a stub; production passes the real `chat`).
 *  Matches `chat`'s signature so the real client drops straight in. */
export type ChatFn = (req: ChatRequest) => Promise<{ content: string; usage: NormalizedUsage }>

/**
 * Run one distill LLM call, recording a ledger entry either way. Returns the raw
 * model content. The caller owns prompt assembly + output parsing; this only owns
 * the network round-trip + the cost trail.
 */
export async function runSotuLlmCall(
  chatFn: ChatFn,
  ledger: RecapLedger,
  mode: SotuDistillMode,
  req: ChatRequest,
): Promise<string> {
  const stage = stageOf(mode)
  const t0 = Date.now()
  try {
    const res = await chatFn(req)
    ledger.addCall({ stage, model: req.model, usage: res.usage, ms: Date.now() - t0 })
    return res.content
  } catch (err) {
    ledger.addCall({
      stage,
      model: req.model,
      usage: ZERO_USAGE,
      ms: Date.now() - t0,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
    throw err
  }
}

/** Production chat fn: the real OpenRouter client, narrowed to the fields the
 *  distill needs (content + normalized usage). */
export const realChatFn: ChatFn = async req => {
  const res = await chat(req)
  return { content: res.content, usage: res.usage }
}

export { RecapLedger }
