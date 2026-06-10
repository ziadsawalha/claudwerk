/**
 * SHIPPED REPORT (PLAN phase 4) -- the marquee new fleet deliverable. Proves the
 * `shipped-report` template end-to-end over synthetic facts:
 *   1. it loads + validates;
 *   2. BOTH option wires fire -- the technical wire (include_cost -> `cost` signal,
 *      commit_stats -> `commits` signal, resolved by resolveRecipe) AND the
 *      prompt-tweak wire (group_by_project / terse / include_cost / commit_stats
 *      booleans flipping the rendered Liquid directives);
 *   3. the rendered prompt carries the frontmatter contract (FRONTMATTER_SPEC) so
 *      a model response round-trips parseRecapOutput -- a valid, parseable recap;
 *   4. oneshot + synthesize share the contract tail (no path drift).
 * No live LLM call -- the live fleet run is documented + deferred in STATE.
 */
import { describe, expect, test } from 'bun:test'
import type { RecapSignal } from '../../../../shared/protocol'
import { makePromptInputs } from '../../__tests__/synthetic-fixtures'
import { loadTemplates, type RecapTemplate, resolveOptionFlags } from '../../templates'
import { makeEmptyMetadata } from '../chunk/merge'
import { buildSynthesizePrompt, type SynthesizeContext } from '../chunk/synthesize-prompt'
import { resolveRecipe, type StartArgs } from '../orchestrator'
import { buildPrompt, FRONTMATTER_SPEC, HUMAN_BODY_SPEC } from './prompt-builder'

function shippedTemplate(): RecapTemplate {
  const t = loadTemplates().templates.get('shipped-report')
  if (!t) throw new Error('shipped-report template did not load')
  return t
}

function makeArgs(extra: Partial<StartArgs> = {}): StartArgs {
  return { type: 'recap_create', projectUri: '*', period: { label: 'last_7' }, timeZone: 'UTC', ...extra }
}

const SYNTH_CTX: SynthesizeContext = {
  projectLabel: 'all projects',
  periodHuman: 'Last 7 days',
  periodIsoRange: '2026-05-28 to 2026-06-04',
}

/** Render the oneshot system prompt with the shipped-report template + overrides. */
function renderOneshot(overrides: Record<string, boolean> = {}): string {
  const template = shippedTemplate()
  return buildPrompt(makePromptInputs('small'), 'human', false, false, {
    template,
    optionFlags: resolveOptionFlags(template, overrides),
  }).system
}

describe('shipped-report: loads + validates', () => {
  test('the template is present, fleet-scoped, human audience, with the five declared options', () => {
    const t = shippedTemplate()
    expect(t.id).toBe('shipped-report')
    expect(t.scope).toBe('fleet')
    expect(t.audience).toBe('human')
    expect(t.options.map(o => o.id).sort()).toEqual([
      'commit_stats',
      'group_by_project',
      'include_cost',
      'link_conversations',
      'terse',
    ])
  })

  test('the option->signal declarations: include_cost/commit_stats are technical, the rest pure prompt-tweaks', () => {
    const signalOf = (id: string) => shippedTemplate().options.find(o => o.id === id)?.signal
    expect(signalOf('include_cost')).toBe('cost')
    expect(signalOf('commit_stats')).toBe('commits')
    expect(signalOf('group_by_project')).toBeUndefined()
    expect(signalOf('terse')).toBeUndefined()
    expect(signalOf('link_conversations')).toBeUndefined()
  })
})

describe('shipped-report: TECHNICAL option wire (signals, via resolveRecipe)', () => {
  test('defaults -> commits on (commit_stats default true), cost off (include_cost default false)', () => {
    const r = resolveRecipe(makeArgs({ template: 'shipped-report' }))
    expect(r.templateId).toBe('shipped-report')
    expect(r.audience).toBe('human')
    expect(r.optionFlags).toEqual({
      group_by_project: true,
      include_cost: false,
      commit_stats: true,
      terse: false,
      link_conversations: true,
    })
    expect(r.signals).toContain('commits')
    expect(r.signals).not.toContain('cost')
    // base = defaults.signals = [user_prompts, assistant_final_turn, commits, task_results]
    expect(r.signals).toEqual(['assistant_final_turn', 'commits', 'task_results', 'user_prompts'] as RecapSignal[])
  })

  test('include_cost=true ADDS the cost signal', () => {
    const r = resolveRecipe(makeArgs({ template: 'shipped-report', options: { include_cost: true } }))
    expect(r.signals).toContain('cost')
  })

  test('commit_stats=false REMOVES the commits signal', () => {
    const r = resolveRecipe(makeArgs({ template: 'shipped-report', options: { commit_stats: false } }))
    expect(r.signals).not.toContain('commits')
  })
})

describe('shipped-report: PROMPT-TWEAK option wire (Liquid booleans flip the text)', () => {
  test('defaults render the ship-log framing + grouping + stats + no-cost + narrative', () => {
    const sys = renderOneshot()
    expect(sys).toContain('compiling a SHIPPED REPORT')
    expect(sys).toContain('## Features shipped')
    // group_by_project default true
    expect(sys).toContain('GROUP every item under a "### <project>" heading')
    // commit_stats default true
    expect(sys).toContain('include its commit stats')
    // include_cost default false
    expect(sys).toContain('Do NOT mention cost')
    // terse default false
    expect(sys).toContain('narrative intro per section')
    // link_conversations default true -> attribution on, no "just the data" override
    expect(sys).toContain('and conversation id(s) (8-char)')
    expect(sys).not.toContain('NO CONVERSATION LINKS')
  })

  test('link_conversations=false drops conversation attribution (just-the-data ship log)', () => {
    const sys = renderOneshot({ link_conversations: false })
    expect(sys).toContain('NO CONVERSATION LINKS')
    expect(sys).toContain('do NOT include conversation ids')
    // the attribution directive is replaced, not retained
    expect(sys).not.toContain('and conversation id(s) (8-char)')
  })

  test('group_by_project=false flips to the fleet-wide listing directive', () => {
    const sys = renderOneshot({ group_by_project: false })
    expect(sys).toContain('do NOT group by project')
    expect(sys).not.toContain('GROUP every item under a "### <project>" heading')
  })

  test('terse=true flips to one-line-per-item', () => {
    const sys = renderOneshot({ terse: true })
    expect(sys).toContain('One line per shipped item')
    expect(sys).not.toContain('narrative intro per section')
  })

  test('include_cost=true adds the Cost section directive', () => {
    const sys = renderOneshot({ include_cost: true })
    expect(sys).toContain('## Cost')
    expect(sys).not.toContain('Do NOT mention cost')
  })

  test('commit_stats=false drops the stats column directive', () => {
    const sys = renderOneshot({ commit_stats: false })
    expect(sys).toContain('OMIT the files/+/- stats')
    expect(sys).not.toContain('include its commit stats')
  })
})

describe('shipped-report: valid + parseable contract, no path drift', () => {
  test('the rendered prompt embeds the frontmatter contract (round-trips the parser)', () => {
    const sys = renderOneshot()
    expect(sys).toContain(FRONTMATTER_SPEC)
    expect(sys).toContain(HUMAN_BODY_SPEC)
  })

  test('oneshot + synthesize share the IDENTICAL frontmatter+body contract block', () => {
    const template = shippedTemplate()
    const presentation = { template, optionFlags: resolveOptionFlags(template, {}) }
    const oneshot = buildPrompt(makePromptInputs('small'), 'human', false, false, presentation).system
    const synthesize = buildSynthesizePrompt(makeEmptyMetadata(), SYNTH_CTX, 'human', false, false, presentation).system
    const contract = `${FRONTMATTER_SPEC}\n\n${HUMAN_BODY_SPEC}`
    expect(oneshot).toContain(contract)
    expect(synthesize).toContain(contract)
    // The framing legitimately differs (compile-from-transcripts vs synthesize-merged).
    expect(oneshot).toContain('compiling a SHIPPED REPORT')
    expect(synthesize).toContain('SYNTHESIZING the final SHIPPED REPORT')
  })
})
