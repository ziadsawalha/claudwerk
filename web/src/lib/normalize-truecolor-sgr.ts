/**
 * Normalize colon-separated truecolor SGR that omits the color-space id, so
 * xterm.js 6.0 stops shifting the channels.
 *
 * THE BUG (Safari-visible, but actually renderer-independent / parser-level):
 *   Neovim >= 0.10 emits 24-bit color as the ISO-8613-6 COLON form WITHOUT a
 *   color-space id -- e.g. `ESC[48:2:34:36:54m` (5 sub-params: 48, 2, R, G, B).
 *   xterm.js 6.0 follows the strict reading where the colon form REQUIRES a
 *   color-space id (`48:2:Pi:R:G:B`), so it consumes R as Pi and shifts every
 *   channel: navy #222436 (34,36,54) -> olive-green (36,54,0). That is the
 *   "everything is green in vim" report.
 *
 * THE SPEC (https://gist.github.com/XVilka/8346728 -- the canonical truecolor
 *   reference): a terminal "may also accept the colon format with exactly 3
 *   parameters after `38:2:` and interpret them as red, green and blue
 *   (skipping color_space_id)." So accepting the no-id form is the CORRECT
 *   behavior; xterm.js 6.0 simply doesn't. WezTerm/iTerm/VS Code's build do.
 *
 * THE FIX: insert an EMPTY color-space id -- `38:2:R:G:B` -> `38:2::R:G:B`.
 *   xterm.js renders the empty-id form correctly (verified in a headless WebKit
 *   xterm.js 6.0 harness with neovim's real captured colors). Only the exact
 *   3-numeric-group (no-id) case is rewritten; the semicolon form, the
 *   already-has-an-id colon form, and every other SGR are left untouched.
 *   Covers fg (38), bg (48) and underline (58) color introducers.
 *
 * Applied at the xterm `write()` seam (host shells + the claude PTY both flow
 * through it). Real-world neovim redraws arrive as one PTY read -> one write,
 * so a color sequence split across two writes (which this per-chunk pass would
 * miss) is vanishingly rare and self-heals on the next redraw.
 */
const COLON_TRUECOLOR_NO_ID = /([345]8:2:)(\d+:\d+:\d+)([;m])/g

export function normalizeTruecolorSgr(data: string): string {
  // Fast path: skip the regex entirely unless a colon-form color marker is present.
  if (!data.includes(':2:')) return data
  return data.replace(COLON_TRUECOLOR_NO_ID, '$1:$2$3')
}
