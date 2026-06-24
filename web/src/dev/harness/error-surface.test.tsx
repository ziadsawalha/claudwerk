import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorSurface } from './error-surface'

// The harness's core guarantee: failures the real app swallows become LOUD.
// We prove the surface catches all three failure modes -- a render throw (error
// boundary), an uncaught error event (the exact shape of a throw out of a React
// event handler, e.g. the dispatch submit bug), and an unhandled rejection.

afterEach(cleanup)

function Boom(): never {
  throw new Error('render exploded')
}

describe('ErrorSurface', () => {
  let consoleErr: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    // React logs caught boundary errors to console.error -- silence the noise.
    consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => consoleErr.mockRestore())

  it('renders children verbatim in the happy path', () => {
    render(
      <ErrorSurface>
        <p>all good</p>
      </ErrorSurface>,
    )
    expect(screen.getByText('all good')).toBeTruthy()
    expect(screen.queryByTestId('harness-errors')).toBeNull()
  })

  it('catches a render throw via the boundary and surfaces it in the banner', () => {
    render(
      <ErrorSurface>
        <Boom />
      </ErrorSurface>,
    )
    const banner = screen.getByTestId('harness-errors')
    expect(banner.textContent).toContain('[boundary]')
    expect(banner.textContent).toContain('render exploded')
    // and the child subtree shows the scoped fallback rather than a blank screen
    expect(screen.getByText(/Component threw during render/i)).toBeTruthy()
  })

  it('surfaces an uncaught window error (the swallowed event-handler throw)', () => {
    render(
      <ErrorSurface>
        <p>live</p>
      </ErrorSurface>,
    )
    act(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'submit blew up', error: new Error('submit blew up') }))
    })
    const banner = screen.getByTestId('harness-errors')
    expect(banner.textContent).toContain('[error]')
    expect(banner.textContent).toContain('submit blew up')
  })

  it('surfaces an unhandled promise rejection', () => {
    render(
      <ErrorSurface>
        <p>live</p>
      </ErrorSurface>,
    )
    act(() => {
      const ev = new Event('unhandledrejection') as PromiseRejectionEvent
      Object.defineProperty(ev, 'reason', { value: new Error('async boom') })
      window.dispatchEvent(ev)
    })
    const banner = screen.getByTestId('harness-errors')
    expect(banner.textContent).toContain('[unhandledrejection]')
    expect(banner.textContent).toContain('async boom')
  })
})
