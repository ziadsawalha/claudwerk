import type { TaxonomyEntry } from './types'

/**
 * Non-draw dialog block DSLs. The dialog tool exposes ~20 block types; the rich
 * ones each get a slice here, and the `blocks` index lists them all so the
 * namespace is discoverable even where a deep slice isn't written yet.
 *
 * Grammar source: the `dialog` tool's body-component description in
 * src/shared/dialog-schema.ts (kept in sync with that schema).
 */
export const BLOCK_ENTRIES: TaxonomyEntry[] = [
  {
    subject: 'blocks',
    title: 'All dialog block types (index)',
    summary: 'Every block the dialog tool accepts, with a one-line shape and its deeper slice.',
    related: ['draw', 'mermaid', 'datamodel', 'apiendpoint', 'diff', 'annotatedcode', 'filetree'],
    body: `# Dialog block types

The \`dialog\` MCP tool renders these in \`body\` (single page) or \`pages\` (wizard). All
text/label fields support markdown.

## Display / content
- **Markdown** (\`content\` OR \`file\`, color?) -- prose; \`file\` references a local path to save tokens.
- **Image** (\`url\`, alt?)
- **Alert** (\`intent\`: info|warning|error|success, \`content\`)
- **Divider**
- **Diagram** (\`content\`, id?, commentable?) -- a mermaid diagram -> slice \`mermaid\`
- **Diff** (\`content\`: unified diff, filename?) -> slice \`diff\`
- **FileTree** (\`entries[{path,status?,note?}]\`, label?) -> slice \`filetree\`
- **DataModel** (\`name\`, \`fields[{name,type,note?,status?}]\`) -> slice \`datamodel\`
- **ApiEndpoint** (\`method\`, \`path\`, description?, request?, response?) -> slice \`apiendpoint\`
- **AnnotatedCode** (\`code\`, language?, filename?, \`annotations[{line,note}]\`) -> slice \`annotatedcode\`
- **Draw** (\`id\`, content?/contentUrl?, readOnly?, height?, label?) -- Excalidraw canvas -> slice \`draw\`

## Inputs (carry an \`id\`; values come back as \`values[id]\`)
- **Options** (\`id\`, \`options[{value,label,description?}]\`, multi?, required?, default?)
- **TextInput** (\`id\`, label?, placeholder?, required?, multiline?, default?)
- **Toggle** (\`id\`, \`label\`, default?)
- **Slider** (\`id\`, label?, min?, max?, step?, default?)
- **ImagePicker** (\`id\`, \`images[{value,url,label?}]\`, multi?, allowUpload?)
- **Button** (\`id\`, \`label\`, variant?: default|primary|outline|ghost, intent?: neutral|destructive|success)

## Layout containers (have \`children[]\`)
- **Stack** (direction?: vertical|horizontal), **Grid** (columns?), **Group** (label, collapsed?)

Colors anywhere: primary|secondary|muted|accent|destructive|success|warning|info.
Call \`dialog_taxonomy('<block>')\` for a deeper slice where one exists.`,
  },
  {
    subject: 'mermaid',
    title: 'Diagram block (mermaid)',
    summary: 'A mermaid diagram; in live dialogs nodes can be commentable.',
    related: ['blocks', 'draw'],
    body: `# Diagram block (mermaid)

\`\`\`json
{ "type": "Diagram", "id": "arch", "commentable": true,
  "content": "graph TD; A[Client]-->B[Broker]; B-->C[(DB)]" }
\`\`\`
- \`content\`: mermaid source (graph/flowchart/sequence/class/state/er/gantt...).
- \`id\`: required for live dialogs / commentable.
- \`commentable: true\` (live dialogs only): the user clicks a node to attach a note; notes
  arrive as \`values[id] = { <nodeId>: "<note>" }\`. Redraw to address them.

Mermaid is best for STRUCTURED graphs (boxes+edges with auto-layout). For a freeform,
hand-drawn, user-editable canvas use a \`Draw\` block instead (slice \`draw\`).`,
  },
  {
    subject: 'datamodel',
    title: 'DataModel block',
    summary: 'A named entity with typed fields; status per field for diffs.',
    related: ['blocks', 'apiendpoint'],
    body: `# DataModel block

\`\`\`json
{ "type": "DataModel", "name": "User",
  "fields": [
    { "name": "id", "type": "uuid", "note": "PK" },
    { "name": "email", "type": "string", "status": "added" },
    { "name": "legacyId", "type": "int", "status": "removed" }
  ] }
\`\`\`
- \`fields[].status\`: added | modified | removed | unchanged -- renders as a schema diff.
- Use to present a table/entity shape, a schema change, or a type definition.`,
  },
  {
    subject: 'apiendpoint',
    title: 'ApiEndpoint block',
    summary: 'An HTTP endpoint with method/path and JSON request/response samples.',
    related: ['blocks', 'datamodel'],
    body: `# ApiEndpoint block

\`\`\`json
{ "type": "ApiEndpoint", "method": "POST", "path": "/api/files",
  "description": "Upload a scene blob",
  "request": "{ \\"name\\": \\"scene.json\\" }",
  "response": "{ \\"url\\": \\"https://concentrator.frst.dev/file/x.json\\" }" }
\`\`\`
- \`method\`: GET|POST|PUT|PATCH|DELETE...; \`path\`: the route.
- \`request\`/\`response\`: JSON STRINGS (escaped) shown as formatted samples.`,
  },
  {
    subject: 'diff',
    title: 'Diff block',
    summary: 'A unified-diff text blob, optionally with a filename header.',
    related: ['blocks', 'annotatedcode'],
    body: `# Diff block

\`\`\`json
{ "type": "Diff", "filename": "src/foo.ts",
  "content": "@@ -1,3 +1,3 @@\\n-const a = 1\\n+const a = 2\\n const b = 3" }
\`\`\`
- \`content\`: standard unified diff text (\`@@\` hunks, \`+\`/\`-\` lines). Rendered with
  add/remove highlighting. \`filename\` is an optional header.`,
  },
  {
    subject: 'annotatedcode',
    title: 'AnnotatedCode block',
    summary: 'A code block with per-line margin notes.',
    related: ['blocks', 'diff'],
    body: `# AnnotatedCode block

\`\`\`json
{ "type": "AnnotatedCode", "language": "ts", "filename": "draw.ts",
  "code": "export const DRAW_INLINE_MAX = 256 * 1024",
  "annotations": [ { "line": 1, "note": "scenes over this spill to a blob" } ] }
\`\`\`
- \`annotations[].line\`: 1-based line number; \`note\`: the margin comment.
- Use to walk a reader through specific lines of code.`,
  },
  {
    subject: 'filetree',
    title: 'FileTree block',
    summary: 'A file tree with per-entry status and notes.',
    related: ['blocks'],
    body: `# FileTree block

\`\`\`json
{ "type": "FileTree", "label": "changes",
  "entries": [
    { "path": "src/shared/dialog-taxonomy/registry.ts", "status": "added" },
    { "path": "src/shared/dialog-schema.ts", "status": "modified", "note": "pointer line" }
  ] }
\`\`\`
- \`entries[].status\`: added | modified | removed | unchanged. The tree is derived from
  the \`path\`s. Use to show a change set or a directory layout.`,
  },
]
