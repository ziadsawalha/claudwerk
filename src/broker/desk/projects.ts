/**
 * Project model for the dispatcher BRAIN (plan-dispatcher-brain.md P1).
 *
 * PROJECTS are the #1 anchor -- all memory + routing hang off a project. This
 * module turns the broker's project registry into the dispatcher's view: a
 * stable memory KEY per project (`projectIdentityKey`), a human label, and the
 * spawnable cwd. It also resolves a NAMED project ("arr", a slug, a uri, a path
 * tail) to that view, so the dispatcher can route or SPAWN into a project that
 * has zero live conversations (the `arr`-with-no-conversation case).
 *
 * The fuzzy resolver + shapers are pure (take a `Project[]` / `DeskProject[]`)
 * so they unit-test without the store; the thin wrappers read live state.
 */

import { extractProjectLabel, parseProjectUri, projectIdentityKey } from '../../shared/project-uri'
import { getProjectBySlug, listProjects, type Project } from '../project-store'

export interface DeskProject {
  /** Canonical, stable memory key (group-by identity; the memory store keys on this). */
  key: string
  /** Canonical project identity URI. */
  projectUri: string
  /** URL-safe short slug from the store. */
  slug: string
  /** Human label (last path segment / stored label). */
  label: string
  /** Filesystem path to spawn into, when the URI is path-backed. Null otherwise. */
  cwd: string | null
}

/** The fs path for a project_uri, when it is path-backed (`claude://host/abs/path`).
 *  Only the local Claude backend (incl. the `daemon` transport alias) maps to a
 *  real filesystem cwd; other schemes (agent://, api://, ephemeral://) do not. */
export function projectCwd(projectUri: string): string | null {
  try {
    const parsed = parseProjectUri(projectUri)
    if (parsed.scheme !== 'claude' && parsed.scheme !== 'daemon') return null
    return parsed.path?.startsWith('/') ? parsed.path : null
  } catch {
    return null
  }
}

/** The stable memory key for a conversation's project string (null when none). */
export function projectKeyOf(project: string | null | undefined): string | null {
  if (!project || project === '*') return null
  try {
    return projectIdentityKey(project)
  } catch {
    return null
  }
}

/** Shape a stored Project into the dispatcher's view. */
export function toDeskProject(p: Project): DeskProject {
  const projectUri = p.project_uri
  return {
    key: projectIdentityKey(projectUri),
    projectUri,
    slug: p.slug,
    label: p.label ?? extractProjectLabel(projectUri),
    cwd: projectCwd(projectUri),
  }
}

/** All known projects as dispatcher views, de-duplicated by memory key. */
export function listDeskProjects(): DeskProject[] {
  const out = new Map<string, DeskProject>()
  for (const p of listProjects()) {
    const dp = toDeskProject(p)
    if (!out.has(dp.key)) out.set(dp.key, dp)
  }
  return [...out.values()]
}

/**
 * Pick the best matching project from a list for a free-text name. Pure so the
 * matching logic is unit-testable. Priority: exact slug/label -> substring.
 */
export function pickProject(projects: DeskProject[], name: string): DeskProject | null {
  const ql = name.trim().toLowerCase()
  if (!ql) return null
  return (
    projects.find(p => p.slug === ql || p.label.toLowerCase() === ql) ??
    projects.find(p => p.key.toLowerCase() === ql) ??
    projects.find(p => p.slug.includes(ql) || p.label.toLowerCase().includes(ql)) ??
    null
  )
}

/**
 * Resolve a NAMED project to a dispatcher view. Handles a project URI (even one
 * not yet in the registry -- still routable), an exact slug, or a fuzzy label /
 * slug / path-tail. Returns null only when nothing plausibly matches.
 */
export function resolveDeskProject(name: string): DeskProject | null {
  const q = name.trim()
  if (!q) return null

  // A URI -> identity-key match (or a valid-but-unregistered project: still routable).
  if (q.includes('://')) {
    const key = projectKeyOf(q)
    if (key) {
      const known = listDeskProjects().find(p => p.key === key)
      if (known) return known
      const label = extractProjectLabel(q)
      return { key, projectUri: q, slug: label.toLowerCase(), label, cwd: projectCwd(q) }
    }
  }

  // Exact slug is the fast path (indexed lookup).
  const bySlug = getProjectBySlug(q.toLowerCase())
  if (bySlug) return toDeskProject(bySlug)

  return pickProject(listDeskProjects(), q)
}
