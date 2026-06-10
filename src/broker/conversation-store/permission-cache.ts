import type { ServerWebSocket } from 'bun'
import { type Permission, resolvePermissions, type UserGrant } from '../permissions'

export interface ResolvedGrant {
  permissions: Set<Permission>
  isAdmin: boolean
}

/**
 * Short-lived `resolvePermissions` memo, scoped to a SINGLE broadcast flush or a
 * single `conversations_list` build.
 *
 * Within one flush many conversations share the same `(subscriber, project)`
 * pair -- `broadcastForProject` marks every conversation in a project dirty, so
 * a naive resolve is O(convs * subscribers). The memo collapses that to
 * O(distinct-projects * subscribers).
 *
 * It is created and discarded per flush ON PURPOSE: `resolvePermissions` keys
 * grant validity off `Date.now()`, so a memo that outlived its flush could serve
 * a permission after its grant expired (a recap-share-leak-class bug). Never
 * hoist this to a longer lifetime.
 */
export function createPermissionMemo() {
  const byWs = new WeakMap<ServerWebSocket<unknown>, Map<string, ResolvedGrant>>()
  return {
    resolve(ws: ServerWebSocket<unknown>, grants: UserGrant[], project: string): ResolvedGrant {
      let byProject = byWs.get(ws)
      if (!byProject) {
        byProject = new Map()
        byWs.set(ws, byProject)
      }
      let resolved = byProject.get(project)
      if (!resolved) {
        resolved = resolvePermissions(grants, project)
        byProject.set(project, resolved)
      }
      return resolved
    },
  }
}

/**
 * Project-keyed `resolvePermissions` memo for a single `conversations_list`
 * build, where one connecting subscriber's `grants` array is evaluated against
 * every conversation's project. Same single-build lifetime discipline as
 * `createPermissionMemo`.
 */
export function createProjectPermissionMemo(grants: UserGrant[]): (project: string) => ResolvedGrant {
  const byProject = new Map<string, ResolvedGrant>()
  return project => {
    let resolved = byProject.get(project)
    if (!resolved) {
      resolved = resolvePermissions(grants, project)
      byProject.set(project, resolved)
    }
    return resolved
  }
}
