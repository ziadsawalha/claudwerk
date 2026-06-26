/** Deterministic multi-agent contention evidence, code-computed from edit
 *  tool-call args + timestamps already in the transcript store (NOT map-extracted).
 *  Lives in its own module so gather/types.ts stays a lean barrel. */

/** One conversation's stake in a file collision: when it touched the file, how
 *  hard, and whether it did so inside a worktree (where collisions are benign). */
export interface CollisionParty {
  conversationId: string
  /** Topmost spawn ancestor when known. Distinct roots across parties = the file
   *  was touched by INDEPENDENT agents, not one parent/child handoff. */
  rootConversationId?: string
  firstEditAt: number
  lastEditAt: number
  editCount: number
  /** True when this party's edits to the file landed under `.claude/worktrees/`. */
  inWorktree: boolean
}

/** One file edited by >=2 distinct conversations in the period -- the headline
 *  multi-agent collision signal. Grouped by ABSOLUTE path, so two agents editing
 *  the same logical file in SEPARATE worktrees never collide (that's the point of
 *  worktrees); two agents hitting the same path in `main` do. */
export interface FileCollision {
  /** Display path (worktree-relative where derivable, else trailing segments). */
  file: string
  parties: CollisionParty[]
  /** Two parties' [firstEdit,lastEdit] windows overlap -- a true concurrent edit. */
  concurrent: boolean
  /** >=2 distinct lineage roots among the parties -- independent agents stepping
   *  on each other, not a single chained handoff. The worktree-worthy case. */
  crossLineage: boolean
}

/** A conversation that edited OUTSIDE any worktree (the main checkout / repo root)
 *  while >=1 sibling in the same project was active in an overlapping window -- a
 *  WORK MODE "worktree always" risk even when no same-file collision landed. */
export interface MainTreeEdit {
  conversationId: string
  projectUri: string
  /** Edits that landed outside any `.claude/worktrees/` path. */
  mainTreeEditCount: number
  /** Sibling conversation ids active in an overlapping window in the same project. */
  concurrentSiblings: string[]
}

/** A spawn root that fanned out to several children active in the period -- the
 *  supervisor / batching candidate. */
export interface FanoutCluster {
  rootConversationId: string
  children: string[]
  /** Largest set of children whose activity windows mutually overlapped. */
  peakConcurrency: number
}

export interface ContentionDigest {
  fileCollisions: FileCollision[]
  mainTreeEdits: MainTreeEdit[]
  fanout: FanoutCluster[]
  /** No-silent-caps funnel: what was scanned vs surfaced (for the orchestrator log). */
  scanned: {
    conversationsWithEdits: number
    editEvents: number
    filesTouched: number
    collisionCandidates: number
  }
}

/** One mutation of a file by a conversation, with the lineage + worktree context
 *  needed to classify the collision it may be part of. Internal to the analyzer. */
export interface EditEvent {
  conversationId: string
  rootConversationId?: string
  file: string
  at: number
  inWorktree: boolean
}

/** A conversation's activity window in the period, for sibling/fanout overlap. */
export interface ConvWindow {
  projectUri: string
  rootConversationId?: string
  start: number
  end: number
}
