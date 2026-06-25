/**
 * THE DIALOGUE — pure page helpers shared by the persistent (live) dialog tab
 * surface. A layout is either single-page (`body`) or multi-page (`pages`); a
 * live dialog renders multiple pages as TABS and the agent moves focus with the
 * `setPage` op (parked in the reserved `_activePage` state key). These helpers
 * stay pure so the resolution + change-detection are unit-testable without React.
 */
import type { DialogComponent, DialogLayout, DialogPage } from './types'

/** Normalize any layout to a page list. Single-`body` -> one unlabelled page. */
export function layoutPages(layout: DialogLayout): DialogPage[] {
  if (layout.pages && layout.pages.length > 0) return layout.pages
  return [{ label: '', body: layout.body ?? [] }]
}

/**
 * Resolve the agent-focused page (`_activePage`, an index or a label) to a valid
 * index, or `undefined` when there's nothing to follow. A number is clamped into
 * range; a string matches a page label (exact, then case-insensitive).
 */
export function resolvePageIndex(raw: unknown, pages: DialogPage[]): number | undefined {
  if (pages.length === 0) return undefined
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(Math.max(0, Math.trunc(raw)), pages.length - 1)
  }
  if (typeof raw === 'string' && raw !== '') {
    const exact = pages.findIndex(p => p.label === raw)
    if (exact >= 0) return exact
    const lower = raw.toLowerCase()
    const ci = pages.findIndex(p => p.label.toLowerCase() === lower)
    return ci >= 0 ? ci : undefined
  }
  return undefined
}

/** Does this block subtree contain any of the highlighted ids (recursively)? */
function subtreeHasId(block: DialogComponent, ids: Set<string>): boolean {
  const id = (block as { id?: string }).id
  if (id && ids.has(id)) return true
  const children = (block as { children?: DialogComponent[] }).children
  return Array.isArray(children) && children.some(c => subtreeHasId(c, ids))
}

/** Per-page flag: does the page hold a block the agent just changed? Drives the
 *  "changed" dot on a non-focused tab so an off-screen patch is still visible. */
export function pagesWithChanges(pages: DialogPage[], highlightIds: Set<string>): boolean[] {
  if (highlightIds.size === 0) return pages.map(() => false)
  return pages.map(p => p.body.some(b => subtreeHasId(b, highlightIds)))
}
