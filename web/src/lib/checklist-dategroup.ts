/**
 * Group resolved checklist items into date buckets (Today / Yesterday / N days
 * ago / an absolute date) for the archive view, newest bucket first. Pure so it
 * can be unit-tested without a clock -- pass `now` in.
 */

import type { ChecklistItem } from '@shared/protocol'

export interface DateBucket {
  label: string
  items: ChecklistItem[]
}

function startOfDay(ms: number): number {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function labelFor(dayMs: number, todayMs: number): string {
  const days = Math.round((todayMs - dayMs) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(dayMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Bucket items by their resolution day. Items must already be sorted newest-first. */
export function groupByResolvedDate(items: ChecklistItem[], now: number): DateBucket[] {
  const today = startOfDay(now)
  const buckets: DateBucket[] = []
  let currentDay: number | null = null
  for (const item of items) {
    const day = startOfDay(item.resolvedAt ?? item.updatedAt)
    if (day !== currentDay) {
      currentDay = day
      buckets.push({ label: labelFor(day, today), items: [] })
    }
    buckets[buckets.length - 1].items.push(item)
  }
  return buckets
}
