// Canonical project-order types -- the SINGLE source of truth shared by the
// broker (persistence, src/broker/project-order.ts) and the web control panel
// (rendering, web/src/lib/types.ts), both of which re-export these so existing
// import sites are unchanged. Defining them once stops the two layers drifting.

export interface ProjectOrderGroup {
  id: string
  type: 'group'
  name: string
  children: ProjectOrderNode[]
  isOpen?: boolean
}

export interface ProjectOrderProject {
  id: string // project URI (e.g. "claude:///path") or legacy "cwd:<path>" (compat)
  type: 'project'
}

export type ProjectOrderNode = ProjectOrderGroup | ProjectOrderProject

/** A workspace -- the tier ABOVE groups. Root nodes (top-level groups/projects)
 *  are partitioned across workspaces via `ProjectOrder.assignments`; the sidebar
 *  shows one workspace at a time (+ an "All" view). */
export interface Workspace {
  id: string
  name: string
  color?: string
}

export interface ProjectOrder {
  tree: ProjectOrderNode[]
  /** Ordered named workspaces (the sidebar tabs). Absent/empty = only "All". */
  workspaces?: Workspace[]
  /** Maps a ROOT node id (group id or project URI) -> workspace id. Root nodes
   *  with no entry appear only in "All" (migration-safe: old data has neither
   *  field, so nothing changes until a workspace is created). */
  assignments?: Record<string, string>
}
