/**
 * Open buses for the two lazy checklist modals (archive viewer + bulk markdown
 * editor). Both carry the project URI they should open for. The inline block
 * and the command palette dispatch window events; the lazy bodies replay them.
 */

import { createEventBus } from '@/lib/lazy-event-bus'

export interface ChecklistModalDetail {
  project: string
}

const ARCHIVE_EVENT = 'open-checklist-archive'
const BULK_EDIT_EVENT = 'open-checklist-bulk-edit'

export const checklistArchiveBus = createEventBus<ChecklistModalDetail>(ARCHIVE_EVENT)
export const checklistBulkEditBus = createEventBus<ChecklistModalDetail>(BULK_EDIT_EVENT)

export function openChecklistArchive(project: string): void {
  window.dispatchEvent(new CustomEvent<ChecklistModalDetail>(ARCHIVE_EVENT, { detail: { project } }))
}

export function openChecklistBulkEdit(project: string): void {
  window.dispatchEvent(new CustomEvent<ChecklistModalDetail>(BULK_EDIT_EVENT, { detail: { project } }))
}
