/**
 * Shared test fixtures for SOTU contributions -- so the view / spawn-brief / route
 * / handler tests build a claim/stake callout the same way without copy-pasting the
 * literal (keeps the duplication gate green). Test-only; imported by *.test.ts.
 */

import type { CalloutContrib } from './types'

/** A high-weight `lock` callout carrying a claim on `path`. */
export function claimContrib(convId: string, ts: number, path = 'src/auth.ts'): CalloutContrib {
  return {
    kind: 'callout',
    convId,
    ts,
    type: 'lock',
    payload: 'editing',
    weight: 'high',
    target: { kind: 'claim', path },
  }
}
