/**
 * AGENT STATUS rendering for the recap prompts -- the highest-confidence signal.
 *
 * Each conversation's own `set_status` (state + done/pending/blocked, often citing
 * the commit hash) is an authoritative, deterministic per-conversation claim that
 * BYPASSES map extraction -- so, like the forgotten-threads block, it is injected
 * straight into BOTH prompt paths (oneshot {@link buildPrompt} + chunked
 * `buildSynthesizePrompt`) by this ONE renderer, so they cannot drift.
 *
 * ALL of the "how to weigh this" instruction lives in the section header here
 * (NOT in the framing/template specs), so the byte-pinned prompt contract is
 * untouched: the model gets the weighting rules right next to the data.
 *
 * Provenance: conversations are grouped by spawn-lineage root (best-effort -- a
 * link launched not-from-its-predecessor has no root), so a chain-protocol run
 * folds into ONE storyline instead of N unrelated threads.
 */

import type { LiveStatus } from '../../../../shared/protocol'
import type { ConversationDigest } from '../gather/types'
import { shortId } from './render-transcripts'

/** Per-field cap so one essay-sized status can't blow the prompt budget. */
const MAX_FIELD_CHARS = 280

const STATUS_HEADER = `AGENT STATUS -- self-reported via set_status (HIGHEST-CONFIDENCE SIGNAL, weigh ABOVE transcript inference):
  Each line is the conversation's OWN end-of-turn claim about what it did. A claim
  here backed by set_status is a FACT (not an inference); it often cites the commit
  hash -- cross-check against COMMITS, and a status hash that matches a commit is
  doubly confirmed. WEIGH CHRONOLOGICALLY: a status tagged SUPERSEDED had later user
  activity, so it is NOT the final state -- defer to the transcript/commits there.
  Conversations grouped under one CHAIN/LINEAGE root are a single spawn lineage
  (often a chain-protocol run): treat them as ONE storyline ("N-link chain, phases
  X..Y, all merged"), never N unrelated threads.`

type WithStatus = ConversationDigest & { liveStatus: LiveStatus }

export function renderStatusSection(convs: ConversationDigest[]): string {
  const withStatus = convs.filter((c): c is WithStatus => Boolean(c.liveStatus))
  if (withStatus.length === 0) return ''

  // Group by spawn-lineage root (best-effort). key = root ?? own id, so the
  // originator and its descendants land in the same bucket.
  const groups = new Map<string, WithStatus[]>()
  for (const c of withStatus) {
    const key = c.rootConversationId ?? c.id
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }

  const chains: string[] = []
  const singles: string[] = []
  for (const [key, members] of groups) {
    if (members.length >= 2) {
      members.sort((a, b) => a.createdAt - b.createdAt)
      const lines = members.map(renderStatusLine).join('\n')
      chains.push(`  CHAIN/LINEAGE ${shortId(key)} (${members.length} conversations, oldest first):\n${lines}`)
    } else {
      singles.push(renderStatusLine(members[0]))
    }
  }

  const parts = [STATUS_HEADER]
  if (chains.length > 0) parts.push(chains.join('\n\n'))
  if (singles.length > 0) parts.push(`  STANDALONE:\n${singles.join('\n')}`)
  return parts.join('\n\n')
}

function renderStatusLine(c: WithStatus): string {
  const ls = c.liveStatus
  const flags = [c.liveStatusSuperseded ? 'SUPERSEDED' : null, ls.safe_to_close ? 'safe-to-close' : null]
    .filter(Boolean)
    .join(', ')
  const head = `  ${shortId(c.id)} "${c.title}" [${ls.state}]${flags ? ` (${flags})` : ''}`
  const detail: string[] = []
  appendField(detail, 'done', ls.done)
  appendField(detail, 'pending', ls.pending)
  appendField(detail, 'blocked', ls.blocked)
  appendField(detail, 'caveats', ls.caveats)
  return detail.length > 0 ? `${head}\n${detail.join('\n')}` : head
}

function appendField(out: string[], label: string, value: string | undefined): void {
  if (!value?.trim()) return
  out.push(`      ${label}: ${oneLine(value)}`)
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_FIELD_CHARS ? `${flat.slice(0, MAX_FIELD_CHARS - 1)}…` : flat
}
