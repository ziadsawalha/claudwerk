// Manual-layout overrides for THE CANVAS: a per-user pin map of conversationId
// -> absolute {x,y}. Auto-layout (dagre) is the default; dragging a card pins
// it here so it stops flowing, while every un-pinned card keeps auto-placing.
// conversationId is stable forever (identity covenant), so localStorage is a
// safe durable key. "Reset layout" clears the map and everything snaps back.
import { useCallback, useState } from 'react'

export interface XY {
  x: number
  y: number
}
export type LayoutOverrides = ReadonlyMap<string, XY>

const STORAGE_KEY = 'canvas:layoutOverrides:v1'

function load(): Map<string, XY> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Map()
    const obj = JSON.parse(raw) as Record<string, unknown>
    const out = new Map<string, XY>()
    for (const [id, v] of Object.entries(obj)) {
      const p = v as { x?: unknown; y?: unknown }
      if (typeof p?.x === 'number' && typeof p?.y === 'number') out.set(id, { x: p.x, y: p.y })
    }
    return out
  } catch {
    return new Map()
  }
}

function persist(map: Map<string, XY>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)))
  } catch {
    // private mode / quota -- overrides simply don't persist across reloads.
  }
}

export interface LayoutOverridesApi {
  overrides: LayoutOverrides
  pin: (id: string, pos: XY) => void
  reset: () => void
}

export function useLayoutOverrides(): LayoutOverridesApi {
  const [overrides, setOverrides] = useState<Map<string, XY>>(load)

  const pin = useCallback((id: string, pos: XY) => {
    setOverrides(prev => {
      const next = new Map(prev)
      next.set(id, pos)
      persist(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      // ignore -- the empty map below is the source of truth this session.
    }
    setOverrides(new Map())
  }, [])

  return { overrides, pin, reset }
}
