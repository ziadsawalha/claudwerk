/**
 * useChecklist - React binding for a project's active checklist. The WS client,
 * cache, and imperative actions live in lib/checklist-client.ts; this is just
 * the subscription + seed. Seeds via one `checklist_list` fetch and stays live
 * through `checklist_changed` broadcasts.
 */

import { useEffect, useSyncExternalStore } from 'react'
import {
  type ChecklistApi,
  EMPTY_CHECKLIST_API,
  getChecklistSnapshot,
  installChecklistHandler,
  seedChecklist,
  subscribeChecklist,
} from '@/lib/checklist-client'
import { useConversations } from './use-conversations'

export function useChecklist(projectUri: string | null): ChecklistApi {
  useEffect(() => {
    installChecklistHandler()
  }, [])

  // Reconnects churn the conversations list; use it to retrigger a deferred seed.
  const conversations = useConversations()

  const snapshot = useSyncExternalStore<ChecklistApi>(
    onChange => (projectUri ? subscribeChecklist(projectUri, onChange) : () => {}),
    () => (projectUri ? getChecklistSnapshot(projectUri) : EMPTY_CHECKLIST_API),
    () => EMPTY_CHECKLIST_API,
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: `conversations` is a deliberate retrigger -- a reconnect re-arms a deferred seed
  useEffect(() => {
    if (projectUri) seedChecklist(projectUri)
  }, [projectUri, conversations])

  return snapshot
}
