import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock the WS / modal seams so the store (imported transitively) loads without a
// live socket -- mirrors dispatch-store.test.ts.
vi.mock('@/hooks/use-conversations', () => ({
  wsSend: vi.fn(() => true),
  useConversationsStore: { getState: () => ({ selectConversation: vi.fn() }) },
}))
vi.mock('@/hooks/use-modal-manager', () => ({
  useModalManagerStore: { getState: () => ({ open: vi.fn(), close: vi.fn() }) },
}))
vi.mock('./dispatch-bus', () => ({ dispatchBus: { open: vi.fn(), useArmed: () => true } }))

import type { DispatchProjectStatus } from '@shared/protocol'
import { DispatchDesk } from './dispatch-desk'
import { useDispatchStore } from './dispatch-store'

afterEach(cleanup)

function setStatus(status: DispatchProjectStatus[]) {
  useDispatchStore.setState({ roster: [], status, memory: '', workspaces: [] })
}

describe('DispatchDesk StatusSection -- SOTU tie-in (Phase 5)', () => {
  it('renders the SOTU narrative + CONTENDED badge + git alerts when present', () => {
    setStatus([
      {
        project: 'remote-claude',
        headline: 'old zero-LLM headline',
        live: 3,
        working: 1,
        needsYou: 0,
        sotuNarrative: 'Two convs converging on the auth refactor; sentinel scan clean.',
        sotuContended: 2,
        sotuAlerts: ['at-risk', 'unpushed'],
      },
    ])
    render(<DispatchDesk />)
    // The narrative UPGRADES (replaces) the zero-LLM headline.
    expect(screen.getByText(/converging on the auth refactor/)).toBeTruthy()
    expect(screen.queryByText('old zero-LLM headline')).toBeNull()
    // The CONTENDED badge is genuinely visible (the passive trample-guard mechanism).
    expect(screen.getByText(/2 contended/i)).toBeTruthy()
    // Git alert chips render.
    expect(screen.getByText('at-risk')).toBeTruthy()
    expect(screen.getByText('unpushed')).toBeTruthy()
  })

  it('falls back to the zero-LLM headline with no badge when SOTU is off', () => {
    setStatus([{ project: 'quiet-proj', headline: 'just the brief headline', live: 1, working: 0, needsYou: 0 }])
    render(<DispatchDesk />)
    expect(screen.getByText('just the brief headline')).toBeTruthy()
    expect(screen.queryByText(/contended/i)).toBeNull()
  })
})
