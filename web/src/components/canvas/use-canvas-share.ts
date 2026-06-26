/**
 * Owner-side share state for one hosted canvas: current tier, public link, and
 * the set/revoke actions. Kept out of the share-control component so the .tsx
 * stays a thin render. The token never leaves the owner UI except as the link.
 */

import type { CanvasShareTier, CanvasSummary } from '@shared/protocol'
import { useCallback, useState } from 'react'
import { canvasShareUrl, revokeCanvasShare, shareCanvas } from './canvas-editor-io'

export interface CanvasShareState {
  shared: boolean
  tier: CanvasShareTier
  url: string | null
  busy: boolean
  /** Create or re-tier the public share. */
  setTier: (tier: CanvasShareTier) => Promise<void>
  /** Revoke -- the link dies immediately. */
  revoke: () => Promise<void>
}

// fallow-ignore-next-line complexity -- a share hook: 3 state seeds + 2 guarded async actions, irreducible.
export function useCanvasShare(canvas: CanvasSummary | null): CanvasShareState {
  const [shared, setShared] = useState(canvas?.shared ?? false)
  const [tier, setTierState] = useState<CanvasShareTier>(canvas?.shareTier ?? 'read')
  const [token, setToken] = useState<string | null>(canvas?.shareToken ?? null)
  const [busy, setBusy] = useState(false)

  const setTier = useCallback(
    async (next: CanvasShareTier) => {
      if (!canvas || busy) return
      setBusy(true)
      const tok = await shareCanvas(canvas.id, next)
      if (tok) {
        setToken(tok)
        setTierState(next)
        setShared(true)
      }
      setBusy(false)
    },
    [canvas, busy],
  )

  const revoke = useCallback(async () => {
    if (!canvas || busy) return
    setBusy(true)
    if (await revokeCanvasShare(canvas.id)) {
      setShared(false)
      setToken(null)
    }
    setBusy(false)
  }, [canvas, busy])

  return { shared, tier, url: token ? canvasShareUrl(token) : null, busy, setTier, revoke }
}
