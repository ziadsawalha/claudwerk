import type {
  CollisionParty,
  ConvWindow,
  EditEvent,
  FanoutCluster,
  FileCollision,
  MainTreeEdit,
} from './contention-types'

const MAX_SIBLINGS = 8

/** Group edit events by absolute file path; keep files >=2 distinct conversations
 *  touched, ranked so concurrent cross-lineage collisions surface first. */
export function buildCollisions(
  events: EditEvent[],
  windows: Map<string, ConvWindow>,
  worktreeMarker: string,
): FileCollision[] {
  const byFile = new Map<string, EditEvent[]>()
  for (const e of events) {
    const list = byFile.get(e.file)
    if (list) list.push(e)
    else byFile.set(e.file, [e])
  }
  const collisions: FileCollision[] = []
  for (const [file, list] of byFile) {
    const parties = partiesFor(list)
    if (parties.length < 2) continue
    collisions.push({
      file: shortenPath(file, worktreeMarker),
      parties,
      concurrent: anyOverlap(parties, windows),
      crossLineage: new Set(parties.map(p => p.rootConversationId ?? p.conversationId)).size >= 2,
    })
  }
  return collisions.sort(rankCollisions)
}

/** Fold a file's events into one party per conversation. */
function partiesFor(list: EditEvent[]): CollisionParty[] {
  const byConv = new Map<string, CollisionParty>()
  for (const e of list) {
    const p = byConv.get(e.conversationId)
    if (!p) {
      byConv.set(e.conversationId, {
        conversationId: e.conversationId,
        ...(e.rootConversationId ? { rootConversationId: e.rootConversationId } : {}),
        firstEditAt: e.at,
        lastEditAt: e.at,
        editCount: 1,
        inWorktree: e.inWorktree,
      })
      continue
    }
    p.firstEditAt = Math.min(p.firstEditAt, e.at)
    p.lastEditAt = Math.max(p.lastEditAt, e.at)
    p.editCount++
    p.inWorktree = p.inWorktree && e.inWorktree
  }
  return [...byConv.values()]
}

/** True when any two parties were live at once -- their CONVERSATION activity
 *  windows overlap (both agents alive while both touched the file). Falls back to
 *  the edit span when a window is missing. This is the real race signal; two edits
 *  minutes apart from overlapping sessions still count as concurrent. */
function anyOverlap(parties: CollisionParty[], windows: Map<string, ConvWindow>): boolean {
  const spans = parties.map(p => {
    const w = windows.get(p.conversationId)
    return w ? { start: w.start, end: w.end } : { start: p.firstEditAt, end: p.lastEditAt }
  })
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i].start <= spans[j].end && spans[j].start <= spans[i].end) return true
    }
  }
  return false
}

/** concurrent+crossLineage first, then concurrent, then crossLineage, then volume. */
function rankCollisions(a: FileCollision, b: FileCollision): number {
  const score = (c: FileCollision) => (c.concurrent ? 2 : 0) + (c.crossLineage ? 1 : 0)
  const s = score(b) - score(a)
  if (s !== 0) return s
  return totalEdits(b) - totalEdits(a)
}

function totalEdits(c: FileCollision): number {
  return c.parties.reduce((n, p) => n + p.editCount, 0)
}

/** Conversations that edited OUTSIDE a worktree while a sibling overlapped. */
export function buildMainTreeEdits(events: EditEvent[], windows: Map<string, ConvWindow>): MainTreeEdit[] {
  const mainCounts = new Map<string, number>()
  for (const e of events) {
    if (e.inWorktree) continue
    mainCounts.set(e.conversationId, (mainCounts.get(e.conversationId) ?? 0) + 1)
  }
  const out: MainTreeEdit[] = []
  for (const [convId, count] of mainCounts) {
    const win = windows.get(convId)
    if (!win) continue
    const siblings = concurrentSiblings(convId, win, windows)
    if (!siblings.length) continue
    out.push({
      conversationId: convId,
      projectUri: win.projectUri,
      mainTreeEditCount: count,
      concurrentSiblings: siblings,
    })
  }
  return out.sort(
    (a, b) => b.concurrentSiblings.length - a.concurrentSiblings.length || b.mainTreeEditCount - a.mainTreeEditCount,
  )
}

/** Other conversations in the same project whose activity window overlaps `win`. */
function concurrentSiblings(convId: string, win: ConvWindow, windows: Map<string, ConvWindow>): string[] {
  const siblings: string[] = []
  for (const [otherId, other] of windows) {
    if (otherId === convId || other.projectUri !== win.projectUri) continue
    if (win.start <= other.end && other.start <= win.end) siblings.push(otherId)
    if (siblings.length >= MAX_SIBLINGS) break
  }
  return siblings
}

/** Spawn roots with >=2 children active in the period, ranked by peak concurrency. */
export function buildFanout(windows: Map<string, ConvWindow>): FanoutCluster[] {
  const byRoot = new Map<string, string[]>()
  for (const [convId, win] of windows) {
    const root = win.rootConversationId
    if (!root || root === convId) continue
    const kids = byRoot.get(root)
    if (kids) kids.push(convId)
    else byRoot.set(root, [convId])
  }
  const out: FanoutCluster[] = []
  for (const [root, children] of byRoot) {
    if (children.length < 2) continue
    out.push({ rootConversationId: root, children, peakConcurrency: peakOverlap(children, windows) })
  }
  return out.sort((a, b) => b.peakConcurrency - a.peakConcurrency || b.children.length - a.children.length)
}

/** Largest count of children whose windows overlap any single child's window. */
function peakOverlap(children: string[], windows: Map<string, ConvWindow>): number {
  let peak = 1
  for (const a of children) {
    const wa = windows.get(a)
    if (!wa) continue
    let n = 1
    for (const b of children) {
      if (b === a) continue
      const wb = windows.get(b)
      if (wb && wa.start <= wb.end && wb.start <= wa.end) n++
    }
    peak = Math.max(peak, n)
  }
  return peak
}

/** Display-only path trim (keeps the worktree name + tail, else the trailing
 *  segments). Pure string formatting of a tool-arg -- never identity logic. */
function shortenPath(path: string, worktreeMarker: string): string {
  const wt = path.indexOf(worktreeMarker)
  if (wt !== -1) return `worktrees/${path.slice(wt + worktreeMarker.length)}`
  const segs = path.split('/').filter(Boolean)
  return segs.length <= 4 ? path : `.../${segs.slice(-4).join('/')}`
}
