import { useEffect } from 'react'
import { DispatchConsole } from './dispatch-console'
import { DispatchHeader } from './dispatch-header'
import { DispatchRightPane } from './dispatch-right-pane'
import { DispatchRoster } from './dispatch-roster'
import { useDispatchStore } from './dispatch-store'
import './dispatch.css'

/**
 * The dispatch cockpit -- a per-user command deck that floats over the control
 * panel. Lazy-mounted via the arming bus (dispatch-bus); visibility is the
 * store's `open` flag. Three columns: fleet roster (attention-first), the
 * dispatch console (intent -> decision), and a switchable memory/conversation/
 * workspace rail. Esc or the scrim dismisses it.
 */
export default function DispatchOverlay() {
  const open = useDispatchStore(s => s.open)
  const close = useDispatchStore(s => s.closeOverlay)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])

  if (!open) return null

  return (
    <div role="dialog" aria-modal="true" aria-label="Dispatch cockpit">
      <button type="button" aria-label="Close dispatch" tabIndex={-1} className="dispatch-scrim" onClick={close} />
      <div className="dispatch-deck">
        <div className="dispatch-grid-texture pointer-events-none absolute inset-0" />
        <DispatchHeader />
        <div className="relative flex min-h-0 flex-1">
          <DispatchRoster />
          <DispatchConsole />
          <DispatchRightPane />
        </div>
      </div>
    </div>
  )
}
