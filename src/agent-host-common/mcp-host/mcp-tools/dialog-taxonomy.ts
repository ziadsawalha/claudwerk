import { renderEntry, renderIndex, resolveSubject } from '../../../shared/dialog-taxonomy'
import type { ToolDef } from './types'

/**
 * dialog_taxonomy -- progressive-disclosure docs for the `dialog` block DSLs.
 *
 * Index-first: no subject -> a cheap table of contents + the gotchas that bite
 * first. With a subject -> ONE focused slice (~200-500 tokens). Lets an agent
 * master scene authoring (Draw/Excalidraw + ~20 other blocks) by pulling only
 * the slice it needs instead of inlining the whole spec.
 */
export function registerDialogTaxonomyTool(): Record<string, ToolDef> {
  return {
    dialog_taxonomy: {
      description:
        'On-demand reference for authoring `dialog` tool block DSLs -- the Draw/Excalidraw scene format and the ~20 other rich block types (Mermaid, DataModel, ApiEndpoint, Diff, AnnotatedCode, FileTree...). Call with NO subject for a cheap index (the subject tree + the gotchas that bite first); then call with a dotted `subject` to pull ONE focused slice into context (e.g. "draw", "draw.colors", "draw.elements.arrow", "draw.recipes", "mermaid", "datamodel"). Subjects are fuzzy/prefix/alias matched, so "arrow", "palette", or "draw.enums" all resolve. Use this BEFORE authoring a Draw scene or any rich block instead of guessing the schema -- the docs are pinned to the exact shipped Excalidraw version and encode claudewerk-specific gotchas (dark-mode palette, size spill, comment convention) that are in no upstream doc.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          subject: {
            type: 'string',
            description:
              'Dotted subject to disclose, e.g. "draw", "draw.colors", "draw.elements.arrow", "mermaid". Omit for the index/table-of-contents.',
          },
        },
      },
      async handle(params) {
        const raw = typeof params.subject === 'string' ? params.subject : ''
        if (!raw.trim()) {
          return { content: [{ type: 'text', text: renderIndex() }] }
        }

        const result = resolveSubject(raw)
        if ('entry' in result) {
          return { content: [{ type: 'text', text: renderEntry(result.entry) }] }
        }

        const suggestions = result.suggestions.map(s => `\`${s}\``).join(', ')
        return {
          content: [
            {
              type: 'text',
              text: `No taxonomy slice matches "${raw}". Did you mean one of: ${suggestions}?\n\nCall dialog_taxonomy() with no subject for the full index.`,
            },
          ],
        }
      },
    },
  }
}
