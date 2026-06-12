/**
 * Robust JSON extraction from LLM output. LLMs love to wrap JSON in
 * markdown fences, prepend "Sure! Here's your JSON:", or trail off with
 * "Hope this helps". We strip all of that and grab the first balanced
 * object we can find.
 *
 * parseRecapContent lives in src/shared/recap.ts (the control panel parses
 * the same away_summary payloads) -- re-exported here for broker callers.
 */

export { parseRecapContent } from '../../../shared/recap'

export function findFirstJsonObject(raw: string): string | null {
  const stripped = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')
  const match = stripped.match(/\{[\s\S]*\}/)
  return match ? match[0] : null
}
