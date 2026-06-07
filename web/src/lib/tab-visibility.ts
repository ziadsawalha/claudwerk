// Toggles `data-tab-hidden` on <html> whenever the tab is backgrounded, so CSS
// can freeze every running animation while nobody is looking (see the
// `html[data-tab-hidden]` rule in styles/globals.css).
//
// WHY (composite/layer memory): infinite CSS animations -- `animate-spin` on
// every active/booting conversation's StatusIndicator, `animate-pulse` on the
// PERM/LINK/WAITING/COMPACT pills, the live connection dot, the cache timer --
// each hold a dedicated compositing layer and keep recompositing every frame
// for as long as they run. WebKit/Safari throttles JS + rAF when a tab is
// hidden, but does NOT stop compositor-thread CSS animations, so a fleet list
// with dozens of these keeps burning GPU/render-tree memory and composite
// cycles on a tab nobody is viewing. Pausing them when hidden reclaims that
// work with zero visible change (the paused state is, by definition, never
// painted).
//
// Pure attribute toggle -- no React, install once from main.tsx before render.

let installed = false

function apply(hidden: boolean) {
  const root = document.documentElement
  if (hidden) root.setAttribute('data-tab-hidden', '')
  else root.removeAttribute('data-tab-hidden')
}

export function installTabVisibility() {
  if (installed || typeof document === 'undefined') return
  installed = true
  apply(document.hidden)
  document.addEventListener('visibilitychange', () => apply(document.hidden))
}
