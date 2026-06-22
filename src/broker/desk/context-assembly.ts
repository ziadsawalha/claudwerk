/**
 * The dispatch loop's CONTEXT ASSEMBLY (plan-dispatcher-brain.md P6). Every turn
 * the dispatcher's context is BUILT FRESH and TOKEN-BOUNDED from four layers, so
 * it operates from condensed memory + a short window -- never a hoard of raw log:
 *
 *   UNIVERSE  -- the fleet by project (live / needs-you counts): the lay of the land.
 *   MEMORY    -- the maintained per-project condensed briefs (P3), most-relevant
 *                first, trimmed to the budget (the rest reachable via project_brief).
 *   DURABLE   -- the small durable notes file (user prefs / stable facts).
 *   RECENT    -- the last ~30 min of this dispatch session (continuity, P6).
 *
 * Pure -- takes the overview rows + notes + window, returns the context string.
 */

import type { ProjectOverviewRow } from './overview'
import type { RecentTurn } from './recent-window'

export interface AssembleInput {
  rows: ProjectOverviewRow[]
  durableMemory: string
  recent: RecentTurn[]
  /** Soft budget for the WHOLE assembled context (tokens ~= chars / 4). */
  tokenBudget?: number
}

const DEFAULT_TOKEN_BUDGET = 3000
const RECENT_TURN_CHARS = 280

function trim(s: string, n: number): string {
  const t = s.trim()
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`
}

function universeLine(r: ProjectOverviewRow): string | null {
  if (r.live === 0 && !r.brief) return null
  if (r.live === 0) return `- ${r.project}: idle (in memory)`
  const bits = [`${r.live} live`]
  if (r.working) bits.push(`${r.working} working`)
  if (r.needsYou) bits.push(`${r.needsYou} needs-you`)
  if (r.idleMin !== undefined) bits.push(`idle ${r.idleMin}m`)
  return `- ${r.project}: ${bits.join(', ')}`
}

function buildRecent(recent: RecentTurn[]): string {
  if (!recent.length) return ''
  const turns = recent.map(t => `you: ${trim(t.intent, RECENT_TURN_CHARS)}\ndesk: ${trim(t.reply, RECENT_TURN_CHARS)}`)
  return `RECENT (this session):\n${turns.join('\n\n')}`
}

/** Assemble the per-turn context block fed to the agent loop. */
export function assembleContext(input: AssembleInput): string {
  const charBudget = (input.tokenBudget ?? DEFAULT_TOKEN_BUDGET) * 4
  const sections: string[] = []

  const universe = input.rows.map(universeLine).filter((l): l is string => l !== null)
  if (universe.length) sections.push(`FLEET (by project):\n${universe.join('\n')}`)

  if (input.durableMemory.trim()) sections.push(`DURABLE NOTES:\n${input.durableMemory.trim()}`)

  const recent = buildRecent(input.recent)
  if (recent) sections.push(recent)

  // Briefs consume the remaining budget, in the rows' attention/recency order.
  const used = sections.join('\n\n').length
  let remaining = charBudget - used
  const briefRows = input.rows.filter(r => r.brief)
  const briefBlocks: string[] = []
  let dropped = 0
  for (const r of briefRows) {
    const block = `## ${r.project}\n${r.brief}`
    if (block.length + 2 <= remaining) {
      briefBlocks.push(block)
      remaining -= block.length + 2
    } else {
      dropped++
    }
  }
  if (briefBlocks.length) {
    const tail = dropped
      ? `\n\n(+${dropped} more project${dropped > 1 ? 's' : ''} in memory -- use project_brief / recall)`
      : ''
    sections.push(`PROJECT MEMORY (condensed):\n${briefBlocks.join('\n\n')}${tail}`)
  } else if (dropped) {
    sections.push(`PROJECT MEMORY: ${dropped} project briefs available -- use project_brief / recall.`)
  }

  return sections.join('\n\n')
}
