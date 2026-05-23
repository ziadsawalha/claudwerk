/**
 * Compact text rendering for transcript window results.
 *
 * The raw window endpoint returns SQLite rows verbatim:
 * `{id, conversationId, seq, syncEpoch, type, subtype, agentId, uuid, content, timestamp, ingestedAt}`.
 * Dumping that as `JSON.stringify(_, null, 2)` is what `get_transcript_context`
 * (both the agent-host MCP tool and the broker MCP tool) used to do.
 *
 * That's wildly token-inefficient: tool_result entries duplicate the same
 * stdout 4-5 times across `content` / `raw` / `result` / `toolUseResult`,
 * image blocks carry base64 payloads no model needs, and the row-level
 * metadata (uuid, syncEpoch, ingestedAt, id) is dead weight to a reader.
 *
 * This formatter renders each entry as:
 *   ─── seq N  <type>[/<subtype>]  <iso-time> ───
 *   <readable body, truncated to maxBytesPerEntry>
 *
 * Round trips are saved by always printing walk pointers at the bottom.
 */

interface RawWindowEntry {
  id?: number
  conversationId?: string
  seq: number
  type: string
  subtype?: string
  agentId?: string
  uuid?: string
  content: unknown
  timestamp?: number
}

interface ConversationMeta {
  id: string
  project?: string
  title?: string
  description?: string
}

export interface WindowFormatOpts {
  maxBytesPerEntry?: number
}

const DEFAULT_MAX_BYTES = 2000

export function formatTranscriptWindow(
  entries: RawWindowEntry[],
  conversation: ConversationMeta | undefined,
  opts: WindowFormatOpts = {},
): string {
  const max = opts.maxBytesPerEntry ?? DEFAULT_MAX_BYTES

  if (entries.length === 0) {
    return 'No entries in window. Check conversationId and aroundSeq.'
  }

  const lines: string[] = []
  if (conversation) {
    const title = conversation.title || 'untitled'
    const project = conversation.project || ''
    lines.push(`Conversation: ${title}  (${conversation.id})`)
    if (project) lines.push(`Project: ${project}`)
    lines.push('')
  }

  for (const entry of entries) {
    lines.push(renderEntry(entry, max))
    lines.push('')
  }

  const firstSeq = entries[0].seq
  const lastSeq = entries[entries.length - 1].seq
  const convId = conversation?.id ?? entries[0].conversationId ?? '<id>'
  lines.push(`─── walk ───`)
  lines.push(
    `Next:  get_transcript_context({ conversationId: "${convId}", aroundSeq: ${lastSeq + 5}, before: 5, after: 5 })`,
  )
  lines.push(
    `Prev:  get_transcript_context({ conversationId: "${convId}", aroundSeq: ${Math.max(0, firstSeq - 5)}, before: 5, after: 5 })`,
  )

  return lines.join('\n')
}

function renderEntry(entry: RawWindowEntry, maxBytes: number): string {
  const ts = entry.timestamp ? new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, 19) : ''
  const typeLabel = entry.subtype ? `${entry.type}/${entry.subtype}` : entry.type
  const header = `─── seq ${entry.seq}  ${typeLabel}  ${ts} ───`

  const body = extractReadableBody(entry)
  const truncated = capBytes(body, maxBytes)
  return `${header}\n${truncated}`
}

/**
 * Pull a single canonical text view from an entry. Walks the CC-shaped
 * `content.message.content[]` block array when present; falls back to a
 * shallow summary for our own internal event types.
 */
function extractReadableBody(entry: RawWindowEntry): string {
  const content = entry.content as Record<string, unknown> | null | undefined
  if (!content || typeof content !== 'object') return '<no content>'

  const message = content.message as Record<string, unknown> | undefined
  const blocks = message && Array.isArray(message.content) ? (message.content as unknown[]) : null

  if (blocks) {
    const parts = blocks.map(renderBlock).filter(Boolean)
    if (parts.length > 0) return parts.join('\n')
  }

  // CC sometimes puts plain text directly on message.content (string form)
  if (message && typeof message.content === 'string') return message.content

  // Top-level text field (some internal events)
  if (typeof content.text === 'string') return content.text
  if (typeof content.message === 'string') return content.message

  // Internal/structured events: render as compact JSON, no duplicate fields
  return compactJson(content)
}

type BlockRenderer = (b: Record<string, unknown>) => string

// tool_result duplicates content across `content`, `raw.toolUseResult.stdout`,
// `result.stdout`, and `toolUseResult.stdout`. `content` is canonical --
// everything else is the same bytes in a different wrapper.
const BLOCK_RENDERERS: Record<string, BlockRenderer> = {
  text: b => String(b.text ?? ''),
  thinking: b => {
    const t = String(b.thinking ?? '')
    return t ? `[thinking]\n${t}` : ''
  },
  tool_use: b => `[tool_use ${String(b.name ?? '?')}]\n${compactJson(b.input)}`,
  tool_result: b => {
    const errLabel = b.is_error === true ? ' ERROR' : ''
    const text = typeof b.content === 'string' ? b.content : compactJson(b.content)
    return `[tool_result${errLabel}]\n${text}`
  },
  image: b => {
    const source = b.source as Record<string, unknown> | undefined
    const mediaType = source ? String(source.media_type ?? source.type ?? 'image') : 'image'
    const data = source && typeof source.data === 'string' ? source.data : ''
    const sizeKb = Math.round((data.length * 3) / 4 / 1024) // base64 -> bytes
    return `[image ${mediaType}, ~${sizeKb}KB elided]`
  },
}

function renderBlock(block: unknown): string {
  if (!block || typeof block !== 'object') return ''
  const b = block as Record<string, unknown>
  const type = String(b.type ?? '')
  const renderer = BLOCK_RENDERERS[type]
  return renderer ? renderer(b) : `[${type || 'block'}] ${compactJson(b)}`
}

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(stripImagesDeep(value))
  } catch {
    return String(value)
  }
}

/**
 * Walk a value tree and replace any image source.data blobs with a stub.
 * Catches base64 hiding inside tool inputs or nested structures.
 */
function stripImagesDeep(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripImagesDeep)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === 'data' && typeof v === 'string' && v.length > 4096) {
      // Likely base64 blob (image, file, etc.)
      out[k] = `<${Math.round((v.length * 3) / 4 / 1024)}KB elided>`
    } else {
      out[k] = stripImagesDeep(v)
    }
  }
  return out
}

function capBytes(s: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(s, 'utf8')
  if (bytes <= maxBytes) return s
  // Cut on chars but show byte budget. Take roughly the first 60% and last 20%
  // so the head AND tail of large outputs are visible.
  const headChars = Math.floor((maxBytes * 0.6) / 2) // rough char->byte
  const tailChars = Math.floor((maxBytes * 0.2) / 2)
  const head = s.slice(0, headChars)
  const tail = s.slice(-tailChars)
  const omitted = bytes - Buffer.byteLength(head, 'utf8') - Buffer.byteLength(tail, 'utf8')
  return `${head}\n[... +${omitted}B omitted ...]\n${tail}`
}
