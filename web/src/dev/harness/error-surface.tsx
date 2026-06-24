/**
 * The harness error surface -- the whole point of the harness.
 *
 * The real app swallows failures (a throw in a dispatch submit handler, an
 * unhandled rejection, a render crash) so a dead component looks merely idle.
 * Here we make every failure LOUD: a React error boundary catches render/lifecycle
 * throws, and window listeners catch uncaught errors (incl. those thrown out of
 * React event handlers) + unhandled promise rejections. Anything captured is
 * rendered in a fixed banner so driving a broken component proves it's broken.
 */
import { Component, type ReactNode, useEffect, useState } from 'react'

interface CapturedError {
  kind: 'error' | 'unhandledrejection' | 'boundary'
  message: string
  stack?: string
  at: number
}

type Listener = (e: CapturedError) => void
const listeners = new Set<Listener>()

/** Feed an error into the surface (boundary + window listeners). */
function reportHarnessError(e: CapturedError): void {
  for (const l of listeners) l(e)
}

class HarnessBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    reportHarnessError({ kind: 'boundary', message: error.message, stack: error.stack, at: Date.now() })
  }
  render() {
    if (this.state.failed) {
      return <div style={fallbackStyle}>Component threw during render -- see the error panel above.</div>
    }
    return this.props.children
  }
}

export function ErrorSurface({ children }: { children: ReactNode }) {
  const [errors, setErrors] = useState<CapturedError[]>([])

  useEffect(() => {
    const onError = (ev: ErrorEvent) =>
      reportHarnessError({
        kind: 'error',
        message: ev.message || String(ev.error),
        stack: ev.error?.stack,
        at: Date.now(),
      })
    const onRej = (ev: PromiseRejectionEvent) =>
      reportHarnessError({
        kind: 'unhandledrejection',
        message: String(ev.reason?.message ?? ev.reason),
        stack: ev.reason?.stack,
        at: Date.now(),
      })
    const onEmit: Listener = e => setErrors(prev => [...prev, e])
    listeners.add(onEmit)
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRej)
    return () => {
      listeners.delete(onEmit)
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRej)
    }
  }, [])

  return (
    <>
      {errors.length > 0 && (
        <div role="alert" data-testid="harness-errors" style={bannerStyle}>
          <strong>⚠ {errors.length} error(s) captured by the harness</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {errors.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <code>[{e.kind}]</code> {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      <HarnessBoundary>{children}</HarnessBoundary>
    </>
  )
}

const bannerStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 99999,
  background: '#3a0d0d',
  color: '#ffd7d7',
  border: '1px solid #a33',
  padding: '10px 14px',
  font: '13px/1.4 ui-monospace, monospace',
}

const fallbackStyle: React.CSSProperties = {
  padding: 24,
  color: '#ffd7d7',
  font: '13px/1.4 ui-monospace, monospace',
}
