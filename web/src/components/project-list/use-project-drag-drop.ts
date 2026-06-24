import type { ProjectOrderGroup, ProjectOrderNode } from '@/lib/types'

// Pure tree-edit helpers shared by the Organize modal's drag-and-drop. These
// operate immutably -- every function returns a fresh tree, never mutating the
// input -- so a draft + Cancel flow is safe. The sidebar no longer drags; all
// reordering lives in the Organize Projects modal now.

export function removeFromTree(tree: ProjectOrderNode[], id: string): ProjectOrderNode[] {
  const out: ProjectOrderNode[] = []
  for (const n of tree) {
    if (n.id === id) continue
    if (n.type === 'group') out.push({ ...n, children: n.children.filter(c => c.id !== id) })
    else out.push(n)
  }
  return out
}

export function findInTree(tree: ProjectOrderNode[], id: string): ProjectOrderNode | null {
  for (const n of tree) {
    if (n.id === id) return n
    if (n.type === 'group') {
      // tree-traversal helper, not a per-render hot path
      // react-doctor-disable-next-line react-doctor/js-index-maps
      const found = n.children.find(c => c.id === id)
      if (found) return found
    }
  }
  return null
}

export function findParentGroup(tree: ProjectOrderNode[], id: string): string | null {
  for (const node of tree) {
    if (node.type === 'group' && node.children.some(c => c.id === id)) return node.id
  }
  return null
}

function inTree(tree: ProjectOrderNode[], id: string): boolean {
  return tree.some(n => n.id === id) || findParentGroup(tree, id) !== null
}

/** Reorder a root-level group relative to another root node. */
function reorderGroups(tree: ProjectOrderNode[], draggedId: string, overId: string): ProjectOrderNode[] | null {
  const out = [...tree]
  const from = out.findIndex(n => n.id === draggedId)
  const to = out.findIndex(n => n.id === overId)
  if (from === -1 || to === -1) return null
  const [moved] = out.splice(from, 1)
  out.splice(to, 0, moved)
  return out
}

/** Append a project into the target group (removing it from wherever it was). */
function dropIntoGroup(tree: ProjectOrderNode[], draggedId: string, overId: string): ProjectOrderNode[] {
  const without = removeFromTree(tree, draggedId)
  return without.map(n =>
    n.type === 'group' && n.id === overId
      ? { ...n, children: [...n.children, { id: draggedId, type: 'project' as const }] }
      : n,
  )
}

/** Insert `node` immediately before `overId`, into its parent group or at root. */
function insertNear(tree: ProjectOrderNode[], node: ProjectOrderNode, overId: string): ProjectOrderNode[] {
  const overParent = findParentGroup(tree, overId)
  if (overParent) {
    return tree.map(n => {
      if (n.type !== 'group' || n.id !== overParent) return n
      const idx = (n as ProjectOrderGroup).children.findIndex(c => c.id === overId)
      const children = [...n.children]
      children.splice(idx >= 0 ? idx : children.length, 0, node)
      return { ...n, children }
    })
  }
  const idx = tree.findIndex(n => n.id === overId)
  const out = [...tree]
  out.splice(idx >= 0 ? idx : out.length, 0, node)
  return out
}

// Groups only ever reorder among root groups -- never nest. Resolve a drop on a
// group's child to that child's parent group so dragging a group anywhere over
// another group lands cleanly.
function dragGroup(tree: ProjectOrderNode[], draggedId: string, overId: string): ProjectOrderNode[] | null {
  const target = overId.startsWith('group-') ? overId : findParentGroup(tree, overId)
  if (!target || target === draggedId) return null
  return reorderGroups(tree, draggedId, target)
}

function dragProject(tree: ProjectOrderNode[], draggedId: string, overId: string): ProjectOrderNode[] | null {
  if (overId.startsWith('group-')) return dropIntoGroup(tree, draggedId, overId)
  const draggedIn = inTree(tree, draggedId)
  const overIn = inTree(tree, overId)
  if (overIn && !draggedIn) return insertNear(tree, { id: draggedId, type: 'project' }, overId)
  if (draggedIn && !overIn) return removeFromTree(tree, draggedId)
  if (draggedIn && overIn) {
    const node = findInTree(tree, draggedId) || ({ id: draggedId, type: 'project' } as ProjectOrderNode)
    return insertNear(removeFromTree(tree, draggedId), node, overId)
  }
  return null
}

/**
 * Resolve a single drag gesture into a new tree, or null when it's a no-op.
 * `overId` may be the special `__ungrouped__` sentinel: dropping there pulls the
 * project out of its group, back to the unorganized pool.
 */
export function applyProjectDragEnd(
  tree: ProjectOrderNode[],
  draggedId: string,
  overId: string | null | undefined,
): ProjectOrderNode[] | null {
  if (!overId || draggedId === overId) return null
  if (overId === '__ungrouped__') return inTree(tree, draggedId) ? removeFromTree(tree, draggedId) : null
  if (draggedId.startsWith('group-')) return dragGroup(tree, draggedId, overId)
  return dragProject(tree, draggedId, overId)
}
