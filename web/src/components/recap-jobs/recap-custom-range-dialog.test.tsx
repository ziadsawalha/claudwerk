/**
 * Regression test for the setTimeout leak fix at recap-custom-range-dialog.tsx:53.
 *
 * The dialog installs a global `_openDialog` callback in a useEffect. When
 * a caller invokes openRecapCustomRangeDialog(), the callback schedules a
 * 50ms setTimeout to focus the start input. If the component unmounts
 * before the timer fires the timer was left dangling, and a re-open
 * before the timer fired left the previous timer dangling too. The fix
 * tracks the latest timer in a ref and clears it on both unmount and
 * re-open.
 */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/lib/key-layers', () => ({
  useKeyLayer: vi.fn(),
}))

vi.mock('@/lib/utils', async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, haptic: vi.fn() }
})

vi.mock('./recap-submenu', () => ({
  createRecap: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('RecapCustomRangeDialog setTimeout cleanup', () => {
  test('clears the pending focus timer when unmounted', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const mod = await import('./recap-custom-range-dialog')
    const { unmount } = render(<mod.RecapCustomRangeDialog />)
    // Open the dialog -- callback schedules the 50ms focus setTimeout.
    act(() => {
      mod.openRecapCustomRangeDialog({ projectUri: 'claude://default/p' })
    })
    const focusCall = setTimeoutSpy.mock.calls.findIndex(c => c[1] === 50)
    expect(focusCall).toBeGreaterThanOrEqual(0)
    const focusTimerId = setTimeoutSpy.mock.results[focusCall].value
    unmount()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(focusTimerId)
  })

  test('clears the previous focus timer when re-opened before it fires', async () => {
    vi.useFakeTimers()
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    const mod = await import('./recap-custom-range-dialog')
    render(<mod.RecapCustomRangeDialog />)
    act(() => {
      mod.openRecapCustomRangeDialog({ projectUri: 'claude://default/p' })
    })
    const firstCall = setTimeoutSpy.mock.calls.findIndex(c => c[1] === 50)
    const firstTimerId = setTimeoutSpy.mock.results[firstCall].value
    // Re-open before the first timer fires.
    act(() => {
      mod.openRecapCustomRangeDialog({ projectUri: 'claude://default/p' })
    })
    expect(clearTimeoutSpy).toHaveBeenCalledWith(firstTimerId)
  })
})
