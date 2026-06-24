import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock the WS seam so the store can be exercised without a live socket.
const { wsSend } = vi.hoisted(() => ({ wsSend: vi.fn(() => true) }))
vi.mock('@/hooks/use-conversations', () => ({
  wsSend,
  useConversationsStore: { getState: () => ({ selectConversation: vi.fn() }) },
}))
vi.mock('./dispatch-bus', () => ({ dispatchBus: { open: vi.fn(), useArmed: () => true } }))

import { useDispatchStore } from './dispatch-store'

describe('dispatch submit hardening (defect #2)', () => {
  beforeEach(() => {
    wsSend.mockReset()
    wsSend.mockReturnValue(true)
    useDispatchStore.setState({ intent: '', pending: false, lastError: null })
  })

  it('does NOT throw when intent is undefined (the stale-bundle bug)', () => {
    // Reproduce the deployed-bundle condition: `intent` missing from the store.
    useDispatchStore.setState({ intent: undefined as unknown as string })
    expect(() => useDispatchStore.getState().submit()).not.toThrow()
    expect(wsSend).not.toHaveBeenCalled() // empty intent -> nothing sent
  })

  it('sends dispatch_request for a real intent and clears the draft', () => {
    useDispatchStore.setState({ intent: '  hi there  ' })
    useDispatchStore.getState().submit()
    expect(wsSend).toHaveBeenCalledWith('dispatch_request', expect.objectContaining({ intent: 'hi there' }))
    expect(useDispatchStore.getState().intent).toBe('')
  })

  it('surfaces a thrown error as lastError instead of dying silently', () => {
    wsSend.mockImplementation(() => {
      throw new Error('ws boom')
    })
    useDispatchStore.setState({ intent: 'hello' })
    expect(() => useDispatchStore.getState().submit()).not.toThrow()
    expect(useDispatchStore.getState().lastError).toBe('ws boom')
    expect(useDispatchStore.getState().pending).toBe(false)
  })
})
