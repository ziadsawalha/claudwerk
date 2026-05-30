import type { PeriodTurn } from '../../shared/transcript-extract'

export interface PeriodScope {
  /** Project URIs in scope (parent + worktree rollup, or '*' resolved to all). */
  projectUris: string[]
  periodStart: number
  periodEnd: number
  timeZone: string
}

export interface ConversationDigest {
  id: string
  title: string
  projectUri: string
  status: string
  createdAt: number
  updatedAt: number
  turnCount: number
}

export interface TranscriptDigest {
  conversationId: string
  conversationTitle: string
  turns: PeriodTurn[]
}

export interface CostDigest {
  totalCostUsd: number
  totalTurns: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCacheReadTokens: number
  totalCacheWriteTokens: number
  perDay: Array<{
    day: string
    costUsd: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    turns: number
  }>
  perModel: Array<{ model: string; costUsd: number; inputTokens: number; outputTokens: number; turns: number }>
  perConversation: Array<{ conversationId: string; costUsd: number; tokens: number; turns: number }>
  perProject: Array<{ projectUri: string; costUsd: number; tokens: number; turns: number; conversations: number }>
  /** Pillar E: conversations bucketed by the MAX context window they reached
   *  (max over turns of input + cacheRead + cacheWrite tokens), with the cost +
   *  cache-write tax each bucket carries -> the cost-penalty-of-long-context curve.
   *  Derived from existing per-turn token fields (no new instrumentation). */
  contextBuckets: ContextBucket[]
}

export interface ContextBucket {
  /** Human label, e.g. "<100k", "100-200k", "700k+". */
  bucket: string
  /** Lower bound of the bucket in tokens (for ordering / charting). */
  lowerTokens: number
  /** How many conversations peaked in this context band. */
  conversations: number
  /** Total $ spent by conversations in this band (cost-penalty signal). */
  costUsd: number
  /** Total cache-write (re-warm) tokens spent by conversations in this band. */
  cacheWriteTokens: number
  /** Total turns across conversations in this band. */
  turns: number
}

export interface TaskDigest {
  doneInPeriod: Array<{ id: string; conversationId: string; name: string; updatedAt: number }>
  createdInPeriod: Array<{ id: string; conversationId: string; name: string; createdAt: number; status: string }>
  inProgress: Array<{ id: string; conversationId: string; name: string }>
}

export interface ToolUseDigest {
  perConversation: Array<{
    conversationId: string
    perTool: Array<{ tool: string; count: number }>
    total: number
  }>
}

export interface ErrorDigest {
  incidents: Array<{
    conversationId: string
    timestamp: number
    subtype: string
    summary: string
  }>
}

export interface OpenQuestionDigest {
  /** Conversations whose final assistant message ends with an unanswered question. */
  conversationsWithOpenQuestions: Array<{
    conversationId: string
    conversationTitle: string
    lastUserPrompt: string
    finalAssistantText: string
    openQuestions: string[]
    timestamp: number
  }>
}

export interface CommitDigest {
  perProject: Array<{
    projectUri: string
    cwd: string
    commits: CommitEntry[]
    error?: string
  }>
}

/** One forgotten thread: an INVESTED conversation that was abandoned BEFORE the
 *  period window and ended on an unanswered question (open loop). Surfaced so the
 *  user/agent sees long-dropped work they may want to resume. Deterministic --
 *  NOT extracted by the map stage (these conversations are outside the chunks). */
export interface ForgottenThread {
  conversationId: string
  /** May be '' -- 77% of forgotten threads are untitled; the synthesis LLM
   *  writes a one-line label from lastUserPrompt + finalAssistantText. */
  conversationTitle: string
  projectUri: string
  /** Whole days since last_activity (the "how long ago did I drop this"). */
  idleDays: number
  /** All-time recorded turns -- the investment signal. */
  turnCount: number
  /** The user's last prompt before the thread went cold (context for the label). */
  lastUserPrompt: string
  /** The assistant's final message (truncated) -- where the thread was left. */
  finalAssistantText: string
  /** The trailing question(s) the user never answered (the open loop). */
  openQuestions: string[]
}

export interface ForgottenThreadDigest {
  /** Open-loop survivors, ranked by investment then abandonment, capped. */
  threads: ForgottenThread[]
  /** Stale+invested candidates BEFORE the open-loop hard filter (for the
   *  "N more not shown" line + the orchestrator's no-silent-caps log). */
  candidateCount: number
  /** How many candidate tails were probed for an open loop (working-set bound). */
  probed: number
}

export interface CommitEntry {
  sha: string
  isoDate: string
  author: string
  subject: string
  body: string
  filesChanged?: number
  insertions?: number
  deletions?: number
}
