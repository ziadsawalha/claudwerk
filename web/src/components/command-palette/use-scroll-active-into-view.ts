import { useEffect, useRef } from 'react'

/**
 * Keeps the keyboard-focused command palette row visible.
 *
 * Each result row tags itself with `data-active="true"` when it is the row at
 * `activeIndex`. After every render that moves the cursor (activeIndex) or
 * switches palette mode, this scrolls that row to the nearest edge of the
 * results box -- so arrowing past the visible bottom/top no longer hides the
 * highlighted item. `block: 'nearest'` is a no-op when the row is already
 * fully visible, so it never jumps the list around unnecessarily.
 */
export function useScrollActiveIntoView(activeIndex: number, mode: string) {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    containerRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, mode])
  return containerRef
}
