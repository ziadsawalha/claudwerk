/**
 * Display layout for the SVG diagram renderer. Reuses the DSL rank assignment (`placeScene`
 * gives each box its rank via its y), then RE-LAYS the x axis for a clean org-chart: every box
 * is the SAME width (single-box ranks = the widest natural box; sibling ranks split that width
 * evenly), centred on one vertical spine. Edges are classified into line / split (fan-out) /
 * merge (fan-in) groups so the renderer can draw one stem -> bus -> drops instead of N
 * self-routing elbows. Pure -- no SVG, no Excalidraw.
 */
import type { Edge, Scene, SchemeVariant } from './draw-dsl'
import { placeScene } from './draw-dsl-layout'

export interface DBox {
  id?: string
  title: string
  subtitle?: string
  variant: SchemeVariant
  x: number
  y: number
  w: number
  h: number
}

export type DConn =
  | { kind: 'line'; from: DBox; to: DBox; label?: string }
  | { kind: 'split'; parent: DBox; children: DBox[]; label?: string }
  | { kind: 'merge'; child: DBox; parents: DBox[]; label?: string }

export interface DiagramLayout {
  boxes: DBox[]
  conns: DConn[]
  width: number
  height: number
}

const GAP = 40
const PAD = 28

export function layoutDiagram(scene: Scene): DiagramLayout {
  const boxes = placeScene(scene).map(toBox)
  const maxW = Math.max(0, ...boxes.map(b => b.w))
  uniformWidths(boxes, maxW)
  for (const b of boxes) {
    b.x += PAD
    b.y += PAD
  }
  const conns = classifyConns(scene, new Map(boxes.filter(b => b.id).map(b => [b.id as string, b])))
  return {
    boxes,
    conns,
    width: Math.round(maxW + PAD * 2),
    height: Math.round(Math.max(0, ...boxes.map(b => b.y + b.h)) + PAD),
  }
}

function toBox(p: { node: unknown; x: number; y: number; w: number; h: number }): DBox {
  const n = p.node as { id?: string; title?: string; text?: string; subtitle?: string; variant?: SchemeVariant }
  return {
    id: n.id,
    title: n.title ?? n.text ?? '',
    subtitle: n.subtitle,
    variant: n.variant ?? 'plain',
    x: p.x,
    y: p.y,
    w: p.w,
    h: p.h,
  }
}

/** Re-flow each rank (boxes sharing a y) to one common width, centred on the spine. */
function uniformWidths(boxes: DBox[], maxW: number): void {
  const byRank = new Map<number, DBox[]>()
  for (const b of boxes) {
    const row = byRank.get(b.y) ?? []
    row.push(b)
    byRank.set(b.y, row)
  }
  for (const row of byRank.values()) {
    row.sort((a, b) => a.x - b.x)
    const n = row.length
    const bw = n === 1 ? maxW : (maxW - (n - 1) * GAP) / n
    row.forEach((b, i) => {
      b.x = i * (bw + GAP)
      b.w = bw
    })
  }
}

const key = (f: string, t: string): string => `${f}|${t}`
const boxes = (ids: string[], byId: Map<string, DBox>): DBox[] =>
  ids.map(i => byId.get(i)).filter((b): b is DBox => !!b)

/** Group edges into line / split (one parent -> many) / merge (many -> one) connectors. */
function classifyConns(scene: Scene, byId: Map<string, DBox>): DConn[] {
  const edges: Edge[] = scene.edges ?? []
  const used = new Set<string>()
  return [
    ...splitConns(
      groupBy(
        edges,
        e => e.from,
        e => e.to,
      ),
      byId,
      edges,
      used,
    ),
    ...mergeConns(
      groupBy(
        edges,
        e => e.to,
        e => e.from,
      ),
      byId,
      edges,
      used,
    ),
    ...lineConns(edges, byId, used),
  ]
}

/** One parent fanning out to many children -> a split (and mark those edges consumed). */
function splitConns(outs: Map<string, string[]>, byId: Map<string, DBox>, edges: Edge[], used: Set<string>): DConn[] {
  const out: DConn[] = []
  for (const [from, tos] of outs) {
    const parent = byId.get(from)
    const children = boxes(tos, byId)
    if (tos.length <= 1 || !parent || children.length <= 1) continue
    out.push({ kind: 'split', parent, children, label: labelFor(edges, e => e.from === from && tos.includes(e.to)) })
    for (const t of tos) used.add(key(from, t))
  }
  return out
}

/** Many parents converging on one child -> a merge (skipping edges a split already claimed). */
function mergeConns(ins: Map<string, string[]>, byId: Map<string, DBox>, edges: Edge[], used: Set<string>): DConn[] {
  const out: DConn[] = []
  for (const [to, froms] of ins) {
    const rest = froms.filter(f => !used.has(key(f, to)))
    const child = byId.get(to)
    const parents = boxes(rest, byId)
    if (rest.length <= 1 || !child || parents.length <= 1) continue
    out.push({ kind: 'merge', child, parents, label: labelFor(edges, e => e.to === to && rest.includes(e.from)) })
    for (const f of rest) used.add(key(f, to))
  }
  return out
}

/** Every remaining 1:1 edge -> a straight line. */
function lineConns(edges: Edge[], byId: Map<string, DBox>, used: Set<string>): DConn[] {
  const out: DConn[] = []
  for (const e of edges) {
    const from = byId.get(e.from)
    const to = byId.get(e.to)
    if (!used.has(key(e.from, e.to)) && from && to) out.push({ kind: 'line', from, to, label: e.text })
  }
  return out
}

function groupBy<T, K extends string, V>(items: T[], k: (x: T) => K, v: (x: T) => V): Map<K, V[]> {
  const m = new Map<K, V[]>()
  for (const it of items) {
    const arr = m.get(k(it)) ?? []
    arr.push(v(it))
    m.set(k(it), arr)
  }
  return m
}

const labelFor = (edges: Edge[], pred: (e: Edge) => boolean): string | undefined =>
  edges.find(e => pred(e) && e.text)?.text
