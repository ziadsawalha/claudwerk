/**
 * Fetch helper for the recap template manifest (`GET /api/recap-templates`).
 *
 * The endpoint lists the broker's built-in templates + their declared options so
 * the recap-config modal can offer a picker. The Liquid body is never exposed.
 * Templates re-present, they do not re-extract; selecting one swaps the
 * presentation prompt + toggles its declared options (technical = flips a gather
 * signal, prompt-tweak = flips a body boolean -- resolved broker-side).
 *
 * Cached module-level after the first successful load (the built-in set is fleet
 * metadata, not per-project, and is stable between deploys).
 */

import { appendShareParam } from '@/lib/share-mode'

export interface RecapTemplateOptionMeta {
  id: string
  label: string
  default: boolean
  /** present iff the option flips a gather signal (technical wire) */
  signal?: string
}

export interface RecapTemplateMeta {
  id: string
  label: string
  description: string
  scope: string
  audience: 'human' | 'agent'
  sections: string[]
  defaults: { retrospect: boolean; customerFriendly: boolean; signals: string[] }
  options: RecapTemplateOptionMeta[]
  isDefault: boolean
}

export interface RecapTemplateManifest {
  templates: RecapTemplateMeta[]
  defaultTemplateId: string
}

let cached: RecapTemplateManifest | null = null

/** Fetch the template manifest (cached). Returns null on any failure so callers
 *  can fall back to the default-template-only path (no picker). */
export async function fetchRecapTemplates(): Promise<RecapTemplateManifest | null> {
  if (cached) return cached
  try {
    const res = await fetch(appendShareParam('/api/recap-templates'))
    if (!res.ok) return null
    const data = (await res.json()) as RecapTemplateManifest
    if (!Array.isArray(data?.templates) || typeof data?.defaultTemplateId !== 'string') return null
    cached = data
    return data
  } catch {
    return null
  }
}

/** Resolve the default boolean map for a template's declared options. */
export function defaultOptionFlags(template: RecapTemplateMeta): Record<string, boolean> {
  const flags: Record<string, boolean> = {}
  for (const o of template.options) flags[o.id] = o.default
  return flags
}
