import type { TaxonomyEntry } from './types'

/**
 * draw.* SCHEMA slices -- the raw Excalidraw element shape, transcribed from the
 * installed @excalidraw/excalidraw types (pinned, see EXCALIDRAW_VERSION). These
 * describe WHAT fields exist; the guidance slices (draw-guide.ts) cover HOW/why.
 */
export const DRAW_SCHEMA_ENTRIES: TaxonomyEntry[] = [
  {
    subject: 'draw',
    title: 'Draw block (Excalidraw scene) -- overview',
    summary: 'How to author a Draw block: the scene envelope, the minimal element, seeding, spill.',
    related: [
      'draw.envelope',
      'draw.base',
      'draw.elements',
      'draw.colors',
      'draw.gotchas',
      'draw.recipes',
      'draw.examples',
    ],
    body: `# Draw block -- author an Excalidraw scene

A Draw block renders an INTERACTIVE Excalidraw whiteboard. You author a **scene**:
the JSON \`serializeAsJSON()\` returns -- \`elements\` + \`appState\` + \`files\`. The user
edits and submits it back.

## Minimal working scene
\`\`\`json
{
  "type": "excalidraw", "version": 2, "source": "https://claudewerk",
  "elements": [
    { "id": "r1", "type": "rectangle", "x": 100, "y": 100, "width": 200, "height": 80,
      "strokeColor": "#1e1e1e", "backgroundColor": "#a5d8ff" }
  ],
  "appState": { "theme": "dark", "viewBackgroundColor": "transparent", "scrollToContent": true },
  "files": {}
}
\`\`\`
You only need to emit the fields you care about -- Excalidraw's \`restore()\` fills the
rest (seed, versionNonce, index, roughness, opacity, ...). See \`draw.base\` for which
fields are truly required vs auto-filled.

## Seeding it into a dialog
A \`Draw\` block takes \`content\` (inline scene JSON string) OR \`contentUrl\` (a blob URL
holding that JSON, for large scenes). Best in a persistent dialog with width "wide"/"full".

## On submit you get it back
\`values[id] = {kind:"draw", snapshot, bytes}\` (small) or \`{kind:"draw-ref", url, bytes}\`
(large -- fetch the url). To redraw the user's edit, feed the same scene/url back as
\`content\`/\`contentUrl\`.

## Inline size cap / spill
Scenes over **256 KB** (\`DRAW_INLINE_MAX\`) spill to a blob \`contentUrl\` instead of
inline \`content\`. Upload via \`mcp__rclaude__share_file\` -> it returns a same-origin
\`concentrator.frst.dev/file/*.json\` URL the panel fetches clean (no CORS). Seed that as
\`contentUrl\`.

Next: \`draw.colors\` (CRITICAL dark-mode palette), \`draw.elements\`, \`draw.recipes\`.`,
  },
  {
    subject: 'draw.envelope',
    title: 'Scene envelope',
    summary: 'The {type,version,source,elements,appState,files} wrapper + key appState fields.',
    related: ['draw', 'draw.base', 'draw.colors'],
    body: `# Scene envelope

\`\`\`ts
{
  type: "excalidraw",   // literal
  version: 2,           // schema version (current)
  source: string,       // free; e.g. "https://claudewerk"
  elements: Element[],  // see draw.elements
  appState: {...},      // canvas state (subset below)
  files: {...}          // image blobs, keyed by fileId; {} if none
}
\`\`\`

## appState fields that matter for authoring
- \`theme\`: "light" | "dark". The claudewerk canvas defaults to **"dark"** -- seed it in
  appState, NEVER via the controlled \`theme\` prop. See \`draw.gotchas\`.
- \`viewBackgroundColor\`: string | "transparent". Use "transparent" so the canvas bg shows.
- \`scrollToContent\`: true -> auto-frames (centers + fits) the drawing on load. Almost
  always want this.
- \`gridSize\`: number | null.

Everything else in appState is optional; \`restore()\` supplies sane defaults.

## files (images only)
\`files\` maps \`fileId\` -> \`{ id, mimeType, dataURL, created, ... }\`. Only needed when the
scene has \`image\` elements. See \`draw.elements.image\`.`,
  },
  {
    subject: 'draw.base',
    title: 'Base element fields',
    summary: 'Fields every element shares -- which are required vs auto-filled by restore().',
    related: ['draw.elements', 'draw.enums', 'draw.envelope'],
    body: `# Base element fields (shared by ALL element types)

\`\`\`ts
{
  id: string,                 // REQUIRED, unique within scene
  type: string,               // REQUIRED, see draw.elements
  x: number, y: number,       // REQUIRED, top-left in scene coords
  width: number, height: number, // REQUIRED for shapes/text/image/frame
  strokeColor: string,        // ink/outline hex -- see draw.colors
  backgroundColor: string,    // fill hex, or "transparent"
  fillStyle: "hachure"|"cross-hatch"|"solid"|"zigzag",
  strokeWidth: number,        // 1 thin / 2 bold / 4 extra-bold (typical)
  strokeStyle: "solid"|"dashed"|"dotted",
  roughness: 0|1|2,           // 0 architect / 1 artist / 2 cartoonist
  opacity: number,            // 0..100
  angle: number,              // rotation in RADIANS
  roundness: null | { type: 1|2|3, value?: number }, // null = sharp corners
  groupIds: string[],         // shared id groups elements together
  frameId: string | null,
  boundElements: [{id,type:"text"|"arrow"}] | null, // see draw.bindings
  link: string | null,
  locked: boolean,
  customData?: Record<string, any>, // free-form; see draw.comments
  // --- auto-filled by restore(), you can OMIT these ---
  seed, version, versionNonce, index, isDeleted, updated
}
\`\`\`

**Practical minimum for a hand-authored element:** \`id\`, \`type\`, \`x\`, \`y\`,
\`width\`/\`height\` (where applicable), plus the type-specific fields and any styling
(\`strokeColor\`, \`backgroundColor\`). Omit \`seed\`/\`version\`/\`versionNonce\`/\`index\` --
\`restore()\` generates them. Emitting them by hand risks collisions.`,
  },
  {
    subject: 'draw.elements',
    title: 'Element types (index)',
    summary: 'The element type union + which slice documents each.',
    related: [
      'draw.elements.shapes',
      'draw.elements.text',
      'draw.elements.arrow',
      'draw.elements.freedraw',
      'draw.elements.image',
      'draw.elements.frame',
    ],
    body: `# Element types

| type | slice | notes |
|------|-------|-------|
| rectangle, diamond, ellipse | \`draw.elements.shapes\` | the generic shapes; \`roundness\` for rounded |
| text | \`draw.elements.text\` | fontSize/fontFamily/align; standalone or bound to a container |
| line, arrow | \`draw.elements.arrow\` | linear: \`points[]\`, bindings, arrowheads; arrow adds \`elbowed\` |
| freedraw | \`draw.elements.freedraw\` | hand-drawn stroke: \`points[]\`+\`pressures[]\` |
| image | \`draw.elements.image\` | \`fileId\` + a \`files\` entry |
| frame | \`draw.elements.frame\` | named container region |
| embeddable, iframe, magicframe | (rare) | web embeds / AI frames -- base fields + a link/name |

\`selection\` also exists but is editor-transient; never author it.

All share the base fields in \`draw.base\` and the enums in \`draw.enums\`.`,
  },
  {
    subject: 'draw.elements.shapes',
    title: 'rectangle / diamond / ellipse',
    summary: 'The three generic shapes; rounded corners via roundness.',
    related: ['draw.base', 'draw.bindings', 'draw.colors'],
    body: `# rectangle / diamond / ellipse

Generic shapes -- base fields only, no extras. \`x,y\` = top-left of the bounding box;
\`width,height\` size it (a diamond/ellipse is inscribed in that box).

\`\`\`json
{ "id": "box1", "type": "rectangle", "x": 80, "y": 80, "width": 220, "height": 100,
  "strokeColor": "#1e1e1e", "backgroundColor": "#b2f2bb", "fillStyle": "solid",
  "roundness": { "type": 3 } }
\`\`\`

- **Rounded corners:** \`roundness: { "type": 3 }\` (adaptive). \`null\` = sharp. See \`draw.enums\`.
- These are the bindable flowchart nodes -- attach labels (\`draw.elements.text\`) and
  connect with arrows (\`draw.bindings\`).`,
  },
  {
    subject: 'draw.elements.text',
    title: 'text element',
    summary: 'fontSize/fontFamily/align; standalone label or bound inside a container.',
    related: ['draw.base', 'draw.bindings'],
    body: `# text element

\`\`\`ts
{
  type: "text",
  text: string,             // the content
  fontSize: number,         // px, e.g. 16 / 20 / 28
  fontFamily: 1|2|3|5|6,    // 1 Virgil(hand) 2 Helvetica 3 Cascadia(code) 5 Excalifont(hand) 6 Nunito
  textAlign: "left"|"center"|"right",
  verticalAlign: "top"|"middle"|"bottom",
  containerId: string|null, // set when bound INSIDE a shape (see draw.bindings)
  originalText: string,     // usually == text
  lineHeight: number,       // unitless, e.g. 1.25
  autoResize: boolean       // true = box fits text; false = wrap to width
}
\`\`\`

Fonts fetch from a CDN at render time. **Excalifont (5)** is the default hand-drawn look;
**Cascadia (3)** for code/monospace.

- **Standalone label:** just place it at \`x,y\` with \`containerId: null\`.
- **Centered inside a shape:** use the binding pattern in \`draw.bindings\` (the container
  gets \`boundElements\`, the text gets \`containerId\`). Excalidraw then centers + wraps it.`,
  },
  {
    subject: 'draw.elements.arrow',
    title: 'line / arrow (linear elements)',
    summary: 'points[] geometry, start/end bindings, arrowheads, elbowed arrows, polygons.',
    related: ['draw.bindings', 'draw.enums', 'draw.recipes'],
    body: `# line / arrow (linear elements)

\`\`\`ts
{
  type: "line" | "arrow",
  points: [[0,0],[dx,dy],...], // RELATIVE to the element's x,y; first is [0,0]
  startBinding: {elementId,focus,gap} | null, // arrows: glue to a shape
  endBinding:   {elementId,focus,gap} | null,
  startArrowhead: Arrowhead | null,
  endArrowhead:   Arrowhead | null,  // arrows default endArrowhead "arrow"
  // arrow only:
  elbowed: boolean             // true = right-angle routed arrow
}
\`\`\`

\`points\` are offsets from the element's \`x,y\`. A 2-point arrow: \`[[0,0],[120,0]]\` (rightward).
\`width\`/\`height\` should match the points' bounding box.

**Arrowheads** (\`draw.enums\` has the full list): \`arrow\`, \`bar\`, \`dot\`, \`circle\`,
\`triangle\`, \`diamond\` (+ \`_outline\` variants), \`crowfoot_one|many|one_or_many\`.

**Bindings** glue an arrow's ends to shapes so it reflows when they move -- see \`draw.bindings\`.

**Closed shapes / triangles / polygons:** make a \`line\` whose \`points\` RETURN TO ORIGIN
(last point == first, \`[0,0]\`) and give it a \`backgroundColor\` + \`fillStyle\` to fill it.
This is the version-safe way to draw a triangle/flame/arbitrary polygon. (Newer Excalidraw
also accepts \`polygon: true\` on a line as a convenience flag, but it is NOT part of the
pinned ${''}schema -- prefer the closed-points form for portability. See draw.gotchas.)`,
  },
  {
    subject: 'draw.elements.freedraw',
    title: 'freedraw element',
    summary: 'Hand-drawn stroke: points[] + pressures[] + simulatePressure.',
    related: ['draw.base'],
    body: `# freedraw element

A pen stroke.
\`\`\`ts
{
  type: "freedraw",
  points: [[0,0],[dx,dy],...], // relative to x,y, many points
  pressures: number[],          // per-point pressure 0..1; [] if none
  simulatePressure: boolean     // true = taper from velocity when pressures empty
}
\`\`\`
Rarely hand-authored (it's what the pen tool produces). For deliberate shapes prefer
\`line\`/\`arrow\` (\`draw.elements.arrow\`).`,
  },
  {
    subject: 'draw.elements.image',
    title: 'image element + files',
    summary: 'fileId + status + scale + a matching files entry (dataURL).',
    related: ['draw.envelope', 'draw.base'],
    body: `# image element

\`\`\`ts
// element:
{ type: "image", fileId: "abc", status: "saved", scale: [1,1], crop: null,
  x, y, width, height }
// + a matching entry in the scene's files map:
"files": {
  "abc": { "id": "abc", "mimeType": "image/png", "dataURL": "data:image/png;base64,...",
           "created": 0 }
}
\`\`\`
The element's \`fileId\` MUST key into \`files\`. \`status\`: "pending"|"saved"|"error".
\`scale\` is [x,y] flip factors. For large images, prefer letting the user paste/upload
rather than embedding a giant dataURL (counts toward the 256 KB inline cap -- see \`draw\`).`,
  },
  {
    subject: 'draw.elements.frame',
    title: 'frame element',
    summary: 'A named region; child elements reference it via frameId.',
    related: ['draw.base'],
    body: `# frame element

\`\`\`ts
{ type: "frame", name: string|null, x, y, width, height }
\`\`\`
A labelled container region. Elements inside it set \`frameId\` to the frame's \`id\`.
Use to group + title a sub-diagram. (\`magicframe\` is the AI-generation variant; same shape.)`,
  },
  {
    subject: 'draw.enums',
    title: 'Enums (fillStyle, strokeStyle, roughness, roundness, arrowheads)',
    summary: 'Every enum value, transcribed from the pinned @excalidraw types.',
    related: ['draw.base', 'draw.elements.arrow'],
    body: `# Enums (pinned to the shipped @excalidraw version)

- **fillStyle:** \`hachure\` | \`cross-hatch\` | \`solid\` | \`zigzag\`
- **strokeStyle:** \`solid\` | \`dashed\` | \`dotted\`
- **roughness:** \`0\` architect (clean) | \`1\` artist (default) | \`2\` cartoonist (loose)
- **roundness.type:** \`1\` LEGACY | \`2\` PROPORTIONAL_RADIUS | \`3\` ADAPTIVE_RADIUS.
  Use \`{type:3}\` for rounded; \`null\` for sharp.
- **fontFamily:** \`1\` Virgil | \`2\` Helvetica | \`3\` Cascadia (code) | \`5\` Excalifont
  (hand-drawn) | \`6\` Nunito
- **textAlign:** \`left\` | \`center\` | \`right\`  -- **verticalAlign:** \`top\` | \`middle\` | \`bottom\`
- **Arrowhead:** \`arrow\` | \`bar\` | \`dot\` | \`circle\` | \`circle_outline\` | \`triangle\`
  | \`triangle_outline\` | \`diamond\` | \`diamond_outline\` | \`crowfoot_one\`
  | \`crowfoot_many\` | \`crowfoot_one_or_many\` | \`null\`
- **theme:** \`light\` | \`dark\`  -- **image status:** \`pending\` | \`saved\` | \`error\``,
  },
  {
    subject: 'draw.bindings',
    title: 'Bindings (arrows to shapes, text to containers)',
    summary: 'How arrows glue to shapes and how text centers inside a shape.',
    related: ['draw.elements.arrow', 'draw.elements.text', 'draw.recipes'],
    body: `# Bindings

## Arrow bound to shapes (reflows when they move)
On the arrow:
\`\`\`json
"startBinding": { "elementId": "boxA", "focus": 0, "gap": 4 },
"endBinding":   { "elementId": "boxB", "focus": 0, "gap": 4 }
\`\`\`
- \`focus\`: -1..1, where along the shape edge the arrow aims (0 = center).
- \`gap\`: px gap between arrow tip and shape.
On EACH bound shape, add the arrow to its \`boundElements\`:
\`\`\`json
"boundElements": [ { "id": "arrow1", "type": "arrow" } ]
\`\`\`

## Text centered inside a shape (a labelled box)
- Container shape gets: \`"boundElements": [ { "id": "t1", "type": "text" } ]\`
- Text element gets:    \`"containerId": "<shape id>"\` (and Excalidraw centers + wraps it).

Elbowed arrows (\`"elbowed": true\`) use fixed-point bindings; for simple diagrams plain
bindings + a 2-point \`points\` array are enough. See \`draw.recipes\` for a full flow example.`,
  },
]
