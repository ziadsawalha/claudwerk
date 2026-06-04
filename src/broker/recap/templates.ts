/**
 * Recap template loader.
 *
 * A "template" is a self-contained `.yml` file that re-presents the recap
 * material as a named deliverable. Templates swap ONLY the synthesis/oneshot
 * presentation prompt + a set of toggles; they NEVER touch extraction (the MAP
 * prompt stays a constant extract-all), storage, or the protocol. See
 * `.claude/docs/plan-recap-templates.md`.
 *
 * This module reads a directory of template files, zod-validates each one, and
 * returns the valid set. A malformed file is SKIPPED and logged as a structured
 * event (LOG-EVERYTHING covenant) -- never silently mis-rendered. Callers fall
 * back to the DEFAULT_TEMPLATE_ID template via {@link pickTemplate}.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Liquid } from 'liquidjs'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod/v4'

/** The default template id -- ports today's all-projects human recap byte-for-byte. */
export const DEFAULT_TEMPLATE_ID = 'project-recap'

/** Prod path -- bind-mounted (`./recap-templates:/srv/recap-templates:ro`). */
const PROD_TEMPLATES_DIR = '/srv/recap-templates'
/** Dev fallback -- the committed built-ins at the repo root. */
const DEV_TEMPLATES_DIR = resolve(import.meta.dir, '../../../recap-templates')

// The FIXED frontmatter vocabulary a template may select + order. Templates
// re-present within this set; they NEVER introduce a new EXTRACTED category
// (that would mean changing the constant MAP prompt -- out of scope for v1).
// Mirrors the item/list fields in render/parse-recap.ts.
const SECTION_VOCABULARY = [
  'features',
  'bugs',
  'fixes',
  'incidents',
  'decisions',
  'dead_ends',
  'gotchas',
  'frustrations',
  'open_questions',
  'went_well',
  'went_badly',
  'recommendations',
] as const

// The gather signals a template may default on or an option may flip. Mirrors
// RecapSignal in shared/protocol.ts (kept as a local const so the schema can use
// z.enum without dragging the protocol type into a value position).
const RECAP_SIGNALS = [
  'user_prompts',
  'assistant_final_turn',
  'commits',
  'task_results',
  'tool_summaries',
  'errors_hooks',
  'cost',
  'open_questions',
  'turn_internals',
] as const

const optionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  default: z.boolean().default(false),
  // Technical option: flips a gather signal (acts in code, BEFORE any prompt).
  // Absent => pure prompt-tweak (exposed as `options.<id>` in the Liquid body).
  signal: z.enum(RECAP_SIGNALS).optional(),
})

export const templateManifestSchema = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'id must be kebab-case (a-z, 0-9, -)'),
  label: z.string().min(1),
  description: z.string().min(1),
  // v1 is fleet-only; field present for forward-compat.
  scope: z.enum(['fleet']).default('fleet'),
  // Template OWNS audience (human narrative | agent orientation brief).
  audience: z.enum(['human', 'agent']).default('human'),
  defaults: z
    .object({
      retrospect: z.boolean().default(false),
      customerFriendly: z.boolean().default(false),
      signals: z.array(z.enum(RECAP_SIGNALS)).default([]),
    })
    .default({ retrospect: false, customerFriendly: false, signals: [] }),
  // Subset + order of the fixed frontmatter vocabulary (no new INDEXED fields).
  sections: z.array(z.enum(SECTION_VOCABULARY)).default([]),
  options: z.array(optionSchema).default([]),
  // The shared presentation body, authored as a LiquidJS template.
  body: z.string().min(1),
})

export type RecapTemplate = z.infer<typeof templateManifestSchema>
export type RecapTemplateOption = z.infer<typeof optionSchema>

/** Structured event emitted whenever a template is skipped or falls back. */
export interface TemplateLoadEvent {
  event: 'recap_template_skipped' | 'recap_templates_dir_missing' | 'recap_template_fallback'
  /** Source file (or requested id, for a fallback). */
  file?: string
  reason: string
}

export type TemplateLogger = (event: TemplateLoadEvent) => void

/** Default logger: one structured line per event (LOG-EVERYTHING covenant). */
const defaultLogger: TemplateLogger = e => {
  console.warn(`[recap-templates] ${JSON.stringify(e)}`)
}

export interface LoadTemplatesResult {
  /** Valid templates keyed by id. */
  templates: Map<string, RecapTemplate>
  /** Files that failed to load, with the reason (mirrors what was logged). */
  skipped: TemplateLoadEvent[]
}

// A shared parse-only Liquid instance -- used to reject bodies with syntax
// errors at load time instead of letting them mis-render later.
const liquid = new Liquid()

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

type ValidateResult = { ok: true; template: RecapTemplate } | { ok: false; event: TemplateLoadEvent }

function skip(file: string, reason: string): { ok: false; event: TemplateLoadEvent } {
  return { ok: false, event: { event: 'recap_template_skipped', file, reason } }
}

type ReadResult = { ok: true; value: unknown } | { ok: false; event: TemplateLoadEvent }

// Read + YAML-parse a manifest file. Both failure modes collapse to a skip event.
function readManifest(path: string, file: string): ReadResult {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (err) {
    return skip(file, `read failed: ${describe(err)}`)
  }
  try {
    return { ok: true, value: parseYaml(raw) }
  } catch (err) {
    return skip(file, `yaml parse failed: ${describe(err)}`)
  }
}

function validateOne(path: string, file: string): ValidateResult {
  const read = readManifest(path, file)
  if (!read.ok) return read

  const result = templateManifestSchema.safeParse(read.value)
  if (!result.success) {
    const reason = result.error.issues.map(i => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ')
    return skip(file, `schema invalid: ${reason}`)
  }

  // A Liquid syntax error would otherwise surface only at render time as a
  // mis-rendered prompt -- catch it here so the template is skipped, not shipped.
  try {
    liquid.parse(result.data.body)
  } catch (err) {
    return skip(file, `liquid syntax error: ${describe(err)}`)
  }

  return { ok: true, template: result.data }
}

/** Resolve the active templates dir: prod bind-mount if present, else dev repo. */
export function resolveTemplatesDir(): string {
  return existsSync(PROD_TEMPLATES_DIR) ? PROD_TEMPLATES_DIR : DEV_TEMPLATES_DIR
}

// Fold one validated file into the accumulating set: drop it (with a structured
// event) on validation failure or a duplicate id, otherwise register it.
function ingest(
  res: ValidateResult,
  file: string,
  templates: Map<string, RecapTemplate>,
  reject: (ev: TemplateLoadEvent) => void,
): void {
  if (!res.ok) {
    reject(res.event)
  } else if (templates.has(res.template.id)) {
    reject({ event: 'recap_template_skipped', file, reason: `duplicate id: ${res.template.id}` })
  } else {
    templates.set(res.template.id, res.template)
  }
}

/**
 * Read + validate every `.yml`/`.yaml` template in `dir`. Invalid files are
 * skipped and logged; the valid set is returned. Never throws on a bad file.
 */
export function loadTemplatesFromDir(dir: string, log: TemplateLogger = defaultLogger): LoadTemplatesResult {
  const templates = new Map<string, RecapTemplate>()
  const skipped: TemplateLoadEvent[] = []
  const reject = (ev: TemplateLoadEvent) => {
    log(ev)
    skipped.push(ev)
  }

  if (!existsSync(dir)) {
    reject({ event: 'recap_templates_dir_missing', reason: `templates dir not found: ${dir}` })
    return { templates, skipped }
  }

  const files = readdirSync(dir)
    .filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort()
  for (const file of files) {
    ingest(validateOne(join(dir, file), file), file, templates, reject)
  }

  return { templates, skipped }
}

/** Convenience: resolve the active dir and load it. */
export function loadTemplates(log: TemplateLogger = defaultLogger): LoadTemplatesResult {
  return loadTemplatesFromDir(resolveTemplatesDir(), log)
}

/**
 * Render a template body to its final prompt string. Uses the same sandboxed
 * Liquid instance the loader parse-checks with, so a body that loaded cleanly
 * renders without surprises. Synchronous -- the recap prompt builder is sync.
 */
export function renderTemplateBody(template: RecapTemplate, context: Record<string, unknown>): string {
  return liquid.parseAndRenderSync(template.body, context)
}

/**
 * Pick the requested template, falling back to {@link DEFAULT_TEMPLATE_ID} when
 * it is missing. Returns undefined only if the default itself is absent (an
 * empty/broken template set). The fallback is logged as a structured event.
 */
export function pickTemplate(
  templates: Map<string, RecapTemplate>,
  id: string | undefined,
  log: TemplateLogger = defaultLogger,
): RecapTemplate | undefined {
  const wanted = id ?? DEFAULT_TEMPLATE_ID
  const found = templates.get(wanted)
  if (found) return found

  if (wanted !== DEFAULT_TEMPLATE_ID) {
    log({
      event: 'recap_template_fallback',
      file: wanted,
      reason: `template "${wanted}" not found, falling back to ${DEFAULT_TEMPLATE_ID}`,
    })
    return templates.get(DEFAULT_TEMPLATE_ID)
  }
  return undefined
}
