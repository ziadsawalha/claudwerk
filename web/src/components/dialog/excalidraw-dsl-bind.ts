/**
 * The Excalidraw-binding half of the expander (web-only; needs the Excalidraw runtime).
 * The pure half (DSL `Scene` -> skeletons + `customData` meta) lives in
 * `@shared/draw-dsl-expand`; here we run `convertToExcalidrawElements({regenerateIds:
 * false})` so our DSL ids survive, then the post-pass stamps `customData` (the skeleton
 * type can't carry it). Bound text inherits its container's dslId via `containerId`.
 *
 * Lives in the lazy Excalidraw chunk (imported by excalidraw-canvas.tsx).
 */
import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import type { Scene } from '@shared/draw-dsl'
import { expandScene } from '@shared/draw-dsl-expand'

type Element = ReturnType<typeof convertToExcalidrawElements>[number]

/** Expand a DSL Scene to Excalidraw elements tagged with `customData.dslId`. */
export function dslToElements(scene: Scene): Element[] {
  const { skeletons, metaById } = expandScene(scene)
  const elements = convertToExcalidrawElements(skeletons as never, { regenerateIds: false })
  return elements.map(el => {
    const containerId = (el as { containerId?: string | null }).containerId
    const meta = metaById[el.id] ?? (containerId ? metaById[containerId] : undefined)
    if (!meta) return el
    return { ...el, customData: { dslId: meta.dslId, role: meta.role, data: meta.data } }
  })
}
