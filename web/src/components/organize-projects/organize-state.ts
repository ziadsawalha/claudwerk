/**
 * Module state for the Organize Projects modal.
 *
 * Open/close only -- the modal reads the live project order itself. Co-located
 * with the modal so the sidebar button and the command palette can pop it open
 * without importing the (lazy) modal chunk.
 */

import { useEffect, useState } from 'react'

type Listener = (open: boolean) => void

let open = false
const listeners = new Set<Listener>()

function notify(): void {
  for (const l of listeners) l(open)
}

export function openOrganizeProjects(): void {
  open = true
  notify()
}

export function closeOrganizeProjects(): void {
  open = false
  notify()
}

export function useOrganizeProjectsOpen(): boolean {
  const [snapshot, setSnapshot] = useState(open)
  useEffect(() => {
    listeners.add(setSnapshot)
    return () => {
      listeners.delete(setSnapshot)
    }
  }, [])
  return snapshot
}
