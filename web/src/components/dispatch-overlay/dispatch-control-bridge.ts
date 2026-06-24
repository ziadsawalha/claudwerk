/**
 * Imperative debug bridge: exposes `window.__dispatch` so the `web_*`
 * remote-control tools (web_execute_script) can OPEN the cockpit, READ its
 * current state, and SUBMIT an intent for debugging. First-class debug seam.
 * Split out of dispatch-store.ts to keep the store lean.
 */

import { useDispatchStore } from './dispatch-store'

export function exposeDispatchControl(): void {
  if (typeof window === 'undefined') return
  const api = {
    open: () => useDispatchStore.getState().openOverlay(),
    close: () => useDispatchStore.getState().closeOverlay(),
    submit: (intent: string) => {
      useDispatchStore.getState().setIntent(intent)
      useDispatchStore.getState().submit()
    },
    setIntent: (intent: string) => useDispatchStore.getState().setIntent(intent),
    fetchThreads: () => useDispatchStore.getState().fetchThreads(),
    selectConv: (id: string | null) => useDispatchStore.getState().selectConv(id),
    /** A JSON-serialisable snapshot of what the cockpit is showing right now. */
    state: () => {
      const s = useDispatchStore.getState()
      return {
        open: s.open,
        userId: s.userId,
        intent: s.intent,
        pending: s.pending,
        lastError: s.lastError,
        rightPane: s.rightPane,
        activeConvId: s.activeConvId,
        model: s.model,
        decisionCount: s.decisions.length,
        latestDecision: s.decisions[0] ?? null,
        rosterCount: s.roster.length,
      }
    },
  }
  ;(window as unknown as { __dispatch?: typeof api }).__dispatch = api
}
