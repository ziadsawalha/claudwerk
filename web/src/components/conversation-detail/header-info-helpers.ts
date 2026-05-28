/** Extract the worktree name from a `.../.claude/worktrees/<name>` path, else null. */
export function worktreeName(path: string): string | null {
  const m = path.match(/\/\.claude\/worktrees\/([^/]+)/)
  return m ? m[1] : null
}
