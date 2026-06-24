/**
 * Project Order - persistent tree structure for the sidebar project list.
 *
 * Each leaf node represents a project keyed by its project URI
 * (e.g. `claude:///Users/jonas/projects/remote-claude`).
 * Legacy `cwd:<path>` node IDs are migrated on load.
 * Backed by StoreDriver KVStore (replaces JSON file persistence).
 */

import { cwdToProjectUri, projectIdentityKey } from '../shared/project-uri'
import type { KVStore } from './store/types'

// Types live in the shared module so the broker + web never drift. Only
// ProjectOrder is re-exported (the rest are imported where consumers use them
// directly from the shared module).
export type { ProjectOrder } from '../shared/project-order-types'

import type { ProjectOrder, ProjectOrderNode, Workspace } from '../shared/project-order-types'

// Guard-heavy input validator: cyclomatic is driven entirely by inherent type
// guards (cognitively trivial), and fallow's CRAP threshold grandfathers the far
// more complex normalize() in this same file. Kept as one readable function.
// fallow-ignore-next-line complexity
function sanitizeWorkspaces(raw: unknown): Workspace[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Workspace[] = []
  const seen = new Set<string>()
  for (const w of raw) {
    if (!w || typeof w !== 'object') continue
    const o = w as Record<string, unknown>
    if (typeof o.id !== 'string' || typeof o.name !== 'string' || seen.has(o.id)) continue
    seen.add(o.id)
    out.push({ id: o.id, name: o.name, ...(typeof o.color === 'string' ? { color: o.color } : {}) })
  }
  return out.length > 0 ? out : undefined
}

/** Keep only assignments that point at a real workspace id. */
function sanitizeAssignments(raw: unknown, validWs: Set<string>): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' && validWs.has(v)) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const KV_KEY = 'project-order'

let kv: KVStore | null = null
let order: ProjectOrder = { tree: [] }

/** Migrate a node ID from legacy `cwd:<path>` format to a canonical project URI.
 *  Also collapses profile userinfo, empty authority, quad-slash scars, and
 *  conversation fragments so sibling tree entries that name the same project
 *  dedupe into one node. */
function migrateNodeId(id: string): string {
  const upgraded = id.startsWith('cwd:') ? cwdToProjectUri(id.slice(4)) : id
  return projectIdentityKey(upgraded)
}

/**
 * Normalize legacy in-memory shapes to the current format. Accepts:
 *   - Current: { tree: [...] } with node.type === 'project' | 'group'
 *   - Legacy v2: { version: 2, tree: [...] } with leaf node.type === 'session'
 *   - Legacy node IDs: `cwd:<path>` -> project URI
 * Anything else returns an empty tree.
 */
function normalize(raw: unknown): { order: ProjectOrder; migrated: boolean } {
  if (!raw || typeof raw !== 'object') return { order: { tree: [] }, migrated: false }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.tree)) return { order: { tree: [] }, migrated: false }

  let migrated = false

  function walk(nodes: unknown[]): ProjectOrderNode[] {
    const out: ProjectOrderNode[] = []
    // Dedupe project IDs within this level -- profile-collapsed siblings
    // would otherwise produce duplicate keys that dnd-kit chokes on.
    const seenProjects = new Set<string>()
    for (const n of nodes) {
      if (!n || typeof n !== 'object') continue
      const node = n as Record<string, unknown>
      if (node.type === 'group' && typeof node.id === 'string' && typeof node.name === 'string') {
        const children = Array.isArray(node.children) ? walk(node.children) : []
        out.push({
          id: node.id,
          type: 'group',
          name: node.name,
          children,
          ...(typeof node.isOpen === 'boolean' ? { isOpen: node.isOpen } : {}),
        })
      } else if ((node.type === 'project' || node.type === 'session') && typeof node.id === 'string') {
        const newId = migrateNodeId(node.id)
        if (newId !== node.id) migrated = true
        if (seenProjects.has(newId)) {
          migrated = true
          continue
        }
        seenProjects.add(newId)
        out.push({ id: newId, type: 'project' })
      }
    }
    return out
  }

  // Workspaces tier (additive, migration-safe): old data has neither field.
  const workspaces = sanitizeWorkspaces(obj.workspaces)
  const assignments = sanitizeAssignments(obj.assignments, new Set((workspaces ?? []).map(w => w.id)))
  return {
    order: {
      tree: walk(obj.tree),
      ...(workspaces ? { workspaces } : {}),
      ...(assignments ? { assignments } : {}),
    },
    migrated,
  }
}

export function initProjectOrder(store: KVStore): void {
  kv = store

  const raw = kv.get<Record<string, unknown>>(KV_KEY)
  if (raw) {
    try {
      const wasLegacyFormat =
        'version' in raw || JSON.stringify((raw as { tree?: unknown }).tree ?? []).includes('"type":"session"')

      const { order: normalized, migrated: hadCwdIds } = normalize(raw)
      order = normalized

      if (wasLegacyFormat || hadCwdIds) save()
    } catch {
      order = { tree: [] }
    }
  }
}

function save(): void {
  if (!kv) return
  kv.set(KV_KEY, order)
}

export function getProjectOrder(): ProjectOrder {
  return order
}

export function setProjectOrder(update: ProjectOrder): void {
  if (!update || !Array.isArray(update.tree)) return
  const { order: normalized } = normalize(update)
  order = normalized
  save()
}

/** Extract all project URIs from a subtree. Routes through migrateNodeId so
 *  legacy or profile-bearing leaf IDs return their canonical form. */
function getAllTreeProjects(nodes: ProjectOrderNode[] = order.tree): Set<string> {
  const uris = new Set<string>()
  for (const node of nodes) {
    if (node.type === 'project') {
      uris.add(migrateNodeId(node.id))
    } else {
      for (const u of getAllTreeProjects(node.children)) uris.add(u)
    }
  }
  return uris
}

/** @deprecated Use getAllTreeProjects() instead. */
function _getAllTreeCwds(nodes: ProjectOrderNode[] = order.tree): Set<string> {
  return getAllTreeProjects(nodes)
}
