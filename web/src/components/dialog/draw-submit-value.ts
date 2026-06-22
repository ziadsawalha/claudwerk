/**
 * Build the Draw block's submit value from the canvas's serialized scene JSON.
 *
 *   - Freehand / raw-seeded block -> `{kind:'draw', snapshot, bytes}` (phase-1 path,
 *     unchanged: no regression).
 *   - DSL-seeded block -> reverse the edited scene to a compact `Scene` + `SceneDiff`
 *     and emit `{kind:'excalidraw', snapshot, scene, diff, bytes}`. The raw snapshot
 *     rides along for fidelity / thumbnail; draw-spill.ts spills it when large.
 */
import type { DrawValue } from '@shared/draw'
import type { Scene } from '@shared/draw-dsl'
import { type RawElement, reverseScene } from '@shared/draw-dsl-reverse'

export function buildDrawValue(json: string, bytes: number, base: Scene | null): DrawValue {
  if (!base) return { kind: 'draw', snapshot: json, bytes }
  let elements: RawElement[] = []
  try {
    const parsed = JSON.parse(json) as { elements?: RawElement[] }
    elements = Array.isArray(parsed.elements) ? parsed.elements : []
  } catch {
    return { kind: 'draw', snapshot: json, bytes }
  }
  const { scene, diff } = reverseScene(elements, base)
  return { kind: 'excalidraw', snapshot: json, scene, diff, bytes }
}
