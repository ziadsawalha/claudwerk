/**
 * ANCHOR regression -- THE GATE for the recap-templates chain (PLAN sections 6,
 * 9, 10, 11). The default `project-recap` template must reproduce the previous
 * hard-coded human recap prompt BYTE-FOR-BYTE. The golden file was captured from
 * the pre-template-wiring `buildPrompt` output; if this test fails, the template
 * refactor silently changed the default deliverable -- fix the template, never
 * the golden.
 */
import { describe, expect, test } from 'bun:test'
import { makePromptInputs } from '../../__tests__/synthetic-fixtures'
import { DEFAULT_TEMPLATE_ID, loadTemplates, pickTemplate } from '../../templates'
import golden from './__golden__/anchor-prompt.golden.json'
import { buildPrompt } from './prompt-builder'

type Variant = [name: string, audience: 'human' | 'agent', retrospect: boolean, customerFriendly: boolean]
const VARIANTS: Variant[] = [
  ['human-default', 'human', false, false],
  ['human-retro', 'human', true, false],
  ['human-cf', 'human', false, true],
  ['human-retro-cf', 'human', true, true],
  ['agent-default', 'agent', false, false],
]

describe('anchor: project-recap template reproduces the pre-change prompt byte-for-byte', () => {
  for (const size of ['small', 'medium'] as const) {
    const inputs = makePromptInputs(size)
    for (const [name, audience, retrospect, customerFriendly] of VARIANTS) {
      const key = `${size}|${name}`
      test(key, () => {
        const expected = (golden as Record<string, { system: string; user: string }>)[key]
        expect(expected).toBeDefined()
        const out = buildPrompt(inputs, audience, retrospect, customerFriendly)
        expect(out.system).toBe(expected.system)
        expect(out.user).toBe(expected.user)
      })
    }
  }

  test('the default template is the project-recap anchor, and it actually loads (no silent fallback)', () => {
    const { templates } = loadTemplates()
    const picked = pickTemplate(templates, DEFAULT_TEMPLATE_ID)
    expect(picked?.id).toBe('project-recap')
    expect(picked?.audience).toBe('human')
    // The default human prompt must be the rendered template, not the in-code
    // fallback: prove the rendered output matches the golden exactly.
    const out = buildPrompt(makePromptInputs('small'), 'human', false, false)
    expect(out.system).toBe((golden as Record<string, { system: string }>)['small|human-default'].system)
  })
})
