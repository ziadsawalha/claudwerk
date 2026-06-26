import type { StoreDriver, TranscriptEntryRecord } from '../../../store/types'
import { buildCollisions, buildFanout, buildMainTreeEdits } from './contention-analyze'
import type { ContentionDigest, ConvWindow, EditEvent } from './contention-types'
import type { ConversationDigest, PeriodScope } from './types'

/** Edit tools whose `input.file_path` (NotebookEdit: `notebook_path`) is the file
 *  a conversation mutated. The collision signal is built from these args alone. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const WORKTREE_MARKER = '/.claude/worktrees/'

const MAX_COLLISIONS = 30
const MAX_MAIN_TREE = 25
const MAX_FANOUT = 15

/**
 * CONTENTION (period-global, deterministic -- NOT map-extracted).
 *
 * Mines the Edit/Write/MultiEdit/NotebookEdit tool-call args + timestamps already
 * in the transcript store and correlates them into the multi-agent friction the
 * narrative corpus cannot show: the SAME file touched by independent agents, edits
 * landing in `main` while siblings ran, and spawn roots that fanned out wide.
 * Pure evidence -- the LLM turns it into recommendations, never the other way.
 * Gated behind the `contention` signal so only agentic recaps pay for the mining.
 */
export function gatherContention(
  store: StoreDriver,
  conversations: ConversationDigest[],
  scope: PeriodScope,
): ContentionDigest {
  const windows = new Map<string, ConvWindow>()
  const events: EditEvent[] = []
  let conversationsWithEdits = 0
  for (const conv of conversations) {
    windows.set(conv.id, {
      projectUri: conv.projectUri,
      ...(conv.rootConversationId ? { rootConversationId: conv.rootConversationId } : {}),
      start: conv.createdAt,
      end: conv.updatedAt,
    })
    const convEvents = editEventsFor(store, conv, scope)
    if (convEvents.length) conversationsWithEdits++
    events.push(...convEvents)
  }

  const collisions = buildCollisions(events, windows, WORKTREE_MARKER)
  return {
    fileCollisions: collisions.slice(0, MAX_COLLISIONS),
    mainTreeEdits: buildMainTreeEdits(events, windows).slice(0, MAX_MAIN_TREE),
    fanout: buildFanout(windows).slice(0, MAX_FANOUT),
    scanned: {
      conversationsWithEdits,
      editEvents: events.length,
      filesTouched: new Set(events.map(e => e.file)).size,
      collisionCandidates: collisions.length,
    },
  }
}

/** Extract every edit event from one conversation's assistant turns in the period. */
function editEventsFor(store: StoreDriver, conv: ConversationDigest, scope: PeriodScope): EditEvent[] {
  const entries = store.transcripts.find(conv.id, {
    after: scope.periodStart,
    before: scope.periodEnd,
    types: ['assistant'],
    limit: 5_000,
  })
  const out: EditEvent[] = []
  for (const entry of entries) {
    for (const file of editedFiles(entry)) {
      out.push({
        conversationId: conv.id,
        ...(conv.rootConversationId ? { rootConversationId: conv.rootConversationId } : {}),
        file,
        at: entry.timestamp,
        inWorktree: file.includes(WORKTREE_MARKER),
      })
    }
  }
  return out
}

/** File paths mutated by the edit tool_use blocks of one assistant entry. */
function editedFiles(entry: TranscriptEntryRecord): string[] {
  const blocks = (entry.content as { message?: { content?: unknown } }).message?.content
  if (!Array.isArray(blocks)) return []
  const files: string[] = []
  for (const b of blocks) {
    const path = editedPath(b)
    if (path) files.push(path)
  }
  return files
}

/** The file an edit tool_use block mutated, or null if the block isn't an edit. */
function editedPath(b: unknown): string | null {
  if (!isToolUse(b) || !EDIT_TOOLS.has(b.name)) return null
  const input = (b.input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
  const path = typeof input.file_path === 'string' ? input.file_path : input.notebook_path
  return typeof path === 'string' && path ? path : null
}

function isToolUse(b: unknown): b is { type: 'tool_use'; name: string; input?: unknown } {
  return typeof b === 'object' && b !== null && (b as { type?: string }).type === 'tool_use'
}
