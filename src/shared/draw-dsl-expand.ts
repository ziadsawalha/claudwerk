/**
 * Expander entry point: a compact DSL `Scene` -> Excalidraw element skeletons + the
 * `customData` meta map. The canvas runs `convertToExcalidrawElements(skeletons,
 * {regenerateIds:false})` then stamps `customData` from `metaById` (see the post-pass
 * in excalidraw-dsl-bind.ts). Pure: layout (no pixel math for the agent) then skeletons.
 *
 * The reverse pass also calls this -- it needs the baseline positions/labels per dslId
 * to diff against the edited scene, and the layout half runs without Excalidraw.
 */
import type { Scene } from './draw-dsl'
import { placeScene } from './draw-dsl-layout'
import { buildSkeletons, type Expanded } from './draw-dsl-skeleton'

export function expandScene(scene: Scene): Expanded {
  const placed = placeScene(scene)
  return buildSkeletons(placed, scene.edges ?? [])
}

export type { Expanded }
