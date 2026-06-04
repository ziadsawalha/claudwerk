/**
 * AGENT byte-identity gate -- the agent twin of anchor-prompt.test.ts (PLAN
 * phase 4). Phase 4 routes the AGENT path through the template seam: the default
 * `agent-handoff` template must reproduce the previous hard-coded agent
 * orientation brief BYTE-FOR-BYTE on BOTH the oneshot (`buildPrompt`) and the
 * synthesize (`buildSynthesizePrompt`) paths, across the retrospect /
 * customer-friendly layers. The golden was captured from the PRE-template agent
 * output; if this fails, templating the agent path silently changed the default
 * agent deliverable -- fix the template, never the golden.
 */
import { describe, expect, test } from 'bun:test'
import { makePromptInputs } from '../../__tests__/synthetic-fixtures'
import { AGENT_TEMPLATE_ID, loadTemplates } from '../../templates'
import { makeEmptyMetadata } from '../chunk/merge'
import { buildSynthesizePrompt, type SynthesizeContext } from '../chunk/synthesize-prompt'
import golden from './__golden__/agent-prompt.golden.json'
import { buildPrompt } from './prompt-builder'

type GoldenEntry = { system: string; user: string }
const G = golden as Record<string, GoldenEntry>

type Variant = [name: string, retrospect: boolean, customerFriendly: boolean]
const VARIANTS: Variant[] = [
  ['agent-default', false, false],
  ['agent-retro', true, false],
  ['agent-cf', false, true],
  ['agent-retro-cf', true, true],
]

const SYNTH_CTX: SynthesizeContext = {
  projectLabel: 'remote-claude',
  periodHuman: 'this week',
  periodIsoRange: '2026-05-22..2026-05-29',
}

describe('agent: agent-handoff template reproduces the pre-template agent prompt byte-for-byte', () => {
  for (const size of ['small', 'medium'] as const) {
    const inputs = makePromptInputs(size)
    for (const [name, retrospect, customerFriendly] of VARIANTS) {
      test(`oneshot ${size}|${name}`, () => {
        const expected = G[`oneshot|${size}|${name}`]
        expect(expected).toBeDefined()
        const out = buildPrompt(inputs, 'agent', retrospect, customerFriendly)
        expect(out.system).toBe(expected.system)
        expect(out.user).toBe(expected.user)
      })
    }
  }

  for (const [name, retrospect, customerFriendly] of VARIANTS) {
    test(`synthesize ${name}`, () => {
      const expected = G[`synthesize|${name}`]
      expect(expected).toBeDefined()
      const out = buildSynthesizePrompt(makeEmptyMetadata(), SYNTH_CTX, 'agent', retrospect, customerFriendly)
      expect(out.system).toBe(expected.system)
      expect(out.user).toBe(expected.user)
    })
  }

  test('the default agent template is the agent-handoff anchor, and it actually loads (no silent fallback)', () => {
    const { templates } = loadTemplates()
    const picked = templates.get(AGENT_TEMPLATE_ID)
    expect(picked?.id).toBe('agent-handoff')
    expect(picked?.audience).toBe('agent')
    // The default agent prompt must be the rendered template, not the in-code
    // fallback: prove the rendered output matches the golden exactly.
    const out = buildPrompt(makePromptInputs('small'), 'agent', false, false)
    expect(out.system).toBe(G['oneshot|small|agent-default'].system)
  })
})
