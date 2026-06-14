#!/usr/bin/env bun
/**
 * refresh-latest — rebuild our fork's `latest` branch from upstream + our open PRs.
 *
 * The `latest` branch is what Launchpad deploys: it is `upstream/main` plus every
 * open PR we have against upstream, plus a handful of "glue" commits that only make
 * sense in the combined branch (build tweaks, dep additions the individual PRs don't
 * each need). This script encodes the hand-assembled ritual so it survives past one
 * terminal session — and past one engineer's memory of which commits were glue.
 *
 * What it does, in order:
 *   1. Fetch upstream + origin (pruned).
 *   2. Discover our open PRs against upstream/main via `gh`.
 *   3. Rebase each PR branch onto fresh upstream/main and force-with-lease push it
 *      (keeps the PRs current and mergeable). Aborts cleanly on any conflict.
 *   4. Rebuild `latest` = upstream/main + every PR's commits + the glue commits,
 *      where "glue" = commits currently on `latest` that are NOT patch-equivalent
 *      to any PR commit and not already upstream. Patch-id equivalence is what makes
 *      this correct: `latest`'s copies of PR commits have different SHAs than the PR
 *      branches (different parents), so a naive SHA/ancestry check mis-flags them.
 *   5. Typecheck the rebuilt branch, then force-with-lease push `latest`.
 *
 * Safety: working tree must be clean (we refuse to stash for you — too easy to lose
 * uncommitted work in a script). Every branch we rewrite gets a `backup/<branch>-<ts>`
 * tag first. No destructive git ops; conflicts abort the rebase and stop the run.
 *
 * Usage:
 *   bun run scripts/refresh-latest.ts            # do it
 *   bun run scripts/refresh-latest.ts --dry-run  # rebuild locally, push nothing
 */

import { execFileSync } from 'node:child_process'

interface Config {
  readonly upstreamRemote: string
  readonly upstreamBranch: string
  /** owner/repo on GitHub where our PRs live (the upstream we forked). */
  readonly upstreamRepo: string
  readonly originRemote: string
  readonly latestBranch: string
  /** `gh` author filter; "@me" means the authenticated user. */
  readonly author: string
}

const CONFIG: Config = {
  upstreamRemote: 'upstream',
  upstreamBranch: 'main',
  upstreamRepo: 'claudification/claudwerk',
  originRemote: 'origin',
  latestBranch: 'latest',
  author: '@me',
} as const

interface OpenPr {
  readonly number: number
  readonly headRefName: string
  readonly baseRefName: string
  readonly author: { readonly login: string }
}

const DRY_RUN = process.argv.includes('--dry-run')

/** Run a command, capture trimmed stdout. Throws on non-zero exit. */
function run(cmd: string, args: readonly string[], input?: string): string {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    input,
    stdio: input ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
  }).trim()
}

const git = (args: readonly string[], input?: string): string => run('git', args, input)

/** Try a command; return whether it succeeded (non-zero exit is not thrown). */
function tryRun(cmd: string, args: readonly string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function log(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

function die(msg: string): never {
  process.stderr.write(`\n✗ ${msg}\n`)
  process.exit(1)
}

/** Stable patch-id for a single commit — content identity independent of SHA/parent. */
function patchId(sha: string): string {
  const diff = git(['diff-tree', '--no-commit-id', '-p', sha])
  if (diff === '') return '' // empty/merge commit — no patch identity
  const out = git(['patch-id', '--stable'], diff)
  return out.split(/\s+/)[0] ?? ''
}

/** All commit SHAs in base..tip, oldest first. */
function commitsInRange(base: string, tip: string): string[] {
  const out = git(['rev-list', '--reverse', `${base}..${tip}`])
  return out === '' ? [] : out.split('\n')
}

function shortSha(ref: string): string {
  return git(['rev-parse', '--short', ref])
}

function timestampTag(): string {
  // Date.* is unavailable in some sandboxed contexts; fall back to a git-derived stamp.
  try {
    return git(['show', '-s', '--format=%cd', '--date=format:%Y%m%d-%H%M%S', 'HEAD'])
  } catch {
    return 'snapshot'
  }
}

function main(): void {
  const { upstreamRemote, upstreamBranch, upstreamRepo, originRemote, latestBranch, author } = CONFIG
  const upstreamRef = `${upstreamRemote}/${upstreamBranch}`
  const latestRef = `${originRemote}/${latestBranch}`
  const stamp = timestampTag()

  // --- Preconditions -------------------------------------------------------
  if (git(['status', '--porcelain']) !== '') {
    die(
      'Working tree is not clean. Commit or stash your changes first — this script ' +
        'refuses to touch uncommitted work.',
    )
  }
  const originalBranch = git(['rev-parse', '--abbrev-ref', 'HEAD'])

  log(`${DRY_RUN ? '[dry-run] ' : ''}Refreshing ${latestBranch} from ${upstreamRef}\n`)

  // --- 1. Fetch ------------------------------------------------------------
  log('→ Fetching remotes…')
  git(['fetch', upstreamRemote, '--prune'])
  git(['fetch', originRemote, '--prune'])
  log(`  ${upstreamRef} is at ${shortSha(upstreamRef)}`)

  // --- 2. Discover open PRs ------------------------------------------------
  // NB: we filter by author client-side. `gh pr list --author @me` returns []
  // against a repo you don't own — GitHub's server-side author filter won't
  // resolve @me cross-repo. So we fetch all open PRs and match on login here.
  const me = author === '@me' ? run('gh', ['api', 'user', '--jq', '.login']) : author
  const prsRaw = run('gh', [
    'pr',
    'list',
    '--repo',
    upstreamRepo,
    '--state',
    'open',
    '--limit',
    '200',
    '--json',
    'number,headRefName,baseRefName,author',
  ])
  const prs: OpenPr[] = (JSON.parse(prsRaw) as OpenPr[])
    .filter(p => p.baseRefName === upstreamBranch && p.author.login === me)
    .sort((a, b) => a.number - b.number)

  if (prs.length === 0) {
    log('  No open PRs against upstream — latest will be a pure mirror of upstream/main.')
  } else {
    log(`  Open PRs targeting ${upstreamBranch}: ${prs.map(p => `#${p.number}`).join(', ')}`)
  }

  // --- 3. Rebase each PR branch onto upstream/main -------------------------
  for (const pr of prs) {
    const branch = pr.headRefName
    log(`\n→ Rebasing #${pr.number} (${branch}) onto ${upstreamRef}…`)
    git(['tag', '-f', `backup/${branch.replace(/\//g, '-')}-${stamp}`, `${originRemote}/${branch}`])
    git(['checkout', branch])
    if (!tryRun('git', ['rebase', upstreamRef])) {
      tryRun('git', ['rebase', '--abort'])
      git(['checkout', originalBranch])
      die(
        `Rebase of ${branch} onto ${upstreamRef} hit a conflict. Resolve it by hand, ` +
          'then re-run. (Backup tag was created.)',
      )
    }
    if (DRY_RUN) {
      log(`  [dry-run] would push ${branch} → ${originRemote} (force-with-lease)`)
    } else {
      git(['push', '--force-with-lease', originRemote, `${branch}:${branch}`])
      log(`  pushed ${branch} (${shortSha(branch)})`)
    }
  }

  // --- 4. Identify glue commits (on latest, not patch-equal to any PR) -----
  const prPatchIds = new Set<string>()
  for (const pr of prs) {
    for (const sha of commitsInRange(upstreamRef, pr.headRefName)) {
      const id = patchId(sha)
      if (id !== '') prPatchIds.add(id)
    }
  }
  const glue: string[] = []
  for (const sha of commitsInRange(upstreamRef, latestRef)) {
    const id = patchId(sha)
    if (id === '' || !prPatchIds.has(id)) glue.push(sha)
  }
  if (glue.length > 0) {
    log(`\n→ Preserving ${glue.length} glue commit(s) from ${latestRef}:`)
    for (const sha of glue) {
      log(`  ${shortSha(sha)} ${git(['log', '-1', '--format=%s', sha])}`)
    }
  }

  // --- 5. Rebuild latest = upstream/main + PR commits + glue ---------------
  log(`\n→ Rebuilding ${latestBranch} on ${upstreamRef}…`)
  git(['tag', '-f', `backup/${latestBranch}-${stamp}`, latestRef])
  git(['checkout', '-B', latestBranch, upstreamRef])
  for (const pr of prs) {
    const range = `${upstreamRef}..${pr.headRefName}`
    if (commitsInRange(upstreamRef, pr.headRefName).length > 0) {
      git(['cherry-pick', range])
    }
  }
  for (const sha of glue) {
    git(['cherry-pick', sha])
  }
  log(
    `  ${latestBranch} rebuilt: ${commitsInRange(upstreamRef, latestBranch).length} commit(s) on ${shortSha(upstreamRef)}`,
  )

  // --- 6. Verify -----------------------------------------------------------
  log('\n→ Installing deps + typechecking the rebuilt branch…')
  tryRun('bun', ['install'])
  tryRun('bun', ['install', '--cwd', 'web'])
  if (!tryRun('bun', ['run', 'typecheck'])) {
    git(['checkout', originalBranch])
    die(
      `Typecheck failed on the rebuilt ${latestBranch}. It was NOT pushed. ` +
        `Inspect the local ${latestBranch} branch, fix the glue, and re-run.`,
    )
  }
  log('  typecheck clean ✓')

  // --- 7. Push latest ------------------------------------------------------
  if (DRY_RUN) {
    log(`\n[dry-run] would push ${latestBranch} → ${originRemote} (force-with-lease). Nothing pushed.`)
  } else {
    git(['push', '--force-with-lease', originRemote, `${latestBranch}:${latestBranch}`])
    log(`\n✓ Pushed ${latestBranch} (${shortSha(latestBranch)}). Launchpad can refresh.`)
  }

  git(['checkout', originalBranch])
  log(`\nDone. Back on ${originalBranch}.`)
}

main()
