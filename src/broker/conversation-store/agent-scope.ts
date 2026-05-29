import type { TranscriptEntry } from '../../shared/protocol'

/**
 * Agent-scope discriminant for a transcript entry.
 *
 * The parent stream is the `agent_id IS NULL` scope (user input + the main
 * agent's replies). Inline-agent (Task-tool subagent) entries are tagged with
 * one of two discriminants when they leave the host:
 *   - `task_id`              -- system task_progress / task_notification frames
 *   - `parent_tool_use_id`   -- assistant / user subagent messages
 *
 * A genuine parent entry carries NEITHER. So any entry that does carry one
 * belongs to a sub-scope and must never be stored as `agent_id IS NULL`.
 *
 * Returns the agent scope id (the discriminant value), or `null` for a real
 * parent entry. This is the broker-side defense-in-depth backstop for the host
 * containment (Checkpoint A): a stale host binary that re-leaks agent chatter
 * into the parent stream gets caught here and diverted to its agent scope.
 *
 * NOTE: the scope id derived from `task_id` matches the host's agentId (the
 * host keys agents by task id), so a diverted system frame lands in the SAME
 * scope as that agent's legit entries -- no fragmentation for the common case.
 */
function firstNonEmptyString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v
  }
  return null
}

export function agentScopeOf(entry: TranscriptEntry): string | null {
  const e = entry as Record<string, unknown>
  // task_id wins (system task frames); else parent_tool_use_id (assistant/user).
  return (
    firstNonEmptyString(e.task_id, e.taskId) ??
    firstNonEmptyString(e.parent_tool_use_id, e.parentToolUseId, e.parentToolUseID)
  )
}

export interface PartitionedEntries {
  /** Genuine parent-stream entries (`agent_id IS NULL`). */
  parent: TranscriptEntry[]
  /** Per-agent sub-batches, keyed by agent scope id. Insertion order preserved
   *  within each scope so seq stamping stays monotonic. */
  agents: Map<string, TranscriptEntry[]>
}

/**
 * Split a batch into genuine parent entries and per-agent sub-batches, using
 * {@link agentScopeOf}. Order within each scope is preserved. Pure -- no I/O,
 * no mutation of the input entries.
 */
export function partitionByAgentScope(entries: TranscriptEntry[]): PartitionedEntries {
  const parent: TranscriptEntry[] = []
  const agents = new Map<string, TranscriptEntry[]>()
  for (const entry of entries) {
    const scope = agentScopeOf(entry)
    if (scope === null) {
      parent.push(entry)
      continue
    }
    const bucket = agents.get(scope)
    if (bucket) bucket.push(entry)
    else agents.set(scope, [entry])
  }
  return { parent, agents }
}
