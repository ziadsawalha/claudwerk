#!/bin/bash
#
# worktree-create.sh - WorktreeCreate hook for Claude Code
#
# NOTE: Canonical source is embedded in src/shared/resolve-script.ts.
# This file is for dev/reference. Keep in sync with the embedded version.
#
# Creates git worktrees from LOCAL HEAD instead of origin/HEAD.
# CC defaults to origin/HEAD (last pushed commit), which creates
# stale branches when you have unpushed local commits.
#
# Input (stdin JSON from CC):
#   { session_id, transcript_path, cwd, hook_event_name, name }
#   - name: worktree name from --worktree flag
#   - cwd: project root directory
#
# Output: worktree path to stdout, exit 0 = success
#

set -euo pipefail

HOOK_DATA=$(cat)
WT_NAME=$(echo "$HOOK_DATA" | jq -r '.name // empty')

if [[ -z "$WT_NAME" ]]; then
  echo "ERROR: No worktree name in hook data" >&2
  exit 1
fi

PROJECT_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_PATH="$PROJECT_ROOT/.claude/worktrees/$WT_NAME"

# Ensure parent dir exists
mkdir -p "$(dirname "$WORKTREE_PATH")"

# Resolve base: local branch HEAD > main > fallback
CURRENT_BRANCH="$(git branch --show-current 2>/dev/null || echo '')"
if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  REAL_BASE="HEAD"
elif [[ -n "$CURRENT_BRANCH" ]]; then
  REAL_BASE="$CURRENT_BRANCH"
else
  REAL_BASE="main"
fi

REAL_BASE_SHA="$(git rev-parse "$REAL_BASE")"
BRANCH_NAME="worktree-$WT_NAME"

# CRITICAL: CC expects ONLY the worktree path on stdout.
# All other output (git, bun install, init scripts) MUST go to stderr.
#
# Idempotency: if a previous spawn already created this worktree and/or
# branch, reuse it instead of failing on "branch already exists" / "path
# already used". This makes the hook safe to re-run when a parent spawns
# multiple children into the same worktree (e.g. chain protocol phases).
EXISTING_WT_BRANCH="$(git worktree list --porcelain 2>/dev/null \
  | awk -v p="$WORKTREE_PATH" '
      /^worktree / {cur=$2; next}
      /^branch refs\/heads\// && cur==p {sub(/^branch refs\/heads\//,""); print; exit}
    ')"
SKIP_INIT=
if [[ "$EXISTING_WT_BRANCH" == "$BRANCH_NAME" ]]; then
  echo "WorktreeCreate: REUSE existing worktree at $WORKTREE_PATH (branch=$BRANCH_NAME)" >&2
  SKIP_INIT=1
elif [[ -n "$EXISTING_WT_BRANCH" ]]; then
  echo "ERROR: $WORKTREE_PATH is already a worktree for branch '$EXISTING_WT_BRANCH' (wanted '$BRANCH_NAME')" >&2
  exit 1
elif git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
  echo "WorktreeCreate: ATTACH existing branch $BRANCH_NAME to $WORKTREE_PATH" >&2
  git worktree add "$WORKTREE_PATH" "$BRANCH_NAME" >&2
else
  git worktree add "$WORKTREE_PATH" -b "$BRANCH_NAME" "$REAL_BASE_SHA" >&2
fi

# Copy .worktreeinclude files (our hook replaces CC's native logic).
# Skip on reuse -- already copied at original creation.
if [[ -z "$SKIP_INIT" && -f "$PROJECT_ROOT/.worktreeinclude" ]]; then
  while IFS= read -r pattern || [[ -n "$pattern" ]]; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    # shellcheck disable=SC2086
    for file in $PROJECT_ROOT/$pattern; do
      [[ -f "$file" ]] || continue
      if git check-ignore -q "$file" 2>/dev/null; then
        REL="${file#$PROJECT_ROOT/}"
        mkdir -p "$(dirname "$WORKTREE_PATH/$REL")"
        cp "$file" "$WORKTREE_PATH/$REL"
      fi
    done
  done < "$PROJECT_ROOT/.worktreeinclude"
fi

# Run worktree-init.sh if it exists (all output to stderr).
# Skip on reuse -- init already ran at original creation.
INIT_SCRIPT="$PROJECT_ROOT/worktree-init.sh"
if [[ -z "$SKIP_INIT" ]]; then
  if [[ -x "$INIT_SCRIPT" ]]; then
    "$INIT_SCRIPT" "$WORKTREE_PATH" >&2 || echo "WARNING: worktree-init.sh failed" >&2
  elif [[ -f "$INIT_SCRIPT" ]]; then
    bash "$INIT_SCRIPT" "$WORKTREE_PATH" >&2 || echo "WARNING: worktree-init.sh failed" >&2
  fi
fi

# ONLY output: the worktree path
echo "$WORKTREE_PATH"
