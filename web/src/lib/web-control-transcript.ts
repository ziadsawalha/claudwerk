/**
 * Web Debug Control -- bounded transcript text serialization for read_transcript.
 * Renders the in-browser transcript entries to a compact, capped plain-text form.
 */

import type { TranscriptContentBlock, TranscriptEntry } from '@shared/protocol'

const TRANSCRIPT_TEXT_CAP = 16_000

const BLOCK_LABELS: Record<string, string> = { thinking: '[thinking]', tool_result: '[tool_result]' }

function blockToText(b: TranscriptContentBlock & Record<string, unknown>): string {
  if (b.type === 'text' && typeof b.text === 'string') return b.text
  if (b.type === 'tool_use') return `[tool_use: ${String(b.name ?? '')}]`
  return BLOCK_LABELS[b.type as string] ?? `[${String(b.type)}]`
}

function blocksToText(content: string | TranscriptContentBlock[] | undefined): string {
  if (!content) return ''
  if (typeof content === 'string') return content
  return content.map(b => blockToText(b as TranscriptContentBlock & Record<string, unknown>)).join('\n')
}

/** Fallback one-liner for non-user/assistant/system entry types. */
function fallbackLine(e: Record<string, unknown>): string {
  const step = e.step ? ` ${String(e.step)}` : ''
  const detail = e.detail ? `: ${String(e.detail)}` : ''
  return `[${String(e.type)}${step}${detail}]`
}

function entryLine(e: TranscriptEntry & Record<string, unknown>): string {
  if (e.type === 'user' || e.type === 'assistant') {
    const content = (e.message as { content?: string | TranscriptContentBlock[] })?.content
    return `${e.type === 'user' ? 'USER' : 'ASSISTANT'}: ${blocksToText(content)}`
  }
  if (e.type === 'system') {
    return `SYSTEM${e.subtype ? `(${String(e.subtype)})` : ''}: ${String(e.content ?? '')}`
  }
  return fallbackLine(e)
}

export function serializeTranscript(entries: TranscriptEntry[]): string {
  const lines = entries.map(entry => entryLine(entry as TranscriptEntry & Record<string, unknown>).trim())
  let out = lines.filter(Boolean).join('\n\n')
  if (out.length > TRANSCRIPT_TEXT_CAP) {
    out = `${out.slice(-TRANSCRIPT_TEXT_CAP)}\n\n[...truncated to last ${TRANSCRIPT_TEXT_CAP} chars]`
  }
  return out
}
