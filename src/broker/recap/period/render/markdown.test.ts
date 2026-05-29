import { describe, expect, it } from 'bun:test'
import type { CostDigest } from '../gather/types'
import { type FinalDocumentInputs, renderFinalMarkdown } from './markdown'

const cost: CostDigest = {
  totalCostUsd: 0,
  totalTurns: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  totalCacheReadTokens: 0,
  totalCacheWriteTokens: 0,
  perDay: [],
  perModel: [],
  perConversation: [],
  perProject: [],
  contextBuckets: [],
}
const base: FinalDocumentInputs = {
  title: 'Test recap',
  projectLabel: 'p',
  projectUri: 'claude://default/p',
  periodHuman: 'Last 7 days',
  periodIsoRange: '2026-05-22 - 2026-05-29',
  generatedAt: 0,
  model: 'm',
  recapId: 'recap_x',
  audience: 'human',
  cost,
  body: '## Body\n\ncontent',
}

describe('renderFinalMarkdown partial banner', () => {
  it('renders a banner naming the dropped chunks when partialNote is set', () => {
    const md = renderFinalMarkdown({ ...base, partialNote: '2 of 6 chunk(s) failed -- recap is partial' })
    expect(md).toContain('Partial recap')
    expect(md).toContain('2 of 6 chunk(s) failed')
  })

  it('renders NO banner on a clean recap', () => {
    expect(renderFinalMarkdown(base)).not.toContain('Partial recap')
  })

  it('surfaces the banner to the agent audience too', () => {
    const md = renderFinalMarkdown({ ...base, audience: 'agent', partialNote: '1 of 4 chunk(s) failed' })
    expect(md).toContain('Partial recap')
  })
})
