/**
 * Open buses for the lazy checklist modals (archive viewer, bulk markdown editor,
 * add-notes). Each carries the project URI it should open for. The inline block,
 * palette commands, and keybindings dispatch window events; the lazy bodies replay
 * them.
 */

import { createEventBus } from '@/lib/lazy-event-bus'

export interface ChecklistModalDetail {
  project: string
}

const ARCHIVE_EVENT = 'open-checklist-archive'
const BULK_EDIT_EVENT = 'open-checklist-bulk-edit'
const ADD_NOTES_EVENT = 'open-checklist-add-notes'

export const checklistArchiveBus = createEventBus<ChecklistModalDetail>(ARCHIVE_EVENT)
export const checklistBulkEditBus = createEventBus<ChecklistModalDetail>(BULK_EDIT_EVENT)
export const checklistAddNotesBus = createEventBus<ChecklistModalDetail>(ADD_NOTES_EVENT)

export function openChecklistArchive(project: string): void {
  window.dispatchEvent(new CustomEvent<ChecklistModalDetail>(ARCHIVE_EVENT, { detail: { project } }))
}

export function openChecklistBulkEdit(project: string): void {
  window.dispatchEvent(new CustomEvent<ChecklistModalDetail>(BULK_EDIT_EVENT, { detail: { project } }))
}

export function openChecklistAddNotes(project: string): void {
  window.dispatchEvent(new CustomEvent<ChecklistModalDetail>(ADD_NOTES_EVENT, { detail: { project } }))
}
