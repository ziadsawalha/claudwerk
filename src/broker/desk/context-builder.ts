/**
 * Active per-project context BUILDER (plan-dispatcher-brain.md P4). Beyond the
 * passive event-fed memory, the dispatcher can LEARN a project hands-on: it
 * launches a small Haiku SCOUT conversation INSIDE the project that skims the
 * README, the structure, recent git log and plans, then reports a condensed
 * brief back into the project's memory via the `report_project_context` MCP
 * tool. Used for an unfamiliar or stale project, on demand.
 *
 * The scout prompt is pure (testable); the launch takes an injected spawn fn so
 * it tests without a live sentinel.
 */

import type { DeskProject } from './projects'

const SCOUT_MODEL = 'haiku'

export type SpawnFn = (req: { cwd: string; intent: string; model?: string }) => Promise<{ conversationId: string }>

/** The tight, read-only scout brief. It must end by reporting back to memory. */
export function buildScoutPrompt(label: string, projectUri: string): string {
  return [
    `You are a SCOUT for the front desk dispatcher. Explore THIS project ("${label}") and report a tiny durable brief back into the dispatcher's memory.`,
    '',
    'Spend only a couple of minutes. Skim, do not deep-read:',
    '- the README / package manifest (what is this project?),',
    '- the top-level directory structure,',
    '- the most recent git log (what is being worked on?),',
    '- any .claude/docs or plan files (current goals / state).',
    '',
    'Then write a SHORT brief (under 800 characters): what this project IS, its current',
    'goals / workstreams, key topics + entities, and where things stand. Plain prose.',
    '',
    `Finally call the \`report_project_context\` tool with project="${projectUri}" and your brief.`,
    'Do NOT modify anything, do NOT write files, do NOT run builds. Explore and report only.',
  ].join('\n')
}

/** Launch the scout into the project. Throws if the project has no local path. */
export async function launchProjectScout(
  dp: DeskProject,
  spawn: SpawnFn,
  model: string = SCOUT_MODEL,
): Promise<{ conversationId: string }> {
  if (!dp.cwd) throw new Error(`project "${dp.label}" has no local filesystem path to explore`)
  return spawn({ cwd: dp.cwd, intent: buildScoutPrompt(dp.label, dp.projectUri), model })
}
