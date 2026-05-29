import type { PeriodRecapDoc, RecapSummary } from '@shared/protocol'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { RecapWriteupTab } from './recap-writeup-tab'

// Markdown pulls in CodeMirror/Mermaid -- stub it; we test the A/B controls.
vi.mock('@/components/markdown', () => ({
  Markdown: ({ children }: { children?: React.ReactNode }) => <div data-testid="md">{children}</div>,
}))

function doc(overrides: Partial<PeriodRecapDoc> = {}): PeriodRecapDoc {
  return {
    recapId: 'recap_1',
    projectUri: 'claude://default/p/foo',
    periodLabel: 'last_7',
    periodStart: 1715000000000,
    periodEnd: 1715600000000,
    timeZone: 'UTC',
    audience: 'human',
    status: 'done',
    progress: 100,
    inputChars: 1000,
    inputTokens: 300,
    outputTokens: 200,
    llmCostUsd: 0.6,
    createdAt: 1715600000000,
    model: 'anthropic/claude-opus-4.8',
    markdown: '# Write-up\n\nbody',
    ...overrides,
  }
}

function summary(overrides: Partial<RecapSummary> = {}): RecapSummary {
  return {
    id: 'recap_1',
    projectUri: 'claude://default/p/foo',
    periodLabel: 'last_7',
    periodStart: 1715000000000,
    periodEnd: 1715600000000,
    audience: 'human',
    status: 'done',
    createdAt: 1,
    llmCostUsd: 0.6,
    progress: 100,
    model: 'anthropic/claude-opus-4.8',
    ...overrides,
  }
}

afterEach(cleanup)

describe('RecapWriteupTab', () => {
  test('regenerate sends the currently-selected model (defaults to the recap model)', () => {
    const onRegenerate = vi.fn()
    render(
      <RecapWriteupTab
        recap={doc()}
        siblings={[]}
        regenerating={false}
        onSelectFork={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    )
    fireEvent.click(screen.getByText('Regenerate write-up'))
    expect(onRegenerate).toHaveBeenCalledWith('anthropic/claude-opus-4.8')
  })

  test('changing the dropdown then regenerating sends the chosen slug', () => {
    const onRegenerate = vi.fn()
    render(
      <RecapWriteupTab
        recap={doc()}
        siblings={[]}
        regenerating={false}
        onSelectFork={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    )
    fireEvent.change(screen.getByLabelText('Regenerate write-up model'), {
      target: { value: 'deepseek/deepseek-chat' },
    })
    fireEvent.click(screen.getByText('Regenerate write-up'))
    expect(onRegenerate).toHaveBeenCalledWith('deepseek/deepseek-chat')
  })

  test('while regenerating the button is disabled and does not fire', () => {
    const onRegenerate = vi.fn()
    render(
      <RecapWriteupTab
        recap={doc()}
        siblings={[]}
        regenerating={true}
        onSelectFork={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    )
    fireEvent.click(screen.getByText('Generating…'))
    expect(onRegenerate).not.toHaveBeenCalled()
  })

  test('fork switcher renders sibling variants and routes clicks to onSelectFork', () => {
    const onSelectFork = vi.fn()
    render(
      <RecapWriteupTab
        recap={doc({ recapId: 'recap_1' })}
        siblings={[
          summary({ id: 'recap_1', model: 'anthropic/claude-opus-4.8' }),
          summary({ id: 'recap_2', model: 'deepseek/deepseek-chat', createdAt: 2 }),
        ]}
        regenerating={false}
        onSelectFork={onSelectFork}
        onRegenerate={vi.fn()}
      />,
    )
    // Scope to the switcher: "DeepSeek" also appears as a dropdown <option>.
    const switcher = within(screen.getByLabelText('Write-up variants'))
    fireEvent.click(switcher.getByText('DeepSeek'))
    expect(onSelectFork).toHaveBeenCalledWith('recap_2')
  })

  test('no switcher when there is only one variant', () => {
    render(
      <RecapWriteupTab
        recap={doc()}
        siblings={[summary({ id: 'recap_1' })]}
        regenerating={false}
        onSelectFork={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Write-up variants')).toBeNull()
  })
})
