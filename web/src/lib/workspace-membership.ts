// Workspace membership + "last conversation per workspace" bookkeeping. Kept
// standalone (no store import) so both the conversations store and
// project-list/workspace-hooks.ts can depend on it without a cycle.
import type { ProjectOrder, ProjectOrderNode } from '@/lib/types'

export function projectIdsInTree(tree: ProjectOrderNode[]): Set<string> {
  const ids = new Set<string>()
  for (const node of tree) {
    if (node.type === 'project') ids.add(node.id)
    else for (const child of node.children) if (child.type === 'project') ids.add(child.id)
  }
  return ids
}

export function isProjectInWorkspace(order: ProjectOrder, wsId: string, projectUri: string): boolean {
  return projectIdsInTree(order.workspaceTrees?.[wsId] ?? []).has(projectUri)
}

// Sentinel workspace id for the "All" view. A project can belong to ZERO or
// MANY workspaces, so there is NO derivable "the workspace" for a project --
// the only truthful workspace for a conversation is the one you were ACTUALLY
// viewing it in. We record that, keyed by conversation, below.
export const WORKSPACE_ALL = '_all'

const WS_LAST_CONV_KEY = 'workspace-last-conversation'

export function loadLastWorkspaceConversations(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(WS_LAST_CONV_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function saveLastWorkspaceConversation(wsId: string, convId: string | null): void {
  const map = loadLastWorkspaceConversations()
  if (convId) map[wsId] = convId
  else delete map[wsId]
  localStorage.setItem(WS_LAST_CONV_KEY, JSON.stringify(map))
}

// "Which workspace was I in when I last had THIS conversation active?" -- the
// dual of the map above. Recorded on every switch so a quick-switch (Ctrl+Tab)
// back to a conversation restores the exact workspace context it was left in,
// instead of guessing from project membership (impossible under many-to-many).
// Stored id is a real workspace id or WORKSPACE_ALL; absent = never recorded.
const CONV_LAST_WS_KEY = 'conversation-last-workspace'

function loadConversationWorkspaces(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(CONV_LAST_WS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function saveConversationWorkspace(convId: string, wsId: string): void {
  const map = loadConversationWorkspaces()
  map[convId] = wsId
  localStorage.setItem(CONV_LAST_WS_KEY, JSON.stringify(map))
}

// The workspace this conversation was last viewed in: a real id, WORKSPACE_ALL,
// or undefined if we have never recorded it.
export function loadConversationWorkspace(convId: string): string | undefined {
  return loadConversationWorkspaces()[convId]
}
