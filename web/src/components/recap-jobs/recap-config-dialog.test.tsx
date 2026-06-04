import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { RecapTemplateManifest } from './recap-templates'

const sentMessages: Array<{ type: string; data: Record<string, unknown> }> = []

vi.mock('@/hooks/use-conversations', () => ({
  wsSend: (type: string, data?: Record<string, unknown>): boolean => {
    sentMessages.push({ type, data: data || {} })
    return true
  },
}))

// Mock only the manifest fetch; keep the real defaultOptionFlags. By default the
// fetch resolves null -> no picker (the byte-identical default path), matching the
// pre-template behavior. Picker tests override it with mockResolvedValue(MANIFEST).
vi.mock('./recap-templates', async importOriginal => ({
  ...(await importOriginal<typeof import('./recap-templates')>()),
  fetchRecapTemplates: vi.fn(),
}))

import { RecapConfigDialog } from './recap-config-dialog'
import { openRecapConfigDialog } from './recap-config-trigger'
import { fetchRecapTemplates } from './recap-templates'

const MANIFEST: RecapTemplateManifest = {
  defaultTemplateId: 'project-recap',
  templates: [
    {
      id: 'project-recap',
      label: 'Project recap',
      description: 'The reflective development recap.',
      scope: 'fleet',
      audience: 'human',
      sections: [],
      defaults: { retrospect: false, customerFriendly: false, signals: [] },
      options: [],
      isDefault: true,
    },
    {
      id: 'shipped-report',
      label: 'Shipped Report',
      description: 'What the fleet shipped this period.',
      scope: 'fleet',
      audience: 'human',
      sections: [],
      defaults: { retrospect: false, customerFriendly: true, signals: [] },
      options: [
        { id: 'group_by_project', label: 'Group by project', default: true },
        { id: 'include_cost', label: 'Include cost summary', default: false, signal: 'cost' },
        { id: 'commit_stats', label: 'Include commit stats (files, +/- lines)', default: true, signal: 'commits' },
        { id: 'terse', label: 'Terse tone', default: false },
      ],
      isDefault: false,
    },
  ],
}

function openModal(projectUri = 'claude://default/p') {
  render(<RecapConfigDialog />)
  act(() => openRecapConfigDialog({ projectUri }))
}

// Target the retrospect checkbox specifically -- the modal also renders a
// customer-friendly checkbox (and, with a picker, template option toggles).
function checkbox(): HTMLInputElement {
  return screen.getByRole('checkbox', { name: /retrospective/i }) as HTMLInputElement
}

function generate() {
  fireEvent.click(screen.getByRole('button', { name: /Generate/ }))
}

beforeEach(() => {
  sentMessages.length = 0
  vi.mocked(fetchRecapTemplates).mockResolvedValue(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RecapConfigDialog', () => {
  test('opens with Last 7 days and retrospect ON by default', () => {
    openModal()
    expect(checkbox().checked).toBe(true)
  })

  test('picking a sub-week preset auto-disables retrospect', () => {
    openModal()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(checkbox().checked).toBe(false)
  })

  test('a manual retrospect toggle sticks across preset changes', () => {
    openModal()
    fireEvent.click(checkbox()) // turn OFF manually (was on for last_7)
    expect(checkbox().checked).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' })) // would default ON
    expect(checkbox().checked).toBe(false) // stays where the user left it
  })

  test('Generate fires recap_create with the label + retrospect flag', () => {
    openModal('claude://default/p')
    generate()
    expect(sentMessages).toHaveLength(1)
    const m = sentMessages[0]
    expect(m.type).toBe('recap_create')
    expect(m.data.projectUri).toBe('claude://default/p')
    expect(m.data.period).toEqual({ label: 'last_7' })
    expect(m.data.retrospect).toBe(true)
  })

  test('cross-project scope sends "*"', () => {
    openModal('*')
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    generate()
    expect(sentMessages[0].data.projectUri).toBe('*')
    expect(sentMessages[0].data.retrospect).toBeUndefined() // off for "today"
  })

  test('custom range reveals date inputs and sends a custom period', () => {
    openModal()
    fireEvent.click(screen.getByRole('button', { name: 'Custom…' }))
    generate()
    const period = sentMessages[0].data.period as { label: string; start?: number; end?: number }
    expect(period.label).toBe('custom')
    expect(typeof period.start).toBe('number')
    expect(typeof period.end).toBe('number')
  })

  test('no manifest -> no picker, sends the default template, omits options', async () => {
    openModal('*')
    expect(screen.queryByRole('combobox')).toBeNull()
    generate()
    expect(sentMessages[0].data.template).toBe('project-recap')
    expect(sentMessages[0].data.options).toBeUndefined()
  })

  test('manifest -> picker appears; default selection is project-recap with no options', async () => {
    vi.mocked(fetchRecapTemplates).mockResolvedValue(MANIFEST)
    openModal('*')
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    expect(select.value).toBe('project-recap')
    // project-recap declares no options -> no option toggles beyond retrospect + cf
    expect(screen.queryByRole('checkbox', { name: /group by project/i })).toBeNull()
    generate()
    expect(sentMessages[0].data.template).toBe('project-recap')
    expect(sentMessages[0].data.options).toBeUndefined()
  })

  test('selecting Shipped Report seeds option defaults and sends template + flags', async () => {
    vi.mocked(fetchRecapTemplates).mockResolvedValue(MANIFEST)
    openModal('*')
    const select = (await screen.findByRole('combobox')) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'shipped-report' } })
    // options seeded from declared defaults
    const groupBy = (await screen.findByRole('checkbox', { name: /group by project/i })) as HTMLInputElement
    expect(groupBy.checked).toBe(true) // default true
    const terse = screen.getByRole('checkbox', { name: /terse tone/i }) as HTMLInputElement
    expect(terse.checked).toBe(false) // default false
    fireEvent.click(terse) // flip terse on
    generate()
    const m = sentMessages[0]
    expect(m.data.template).toBe('shipped-report')
    expect(m.data.options).toMatchObject({
      group_by_project: true,
      include_cost: false,
      commit_stats: true,
      terse: true,
    })
  })
})
