/**
 * Harness mount: the dispatch overlay, driven standalone.
 *
 * Opens the overlay on mount (its store arms the lazy chunk + fetches threads
 * over the real broker WS) so the harness lands straight on the live UI.
 */
import { useEffect } from 'react'
import DispatchOverlay from '@/components/dispatch-overlay/dispatch-overlay'
import { useDispatchStore } from '@/components/dispatch-overlay/dispatch-store'

export default function DispatchOverlayMount() {
  useEffect(() => {
    useDispatchStore.getState().openOverlay()
  }, [])
  return <DispatchOverlay />
}
