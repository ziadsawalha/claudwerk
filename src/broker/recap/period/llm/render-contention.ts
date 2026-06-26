import type { ContentionDigest, FileCollision } from '../gather/contention-types'
import { shortId } from './render-transcripts'

/**
 * Render the CONTENTION prompt block: deterministic multi-agent friction mined
 * from edit tool-call args. Authoritative, NOT map-extracted -- the LLM grounds
 * its recommendations in these facts and must not invent collisions beyond them.
 *
 * Empty / absent -> '' so the section is omitted (the caller filters falsy parts).
 */
export function renderContentionSection(contention?: ContentionDigest): string {
  if (!contention) return ''
  const { fileCollisions, mainTreeEdits, fanout } = contention
  if (!fileCollisions.length && !mainTreeEdits.length && !fanout.length) return ''
  const parts = [
    'CONTENTION (DETERMINISTIC multi-agent friction mined from edit tool-calls -- ' +
      'authoritative facts; ground recommendations in these, never invent beyond them):',
    renderCollisions(fileCollisions),
    renderMainTree(mainTreeEdits),
    renderFanout(fanout),
  ]
  return parts.filter(Boolean).join('\n\n')
}

/** Same-file collisions, the headline signal. */
function renderCollisions(collisions: FileCollision[]): string {
  if (!collisions.length) return ''
  const lines = collisions.map(c => {
    const flags = [c.concurrent ? 'CONCURRENT' : '', c.crossLineage ? 'INDEPENDENT-AGENTS' : '']
      .filter(Boolean)
      .join(' + ')
    const parties = c.parties
      .map(p => `${shortId(p.conversationId)}${p.inWorktree ? '(worktree)' : '(main)'} x${p.editCount}`)
      .join(', ')
    return `  ${c.file}${flags ? ` [${flags}]` : ''}: ${parties}`
  })
  return `SAME-FILE COLLISIONS (${collisions.length}) -- files >=2 conversations edited:\n${lines.join('\n')}`
}

/** Main-tree edits while siblings ran -- the worktree-discipline risk. */
function renderMainTree(edits: ContentionDigest['mainTreeEdits']): string {
  if (!edits.length) return ''
  const lines = edits.map(
    e =>
      `  ${shortId(e.conversationId)}: ${e.mainTreeEditCount} edit(s) OUTSIDE any worktree while ` +
      `${e.concurrentSiblings.length} sibling(s) active (${e.concurrentSiblings.map(shortId).join(', ')})`,
  )
  return `MAIN-TREE EDITS WHILE BUSY (${edits.length}) -- worked in the shared checkout, not a worktree:\n${lines.join('\n')}`
}

/** Spawn fan-out clusters -- supervisor/batching candidates. */
function renderFanout(fanout: ContentionDigest['fanout']): string {
  if (!fanout.length) return ''
  const lines = fanout.map(
    f =>
      `  root ${shortId(f.rootConversationId)}: ${f.children.length} children, ` +
      `peak ${f.peakConcurrency} active at once (${f.children.map(shortId).join(', ')})`,
  )
  return `SPAWN FAN-OUT (${fanout.length}) -- one root spawned several concurrent children:\n${lines.join('\n')}`
}
