/**
 * PATH PARITY -- the guard that the oneshot and synthesize paths render the SAME
 * deliverable contract (PLAN sections 3, 10). Both wrappers feed from the one
 * `renderHumanBody` seam; the default template branches its FRAMING on `path` but
 * injects the frontmatter + body contract exactly ONCE, so the contract cannot
 * drift between the two paths. This file pins that:
 *   1. the contract suffix is byte-identical across oneshot + synthesize;
 *   2. the synthesize branch of the template reproduces the canonical TS framing
 *      byte-for-byte (the synthesize twin of the anchor byte-identity test).
 */
import { describe, expect, test } from 'bun:test'
import { makePromptInputs } from '../../__tests__/synthetic-fixtures'
import { makeEmptyMetadata } from '../chunk/merge'
import { buildSynthesizePrompt } from '../chunk/synthesize-prompt'
import {
  buildPrompt,
  FRONTMATTER_SPEC,
  HUMAN_BODY_SPEC,
  HUMAN_SYNTHESIZE_READER,
  renderBody,
  synthesizeFraming,
} from './prompt-builder'

const CONTRACT = `${FRONTMATTER_SPEC}\n\n${HUMAN_BODY_SPEC}`

// Both wrappers must end with the SAME contract tail -- single injection, no drift.
function expectSharedContract(oneshot: string, synthesize: string): void {
  expect(oneshot.endsWith(CONTRACT)).toBe(true)
  expect(synthesize.endsWith(CONTRACT)).toBe(true)
  expect(oneshot.slice(-CONTRACT.length)).toBe(synthesize.slice(-CONTRACT.length))
}

describe('oneshot/synthesize shared body', () => {
  test('both paths render the IDENTICAL frontmatter + body contract (only framing differs)', () => {
    const args = {
      audience: 'human' as const,
      scopeLabel: 'remote-claude',
      periodHuman: 'this week',
      periodIsoRange: '2026-05-22..2026-05-29',
    }
    const oneshot = renderBody({ ...args, path: 'oneshot' })
    const synthesize = renderBody({ ...args, path: 'synthesize' })

    expectSharedContract(oneshot, synthesize)

    // The framing legitimately differs (extract-from-transcripts vs refine-merged).
    expect(oneshot.startsWith('You are writing a comprehensive development recap')).toBe(true)
    expect(synthesize.startsWith('You are SYNTHESIZING')).toBe(true)
    expect(oneshot).not.toBe(synthesize)
  })

  test('the template synthesize branch reproduces the canonical TS framing byte-for-byte', () => {
    const rendered = renderBody({
      path: 'synthesize',
      audience: 'human',
      scopeLabel: 'remote-claude',
      periodHuman: 'this week',
      periodIsoRange: '2026-05-22..2026-05-29',
    })
    const expected = `${synthesizeFraming('remote-claude', 'this week', '2026-05-22..2026-05-29', HUMAN_SYNTHESIZE_READER)}\n\n${CONTRACT}`
    expect(rendered).toBe(expected)
  })

  test('end-to-end: buildPrompt and buildSynthesizePrompt embed the identical contract', () => {
    const oneshot = buildPrompt(makePromptInputs('small'), 'human').system
    const synthesize = buildSynthesizePrompt(makeEmptyMetadata(), {
      projectLabel: 'remote-claude',
      periodHuman: 'this week',
      periodIsoRange: '2026-05-22..2026-05-29',
    }).system
    expectSharedContract(oneshot, synthesize)
  })
})
