/** Structural equality on diff hunks. Strings compare by value, so two
 *  arrays with the same content but different refs (toolUseResult gets
 *  rehydrated on every transcript tick) are considered equal -- which keeps
 *  DiffView's memo + its Shiki tokenize useEffect from firing. O(total lines),
 *  bails on first mismatch, no allocation. */
export function patchesEqual(
  a: Array<{ oldStart: number; lines: string[] }>,
  b: Array<{ oldStart: number; lines: string[] }>,
): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i].oldStart !== b[i].oldStart) return false
    const al = a[i].lines
    const bl = b[i].lines
    if (al.length !== bl.length) return false
    for (let j = 0; j < al.length; j++) {
      if (al[j] !== bl[j]) return false
    }
  }
  return true
}
