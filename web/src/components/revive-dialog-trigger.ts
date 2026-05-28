export interface ReviveDialogOptions {
  conversationId: string
}

/** Module-level bus so any component can pop the revive dialog. The
 *  ReviveDialog component registers its handler on mount and clears it on
 *  unmount; openers route through this bus. */
export const _reviveDialogBus: {
  open: ((options: ReviveDialogOptions) => void) | null
} = { open: null }

/** Open the revive dialog from anywhere */
export function openReviveDialog(options: ReviveDialogOptions): void {
  _reviveDialogBus.open?.(options)
}
