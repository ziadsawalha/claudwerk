import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isStatusSuperseded } from '@/lib/status-style'
import type { LiveStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { StatusHoverPanel } from './status-hover-panel'

/**
 * THE STATUS hover card — wraps a status badge/glyph and floats a Markdown-
 * rendered detail panel (StatusHoverPanel) on hover/focus, replacing the native
 * `title` tooltip (which showed raw markdown source). Portaled to body so dense
 * list rows can't clip it; fixed-positioned at the trigger's viewport rect,
 * flipping above when there's no room below. Opens on a deliberate delay so
 * scanning a dense roster doesn't spam panels; stays open while the pointer is
 * over the trigger OR the panel (so links/text are reachable). Closes on leave,
 * scroll, resize, or Escape.
 */

// Deliberate open delay: long enough not to fire while scanning a dense list,
// short enough to feel responsive. Jonas floated 2s; 600ms reads snappier while
// still intentional. One constant to tune.
const HOVER_OPEN_DELAY_MS = 600
const HOVER_CLOSE_DELAY_MS = 120
const PANEL_WIDTH = 340
const VIEWPORT_MARGIN = 8

interface Coords {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
}

function computeCoords(rect: DOMRect): Coords {
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN))
  const spaceBelow = window.innerHeight - rect.bottom
  const spaceAbove = rect.top
  // Prefer below; flip above when below is cramped and above has more room.
  if (spaceBelow < 160 && spaceAbove > spaceBelow) {
    return { left, bottom: window.innerHeight - rect.top + 6, maxHeight: spaceAbove - VIEWPORT_MARGIN - 6 }
  }
  return { left, top: rect.bottom + 6, maxHeight: spaceBelow - VIEWPORT_MARGIN - 6 }
}

export function StatusHoverCard({
  status,
  lastInputAt,
  children,
}: {
  status: LiveStatus
  lastInputAt?: number
  children: ReactNode
}) {
  const triggerRef = useRef<HTMLSpanElement>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [coords, setCoords] = useState<Coords | null>(null)

  const open = useCallback(() => {
    clearTimeout(closeTimer.current)
    openTimer.current = setTimeout(() => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) setCoords(computeCoords(rect))
    }, HOVER_OPEN_DELAY_MS)
  }, [])

  const close = useCallback((immediate = false) => {
    clearTimeout(openTimer.current)
    if (immediate) {
      clearTimeout(closeTimer.current)
      setCoords(null)
      return
    }
    closeTimer.current = setTimeout(() => setCoords(null), HOVER_CLOSE_DELAY_MS)
  }, [])

  // Dismiss the open panel on scroll / resize / Escape — it's anchored to a
  // viewport rect captured at open time, so any layout shift invalidates it.
  useEffect(() => {
    if (!coords) return
    const dismiss = () => close(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true)
    }
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [coords, close])

  // Clear any pending open/close timers on unmount (refs are stable -> [] deps).
  useEffect(
    () => () => {
      clearTimeout(openTimer.current)
      clearTimeout(closeTimer.current)
    },
    [],
  )

  const superseded = isStatusSuperseded(status, lastInputAt)

  return (
    <>
      <span
        ref={triggerRef}
        className="inline-flex items-center gap-1"
        onMouseEnter={open}
        onMouseLeave={() => close()}
        onFocus={open}
        onBlur={() => close(true)}
      >
        {children}
      </span>
      {coords &&
        createPortal(
          <div
            role="tooltip"
            style={{ position: 'fixed', left: coords.left, top: coords.top, bottom: coords.bottom, width: PANEL_WIDTH }}
            className="z-[120]"
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={() => close()}
          >
            <div
              style={{ maxHeight: coords.maxHeight }}
              className={cn(
                'overflow-y-auto rounded-md bg-background/95 shadow-xl backdrop-blur',
                'border border-border/60',
              )}
            >
              <StatusHoverPanel status={status} lastInputAt={lastInputAt} superseded={superseded} />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
