/**
 * Paste/drop image+file upload for a dialog text field -- the same behaviour the
 * CM6 composer has: paste or drop a file/screenshot -> upload to /api/files ->
 * insert the markdown result (`![name](url)` for images, `[name](url)` otherwise)
 * at the cursor. The field stays a controlled component (writes via form.setValue).
 *
 * No ref needed: the handlers read the live element off the event (`currentTarget`),
 * which is stable across the controlled re-renders, so cursor position + the
 * placeholder->result replace both operate on current text.
 */
import type { ClipboardEvent, DragEvent } from 'react'
import { useCallback } from 'react'
import { uploadFileWithPlaceholder } from '@/lib/upload'
import type { DialogFormState } from './dialog-renderer'

type FieldEl = HTMLInputElement | HTMLTextAreaElement

/** Files carried by a paste: prefer clipboard ITEMS (covers screenshots, which
 *  appear only as items, not as files), fall back to the files list. */
export function clipboardFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const out: File[] = []
  for (const item of dt.items ?? []) {
    if (item.kind === 'file') {
      const f = item.getAsFile()
      if (f) out.push(f)
    }
  }
  if (out.length === 0) for (const f of dt.files ?? []) out.push(f)
  return out
}

export function useDialogPaste(id: string, form: DialogFormState) {
  const upload = useCallback(
    (file: File, el: FieldEl) => {
      const current = () => el.value ?? ((form.values[id] as string) || '')
      uploadFileWithPlaceholder(
        file,
        ph => {
          const v = current()
          const pos = el.selectionStart ?? v.length
          form.setValue(id, v.slice(0, pos) + ph + v.slice(pos))
        },
        (search, replacement) => form.setValue(id, current().replace(search, replacement)),
        form.conversationId,
      )
    },
    [id, form],
  )

  const onPaste = useCallback(
    (e: ClipboardEvent) => {
      const files = clipboardFiles(e.clipboardData)
      if (files.length === 0) return // plain text paste -> let the browser handle it
      e.preventDefault()
      const el = e.currentTarget as FieldEl
      for (const f of files) upload(f, el)
    },
    [upload],
  )

  const onDrop = useCallback(
    (e: DragEvent) => {
      const files = Array.from((e.dataTransfer?.files ?? []) as FileList)
      if (files.length === 0) return
      e.preventDefault()
      const el = e.currentTarget as FieldEl
      for (const f of files) upload(f, el)
    },
    [upload],
  )

  return { onPaste, onDrop }
}
