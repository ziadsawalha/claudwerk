/**
 * Draw block (Excalidraw whiteboard) -- shared constants + the submit-state shape.
 *
 * A drawing is an Excalidraw SCENE (the JSON `serializeAsJSON()` returns: elements
 * + appState + files). Small drawings ride inline in the dialog form state; large
 * ones spill to the broker blob store (`POST /api/files`, same as uploaded images)
 * and ride as a URL reference so the WS event + persisted scene stay small.
 */

import type { Scene, SceneDiff } from './draw-dsl'

/**
 * A single drawing up to this size rides inline; larger ones spill to a blob
 * file and ride as a URL reference ("256k is okay" inline). It doubles as the
 * UI warn threshold: the size meter flags a drawing over this as "saved as file"
 * so a spill is never a surprise.
 */
export const DRAW_INLINE_MAX = 256 * 1024

/** Small drawing: the Excalidraw scene rides inline in the form state. */
export interface DrawInlineValue {
  kind: 'draw'
  /** Excalidraw scene as a JSON string. */
  snapshot: string
  bytes: number
  /** Blob URL of a PNG render of the scene, attached on submit for the transcript thumbnail. */
  thumbUrl?: string
}

/** Large drawing: snapshot spilled to a blob; only the URL rides the wire. */
export interface DrawRefValue {
  kind: 'draw-ref'
  /** Blob URL holding the Excalidraw scene JSON. */
  url: string
  bytes: number
  /** Blob URL of a PNG render of the scene, attached on submit for the transcript thumbnail. */
  thumbUrl?: string
}

/**
 * A DSL-authored drawing on submit (see draw-dsl.ts). The agent reads the COMPACT
 * `scene` + `diff` (the round-trip's point: not a 50KB element dump); the raw
 * Excalidraw `snapshot` rides alongside for fidelity / redraw / the PNG thumbnail,
 * inline when small and spilled to a blob (`excalidraw-ref`) when large.
 */
export interface ExcalidrawInlineValue {
  kind: 'excalidraw'
  /** Raw Excalidraw scene JSON (serializeAsJSON; elements carry customData.dslId). */
  snapshot: string
  /** Compact DSL reconstruction of the current scene. */
  scene: Scene
  /** What the user changed vs the seeded scene (incl the annotation layer). */
  diff: SceneDiff
  bytes: number
  thumbUrl?: string
}

/** Large DSL drawing: the raw snapshot spilled to a blob; scene+diff stay inline+compact. */
export interface ExcalidrawRefValue {
  kind: 'excalidraw-ref'
  /** Blob URL holding the raw Excalidraw scene JSON. */
  url: string
  scene: Scene
  diff: SceneDiff
  bytes: number
  thumbUrl?: string
}

export type DrawValue = DrawInlineValue | DrawRefValue | ExcalidrawInlineValue | ExcalidrawRefValue

export function isDrawValue(v: unknown): v is DrawValue {
  if (!v || typeof v !== 'object') return false
  const k = (v as { kind?: unknown }).kind
  return k === 'draw' || k === 'draw-ref' || k === 'excalidraw' || k === 'excalidraw-ref'
}

/** UTF-8 byte length of a string (snapshot sizing). */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length
}
