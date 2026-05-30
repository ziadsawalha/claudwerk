import { type ReactNode, useEffect, useRef, useState } from 'react'

/** Reveal (fade + expand) and collapse (fade + shrink) duration for in-flight
 *  decorations. Both directions animate height (grid-template-rows) AND opacity. */
export const INFLIGHT_COLLAPSE_MS = 250

/**
 * Smoothly collapses its children's height (and fades them) when `show` flips
 * false, instead of unmounting them instantly. In-flight transcript decorations
 * (thinking sparkline/pill, verb spinner) live at the very bottom inside the
 * last measured virtual item; unmounting them in one frame drops scrollHeight,
 * the browser clamps scrollTop, and the content snaps up -- the "poof" jerk.
 *
 * With this, removal animates: the grid-template-rows 1fr->0fr trick collapses
 * height over INFLIGHT_COLLAPSE_MS while the content fades, so the item's
 * ResizeObserver reports a GRADUAL shrink -> the browser clamp settles the
 * content gently instead of snapping. Children stay mounted through the exit
 * (the last shown content is frozen during collapse via lastShown), then render
 * nothing once closed. Symmetric on enter (fades/expands in).
 */
export function Collapse({
  show,
  durationMs = INFLIGHT_COLLAPSE_MS,
  children,
}: {
  show: boolean
  durationMs?: number
  children: ReactNode
}) {
  const [mounted, setMounted] = useState(show)
  const [open, setOpen] = useState(show)
  // Freeze the last non-empty children so the exit animation has something to
  // show even after the parent stops providing content.
  const lastShown = useRef<ReactNode>(children)
  if (show) lastShown.current = children

  useEffect(() => {
    if (show) {
      setMounted(true)
      const id = requestAnimationFrame(() => setOpen(true))
      return () => cancelAnimationFrame(id)
    }
    setOpen(false)
    const id = setTimeout(() => setMounted(false), durationMs)
    return () => clearTimeout(id)
  }, [show, durationMs])

  if (!mounted) return null
  return (
    <div
      className="grid transition-[grid-template-rows,opacity] ease-out motion-reduce:transition-none"
      style={{
        gridTemplateRows: open ? '1fr' : '0fr',
        opacity: open ? 1 : 0,
        transitionDuration: `${durationMs}ms`,
      }}
    >
      <div className="min-h-0 overflow-hidden">{show ? children : lastShown.current}</div>
    </div>
  )
}
