/**
 * DSL layout pass: turn a `Scene` (nested nodes, no coordinates) into a flat list of
 * absolutely-positioned `Placed` nodes -- so the agent NEVER does pixel math. Pure
 * (no Excalidraw); the skeleton pass consumes the output.
 *
 *   - Containers (row/col/grid/card/screen) distribute children from intrinsic sizes.
 *   - `layout:'free'` honours each node's explicit `at`.
 *   - `layout:'flow'` (default) lays bare edge-connected nodes top-down by graph rank
 *     (a Sugiyama-lite: rank = longest path from a root), so a flowchart reads cleanly.
 */
import { type DslNode, type Edge, isContainer, type Placed, type Scene, SIZE } from './draw-dsl'
import { max, measure } from './draw-dsl-measure'

const gapOf = (n: DslNode): number => ('gap' in n && typeof n.gap === 'number' ? n.gap : SIZE.gap)

/** Place a node (and its subtree) at an absolute top-left. */
function placeNode(node: DslNode, x: number, y: number): Placed {
  const { w, h } = measure(node)
  if (!isContainer(node.kind)) return { node, x, y, w, h }
  return { node, x, y, w, h, children: placeChildren(node, x, y, w, h) }
}

/** Dispatch a container's children to the right placement strategy. */
function placeChildren(node: DslNode, x: number, y: number, w: number, h: number): Placed[] {
  const gap = gapOf(node)
  if (node.kind === 'row') return placeAxis(node.children, 'row', x, y, gap, h, alignOf(node))
  if (node.kind === 'col') return placeAxis(node.children, 'col', x, y, gap, w, alignOf(node))
  if (node.kind === 'grid') return placeGrid(node.children, Math.max(1, node.cols), x, y, gap)
  if (node.kind === 'card' || node.kind === 'screen') return placeFrame(node.children, x, y, gap)
  return []
}

/** Lay children along one axis; `cross` is the perpendicular extent for alignment. */
function placeAxis(
  children: DslNode[],
  axis: 'row' | 'col',
  x: number,
  y: number,
  gap: number,
  crossSize: number,
  align: 'start' | 'center' | 'end',
): Placed[] {
  const out: Placed[] = []
  let cursor = axis === 'row' ? x : y
  for (const c of children) {
    const cm = measure(c)
    const off = cross(crossSize, axis === 'row' ? cm.h : cm.w, align)
    out.push(axis === 'row' ? placeNode(c, cursor, y + off) : placeNode(c, x + off, cursor))
    cursor += (axis === 'row' ? cm.w : cm.h) + gap
  }
  return out
}

function placeGrid(children: DslNode[], cols: number, x: number, y: number, gap: number): Placed[] {
  const ms = children.map(measure)
  const cw = max(ms.map(m => m.w))
  const ch = max(ms.map(m => m.h))
  return children.map((c, i) => placeNode(c, x + (i % cols) * (cw + gap), y + Math.floor(i / cols) * (ch + gap)))
}

/** card / screen: a frame; children stack as a col inside the padded body. */
function placeFrame(children: DslNode[], x: number, y: number, gap: number): Placed[] {
  const out: Placed[] = []
  let cy = y + SIZE.titleBar + SIZE.pad
  for (const c of children) {
    out.push(placeNode(c, x + SIZE.pad, cy))
    cy += measure(c).h + gap
  }
  return out
}

/** Top-level placement for a whole scene. */
export function placeScene(scene: Scene): Placed[] {
  const nodes = scene.nodes
  if (scene.layout === 'free') return nodes.map(n => placeNode(n, n.at?.[0] ?? 0, n.at?.[1] ?? 0))

  const containers = nodes.filter(n => isContainer(n.kind))
  const leaves = nodes.filter(n => !isContainer(n.kind))
  const edges = scene.edges ?? []
  const placed: Placed[] = []
  let y = 0

  if (edges.length && leaves.length) {
    const flow = placeFlow(leaves, edges, y)
    placed.push(...flow)
    y = bottom(flow) + SIZE.gap * 2
  } else {
    for (const n of leaves) {
      const p = placeNode(n, 0, y)
      placed.push(p)
      y += p.h + SIZE.gap
    }
  }
  for (const c of containers) {
    const p = placeNode(c, 0, y)
    placed.push(p)
    y += p.h + SIZE.gap
  }
  return placed
}

/** Layered top-down placement of edge-connected leaf nodes (rank = longest path from a root).
 * Each rank is packed by its boxes' ACTUAL widths and the whole row is centred on the diagram
 * mid-line, so single-box ranks stack on one straight spine (no zig-zag) and sibling rows stay
 * tight + symmetric instead of being flung to fixed max-width column slots. */
function placeFlow(leaves: DslNode[], edges: Edge[], y0: number): Placed[] {
  const rank = computeRanks(leaves, edges)
  const ch = max(leaves.map(n => measure(n).h))
  const hGap = 60
  const vGap = 80
  const byRank = groupByRank(leaves, rank)
  const rowWidth = (row: DslNode[]): number => row.reduce((w, n) => w + measure(n).w, 0) + (row.length - 1) * hGap
  const fullW = max([...byRank.values()].map(rowWidth))
  const out: Placed[] = []
  for (const [r, row] of [...byRank.entries()].sort((a, b) => a[0] - b[0])) {
    let x = (fullW - rowWidth(row)) / 2
    for (const n of row) {
      out.push(placeNode(n, x, y0 + r * (ch + vGap)))
      x += measure(n).w + hGap
    }
  }
  return out
}

/** rank(node) = longest path from a root (a node with no incoming edge); cycles -> 0. */
function computeRanks(leaves: DslNode[], edges: Edge[]): Map<string, number> {
  const ids = new Set(leaves.flatMap(n => ('id' in n && n.id ? [n.id] : [])))
  const rank = new Map<string, number>()
  const rankOf = (id: string, seen: Set<string>): number => {
    if (rank.has(id)) return rank.get(id) as number
    if (seen.has(id)) return 0
    seen.add(id)
    const preds = edges.filter(e => e.to === id && ids.has(e.from))
    const r = preds.length ? Math.max(...preds.map(e => rankOf(e.from, seen) + 1)) : 0
    rank.set(id, r)
    return r
  }
  for (const id of ids) rankOf(id, new Set())
  return rank
}

function groupByRank(leaves: DslNode[], rank: Map<string, number>): Map<number, DslNode[]> {
  const byRank = new Map<number, DslNode[]>()
  for (const n of leaves) {
    const r = 'id' in n && n.id ? (rank.get(n.id) ?? 0) : 0
    const row = byRank.get(r) ?? []
    row.push(n)
    byRank.set(r, row)
  }
  return byRank
}

const bottom = (ps: Placed[]): number => max(ps.map(p => p.y + p.h))
const alignOf = (n: DslNode): 'start' | 'center' | 'end' => ('align' in n && n.align ? n.align : 'start')
const cross = (outer: number, inner: number, align: 'start' | 'center' | 'end'): number =>
  align === 'center' ? (outer - inner) / 2 : align === 'end' ? outer - inner : 0
