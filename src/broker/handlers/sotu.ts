/**
 * SOTU contribution-spine wire handlers (Phase 1 `scribe_note` + Phase 3
 * `turn_digest`).
 *
 * An agent host emits two kinds of contribution:
 *  - `scribe_note` -- a copy of an inline `<callout>` (declared intent, high weight).
 *  - `turn_digest` -- the always-on per-turn baseline floor (compact intent +
 *    files touched + result, NOT raw messages).
 * Both append to the project's queue via the single `recordContribution`
 * chokepoint, bump the weighted pending counter, and broadcast `sotu_contribution`
 * so the live soft-lock map updates. NO LLM -- the free floor. The distill engine
 * (Phase 4) drains it.
 *
 * Trust: agent-host callers must be benevolent (recap Pillar B gate). The reply
 * echoes `requestId` so a belt-and-suspenders MCP caller surfaces the error
 * instead of hanging to a silent timeout.
 *
 * Boundary: the broker receives ALREADY-STRUCTURED messages; it never parses CC
 * output (the `<callout>` parse + the turn-digest distillation happen at the
 * agent host, Phase 3).
 */

import type { ScribeNote } from '../../shared/protocol'
import type { HandlerContext, MessageData } from '../handler-context'
import { AGENT_HOST_ONLY, registerHandlers } from '../message-router'
import type { TurnDigestContrib } from '../sotu/types'
import { buildCallout, commit, echoOf, resolveSource, trustError, VALID_NOTE_TYPES } from './sotu-shared'

function scribeNote(ctx: HandlerContext, data: MessageData): void {
  const echo = echoOf(data)
  const denied = trustError(ctx)
  if (denied) {
    ctx.reply({ type: 'scribe_note_result', ok: false, error: denied, ...echo })
    return
  }
  const noteType = data.noteType as ScribeNote['noteType'] | undefined
  const payload = typeof data.payload === 'string' ? data.payload : undefined
  if (!noteType || !VALID_NOTE_TYPES.has(noteType) || !payload) {
    ctx.reply({ type: 'scribe_note_result', ok: false, error: 'scribe_note requires noteType + payload', ...echo })
    return
  }
  const src = resolveSource(ctx, data)
  if (!src) {
    ctx.reply({ type: 'scribe_note_result', ok: false, error: 'no resolvable conversation/project', ...echo })
    return
  }
  const contrib = buildCallout(data, src.convId, noteType, payload)
  commit(
    ctx,
    'scribe_note_result',
    src,
    contrib,
    echo,
    `scribe_note conv=${src.convId.slice(0, 8)} type=${contrib.type}`,
  )
}

/** Build the turn-digest queue contribution. Optional fields are spread in only
 *  when present so an empty digest never lands. */
function buildTurnDigest(data: MessageData, convId: string): TurnDigestContrib {
  const stringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
  const touching = stringArray(data.touching)
  return {
    kind: 'turn_digest',
    convId,
    ts: typeof data.ts === 'number' ? data.ts : Date.now(),
    ...(typeof data.intent === 'string' ? { intent: data.intent } : {}),
    ...(touching && touching.length ? { touching } : {}),
    ...(typeof data.result === 'string' ? { result: data.result } : {}),
    ...(typeof data.blockedOn === 'string' ? { blockedOn: data.blockedOn } : {}),
  }
}

function turnDigest(ctx: HandlerContext, data: MessageData): void {
  const echo = echoOf(data)
  const denied = trustError(ctx)
  if (denied) {
    ctx.reply({ type: 'turn_digest_result', ok: false, error: denied, ...echo })
    return
  }
  const src = resolveSource(ctx, data)
  if (!src) {
    ctx.reply({ type: 'turn_digest_result', ok: false, error: 'no resolvable conversation/project', ...echo })
    return
  }
  const contrib = buildTurnDigest(data, src.convId)
  const touchCount = contrib.touching?.length ?? 0
  commit(
    ctx,
    'turn_digest_result',
    src,
    contrib,
    echo,
    `turn_digest conv=${src.convId.slice(0, 8)} touched=${touchCount}`,
  )
}

export function registerSotuHandlers(): void {
  registerHandlers({ scribe_note: scribeNote, turn_digest: turnDigest }, AGENT_HOST_ONLY)
}
