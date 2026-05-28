export interface RecapCustomRangeOptions {
  projectUri: string
}

/** Module-level bus so any component can pop the dialog open. The
 *  RecapCustomRangeDialog component registers its handler on mount and clears
 *  it on unmount; openers route through this bus instead of importing the
 *  component (which would mix non-component exports back into a Fast-Refresh
 *  file). */
export const _recapCustomRangeBus: {
  open: ((options: RecapCustomRangeOptions) => void) | null
} = { open: null }

export function openRecapCustomRangeDialog(options: RecapCustomRangeOptions): void {
  _recapCustomRangeBus.open?.(options)
}
