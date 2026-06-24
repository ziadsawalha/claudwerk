/**
 * The "nice display" renderer: a compact diagram `Scene` -> a crisp, theme-aware SVG string.
 * Uses `layoutDiagram` for a clean org-chart layout (uniform box widths on one spine) and
 * draws real org-chart connectors -- a split is ONE stem -> horizontal bus -> drops to each
 * child (and the mirror for a merge), with the label as a pill centred on the stem. Real
 * vector boxes, `text-anchor=middle` centering (no glyph estimate, ever), hand-authored dark
 * palette (no filter inversion). Pure -- runs any runtime.
 */
import { type DBox, type DConn, layoutDiagram } from './diagram-layout'
import { type DiagramTheme, PALETTES, type Palette } from './diagram-palette'
import type { Scene } from './draw-dsl'

const SANS = '-apple-system,BlinkMacSystemFont,&quot;Segoe UI&quot;,Roboto,Helvetica,Arial,sans-serif'
const MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const cxOf = (b: DBox): number => b.x + b.w / 2

/** Render a diagram Scene to a standalone SVG string in the given theme (default light). */
export function sceneToSvg(scene: Scene, theme: DiagramTheme = 'light'): string {
  const pal = PALETTES[theme]
  const { boxes, conns, width, height } = layoutDiagram(scene)
  const body = [...conns.map(c => connSvg(c, pal)), ...boxes.map(b => boxSvg(b, pal))].join('')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${pal.bg}"/>${body}</svg>`
  )
}

function boxSvg(b: DBox, pal: Palette): string {
  const c = pal.variants[b.variant]
  const cx = cxOf(b)
  const cy = b.y + b.h / 2
  const out = [
    `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="12" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`,
  ]
  if (b.title) out.push(textSvg(cx, b.subtitle ? cy - 6 : cy + 6, b.title, 17, 700, c.title, SANS))
  if (b.subtitle) out.push(textSvg(cx, cy + 18, b.subtitle, 12, 400, c.sub, MONO))
  return out.join('')
}

function connSvg(c: DConn, pal: Palette): string {
  if (c.kind === 'line') {
    const x = cxOf(c.from)
    const y0 = c.from.y + c.from.h
    const y1 = c.to.y
    return path(`M${x} ${y0} V${y1}`, pal) + pillAt(x, (y0 + y1) / 2, c.label, pal)
  }
  if (c.kind === 'split') return forkSvg(c.parent, c.children, c.label, pal, 'down')
  return forkSvg(c.child, c.parents, c.label, pal, 'up')
}

/** A stem from `hub` to a bus, the bus across the `spokes`, and a drop to each spoke. For a
 * split the hub is the parent above (dir 'down'); for a merge it is the child below ('up'). */
function forkSvg(hub: DBox, spokes: DBox[], label: string | undefined, pal: Palette, dir: 'down' | 'up'): string {
  const hubEdge = dir === 'down' ? hub.y + hub.h : hub.y
  const spokeEdge = dir === 'down' ? spokes[0].y : spokes[0].y + spokes[0].h
  const busY = (hubEdge + spokeEdge) / 2
  const hx = cxOf(hub)
  const xs = spokes.map(cxOf)
  const out = [
    path(`M${hx} ${hubEdge} V${busY}`, pal),
    path(`M${Math.min(...xs)} ${busY} H${Math.max(...xs)}`, pal),
    ...spokes.map(s => path(`M${cxOf(s)} ${busY} V${dir === 'down' ? s.y : s.y + s.h}`, pal)),
  ]
  return out.join('') + pillAt(hx, (hubEdge + busY) / 2, label, pal)
}

const path = (d: string, pal: Palette): string =>
  `<path d="${d}" fill="none" stroke="${pal.connector}" stroke-width="1.5"/>`

function pillAt(cx: number, cy: number, label: string | undefined, pal: Palette): string {
  if (!label) return ''
  const w = Math.round(label.length * 6.6 + 24)
  return (
    `<rect x="${cx - w / 2}" y="${cy - 13}" width="${w}" height="26" rx="13" fill="${pal.pill.fill}" stroke="${pal.pill.stroke}" stroke-width="1.2"/>` +
    textSvg(cx, cy + 4, label, 12.5, 600, pal.pill.text, SANS)
  )
}

function textSvg(x: number, y: number, s: string, size: number, weight: number, fill: string, font: string): string {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`
}
