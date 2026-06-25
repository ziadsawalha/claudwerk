/**
 * Nightshift modal opener + tab state. The Nightshift modal is a single parkable,
 * project-scoped managed modal with three tabs (Outlook / Status / Report). Any
 * entry point (project context menu, the action panel card) calls
 * `openNightshiftModal(projectUri, tab)` to open it on a specific tab.
 */

import { create } from 'zustand'
import { useModalManagerStore } from './use-modal-manager'

export type NightshiftTab = 'outlook' | 'status' | 'report'

const NIGHTSHIFT_MODAL = { id: 'nightshift', kind: 'nightshift', title: 'Nightshift' }

interface NightshiftModalState {
  tab: NightshiftTab
  setTab: (tab: NightshiftTab) => void
}

export const useNightshiftModalStore = create<NightshiftModalState>(set => ({
  tab: 'outlook',
  setTab: tab => set({ tab }),
}))

/** Open (or re-focus) the Nightshift modal for a project on a given tab. */
export function openNightshiftModal(projectUri: string, tab: NightshiftTab = 'report'): void {
  useNightshiftModalStore.getState().setTab(tab)
  useModalManagerStore.getState().open(NIGHTSHIFT_MODAL, { type: 'project', uri: projectUri })
}
