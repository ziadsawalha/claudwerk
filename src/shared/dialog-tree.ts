/**
 * THE DIALOGUE — block-tree helpers.
 *
 * Pure structural edits over a dialog's block tree, keyed on stable `id`. Shared
 * by the op applier (`dialog-ops.ts`) and, later, the renderer's reconciliation.
 * Every helper mutates the array it's given in place and returns whether the
 * target id was found, recursing into container `children`.
 */

import type { DialogComponent, DialogLayout } from './dialog-schema'

type AnyBlock = DialogComponent & { id?: string; children?: DialogComponent[] }

/** The block arrays at the layout root: single `body`, or every page's `body`. */
export function rootArrays(layout: DialogLayout): DialogComponent[][] {
  if (Array.isArray(layout.body)) return [layout.body]
  if (Array.isArray(layout.pages)) return layout.pages.map(p => p.body)
  return []
}

export function replaceById(blocks: DialogComponent[], id: string, next: DialogComponent): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as AnyBlock
    if (b.id === id) {
      blocks[i] = next
      return true
    }
    if (Array.isArray(b.children) && replaceById(b.children, id, next)) return true
  }
  return false
}

export function removeById(blocks: DialogComponent[], id: string): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as AnyBlock
    if (b.id === id) {
      blocks.splice(i, 1)
      return true
    }
    if (Array.isArray(b.children) && removeById(b.children, id)) return true
  }
  return false
}

export function insertAfter(blocks: DialogComponent[], afterId: string, block: DialogComponent): boolean {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i] as AnyBlock
    if (b.id === afterId) {
      blocks.splice(i + 1, 0, block)
      return true
    }
    if (Array.isArray(b.children) && insertAfter(b.children, afterId, block)) return true
  }
  return false
}

/** The `children` array of the container with `id`, or null (not found / leaf). */
export function childrenOf(blocks: DialogComponent[], id: string): DialogComponent[] | null {
  for (const raw of blocks) {
    const b = raw as AnyBlock
    if (b.id === id) return Array.isArray(b.children) ? b.children : null
    if (Array.isArray(b.children)) {
      const nested = childrenOf(b.children, id)
      if (nested) return nested
    }
  }
  return null
}
