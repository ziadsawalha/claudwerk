/**
 * Launch Profile -- a named bundle of spawn defaults the user can fire
 * via chord (Cmd+J) or palette or the spawn dialog dropdown.
 *
 * Consumers:
 * - Broker storage:  src/broker/launch-profiles/
 * - HTTP routes:     src/broker/launch-profiles/routes.ts
 * - Spawn resolver:  src/shared/spawn-defaults.ts (profile tier)
 * - Control panel:   web/src/components/launch-profiles/
 */

import { z } from 'zod'
import { spawnRequestSchema } from './spawn-schema'

export const LAUNCH_PROFILE_ID_PREFIX = 'lp_'
export const LAUNCH_PROFILE_MAX_APPEND_SP = 16 * 1024
export const LAUNCH_PROFILE_MAX_COUNT = 50

const MAX_NAME = 64
const MAX_SHORT_LABEL = 24

// Backends whose spawn path honors `--append-system-prompt`. `daemon` is in
// the set: spike 2 (plan Section 8) live-verified `claude --bg
// --append-system-prompt` is functionally applied by the daemon worker.
export const BACKENDS_WITH_APPEND_SYSTEM_PROMPT = ['claude', 'chat-api', 'daemon'] as const

export function backendSupportsAppendSystemPrompt(backend: string | undefined): boolean {
  if (!backend) return true
  return (BACKENDS_WITH_APPEND_SYSTEM_PROMPT as readonly string[]).includes(backend)
}

const PROFILE_COLOR_OPTIONS = ['primary', 'success', 'warning', 'destructive', 'info', 'muted'] as const

// A profile carries reusable spawn DEFAULTS, never per-launch identifiers.
// `cwd` / `jobId` are resolved at launch; `daemonResumeSessionId` (the daemon
// session to fork from) and `daemonAttachShort` (a roster worker's id) are
// ephemeral targets that only make sense for one specific launch -- omitting
// them means a stale value can never be persisted into a profile, and zod
// strips the keys on parse if an old profile carried them.
const profileSpawnSchema = spawnRequestSchema
  .omit({ cwd: true, jobId: true, daemonResumeSessionId: true, daemonAttachShort: true })
  .extend({
    appendSystemPrompt: z.string().max(LAUNCH_PROFILE_MAX_APPEND_SP, 'appendSystemPrompt exceeds 16 KB cap').optional(),
  })
  .partial()
  .extend({
    // `attach` is a per-launch mode (the attach target is an ephemeral roster
    // worker) -- a daemon profile only ever persists `new` or `resume`.
    daemonMode: z.enum(['new', 'resume']).optional(),
  })

export const launchProfileSchema = z.object({
  id: z.string().startsWith(LAUNCH_PROFILE_ID_PREFIX),
  name: z.string().min(1, 'name is required').max(MAX_NAME),
  shortLabel: z.string().max(MAX_SHORT_LABEL).optional(),
  icon: z.string().max(64).optional(),
  color: z.enum(PROFILE_COLOR_OPTIONS).optional(),
  order: z.number().int().optional(),

  chord: z.string().max(32).optional(),
  immediate: z.boolean().optional(),

  sentinel: z.string().max(128).optional(),
  project: z.string().max(2048).optional(),

  spawn: profileSpawnSchema,

  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),

  lastUsedAt: z.number().int().nonnegative().optional(),
  useCount: z.number().int().nonnegative().optional(),
})
export type LaunchProfile = z.infer<typeof launchProfileSchema>

export const launchProfileListSchema = z
  .array(launchProfileSchema)
  .max(LAUNCH_PROFILE_MAX_COUNT, `at most ${LAUNCH_PROFILE_MAX_COUNT} profiles`)

export function newLaunchProfileId(): string {
  // Web Crypto global -- works in both the browser and Bun. `node:crypto`
  // does NOT survive bundling for the control panel (the polyfill has no
  // randomUUID export), and this module is shared with web/.
  return `${LAUNCH_PROFILE_ID_PREFIX}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
}

export function isLaunchProfileId(id: unknown): id is string {
  return (
    typeof id === 'string' && id.startsWith(LAUNCH_PROFILE_ID_PREFIX) && id.length > LAUNCH_PROFILE_ID_PREFIX.length
  )
}
