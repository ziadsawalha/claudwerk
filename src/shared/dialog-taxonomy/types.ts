/**
 * dialog_taxonomy -- progressive-disclosure docs for the dialog block DSLs.
 *
 * The dialog tool exposes ~20 rich block types, each a mini-DSL (Draw/Excalidraw,
 * Mermaid, DataModel, ApiEndpoint, Diff, AnnotatedCode, FileTree...). Authoring
 * them well needs more spec than fits in a tool description. This module is the
 * source-of-truth the `dialog_taxonomy(subject?)` MCP tool discloses ON DEMAND:
 * an agent pulls the one slice it needs (~200-500 tokens) instead of inlining the
 * whole spec (~6k tokens).
 *
 * Source-of-truth discipline: the Excalidraw raw-element schema (draw.*) is
 * transcribed from the INSTALLED `@excalidraw/excalidraw` types, pinned to the
 * shipped version (see EXCALIDRAW_VERSION in registry.ts). A test asserts the
 * documented version still matches web/package.json so the docs can't silently
 * drift from the real renderer.
 */

/** One disclosable slice of the taxonomy. `body` is markdown returned verbatim. */
export interface TaxonomyEntry {
  /** Canonical dotted subject id, e.g. "draw.elements.arrow". Lowercase. */
  subject: string
  /** Human title shown in the index. */
  title: string
  /** One-line summary shown in the index TOC. */
  summary: string
  /** The markdown disclosed when this subject is requested. */
  body: string
  /** Related subjects, surfaced as a "see also" footer. */
  related?: string[]
}

/** Rough token estimate for a string (chars/4) -- shown so an agent can budget. */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4)
}
