#!/usr/bin/env bun
/**
 * cc-daemon launch smoke -- Tier-2 live smoke for the daemon launch UX
 * (plan-daemon-launch-ux.md Section 6.2 / Phase H).
 *
 * Drives a REAL Claude Code daemon through all three launch modes end to end
 * and asserts the worker transcript mirrors into an in-memory broker:
 *
 *   NEW     `claude --bg "<prompt>"` -> attach -> mirror -> `reply` a turn -> kill
 *   RESUME  `claude --bg --resume <ccSessionId>` -> attach -> assert continuity
 *   ATTACH  dispatch a worker EXTERNALLY, then attach to its roster short with
 *           NO `claude --bg` of our own -> mirror
 *
 * It dogfoods `cc-daemon` (ping/list/attach/reply/kill) and `daemon-agent-host`
 * (session-observer, attach-retry, transcript-bridge) -- the testable fixture
 * layer is `src/daemon-agent-host/launch-smoke.ts`, the orchestration is
 * `launch-smoke-mirror.ts`, both unit-smoked by `launch-smoke.test.ts`.
 *
 * Phase H is OUT of the blocking PR gate -- the daemon is transient and live
 * tests flake. A red canary IS the signal. Run by hand pre-merge:
 *
 *     bun run smoke:daemon-launch
 *
 * Requirements: a `claude` install authenticated against an Anthropic
 * subscription, and a reachable Claude Code daemon (any `claude --bg` worker
 * or `claude daemon` brings one up). The harness `claude rm`s every probe job
 * it dispatches; the transient daemon idle-exits once they drop.
 *
 * COST: each probe is one Haiku turn in a bare temp cwd (~85k subscription
 * tokens). The full run is ~5 turns. Model is fixed to Haiku on purpose -- this
 * is a protocol smoke, not a reasoning test.
 *
 * NOTE on CLAUDE_CONFIG_DIR: the harness deliberately does NOT isolate it.
 * `daemon-agent-host/transcript-path.ts` derives the worker transcript dir from
 * `homedir()/.claude` (not $CLAUDE_CONFIG_DIR), and `claude` auth lives in
 * `~/.claude` -- isolating the config dir would break the very modules this
 * harness dogfoods. Probe isolation comes from a unique bare temp cwd per probe
 * (its own `~/.claude/projects/<slug>` dir), not from a separate config dir.
 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DaemonMode } from '../src/daemon-agent-host/cli-args'
import {
  type CleanupRegistry,
  checkVersionCanary,
  createCleanupRegistry,
  createInMemoryBroker,
  createSmokeLogger,
  distinctStatesFrom,
  type InMemoryBroker,
  type SmokeLogger,
  transcriptContainsText,
} from '../src/daemon-agent-host/launch-smoke'
import {
  dispatchClaudeBgWorker,
  fetchJobState,
  mirrorWorker,
  type WorkerMirror,
} from '../src/daemon-agent-host/launch-smoke-mirror'
import { ProtocolMismatchError } from '../src/shared/cc-daemon/client'
import { kill, ping, reply } from '../src/shared/cc-daemon/ops'
import { resolveControlSocket } from '../src/shared/cc-daemon/socket-path'

/** Haiku -- a protocol smoke, not a reasoning test. */
const HAIKU = 'claude-haiku-4-5-20251001'
/** Worker turn latency: be generous, Haiku in a bare cwd still does a real turn. */
const TURN_TIMEOUT_MS = 120_000

/** Shared per-run state threaded through every mode runner. */
interface SmokeContext {
  controlSock: string
  log: SmokeLogger
  cleanup: CleanupRegistry
}

/** A short random hex token for probe names + transcript codewords. */
function randHex(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

/** A fresh empty temp cwd -- bare (no project CLAUDE.md), tracked for cleanup. */
function mkProbeCwd(cleanup: CleanupRegistry): string {
  const dir = mkdtempSync(join(tmpdir(), 'cw-daemon-smoke-'))
  cleanup.trackTempDir(dir)
  return dir
}

/** `claude rm <short>` -- only ever a short THIS harness dispatched. */
async function removeJob(short: string): Promise<void> {
  const proc = Bun.spawn(['claude', 'rm', short], { stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) throw new Error(`claude rm ${short} exited ${code}`)
}

/** Terminate a probe worker via the cc-daemon `kill` op. Non-fatal on failure. */
async function killWorker(ctx: SmokeContext, short: string): Promise<void> {
  ctx.log.detail(`kill worker ${short} via cc-daemon kill op`)
  const res = await kill(ctx.controlSock, short)
  if (res.ok === false) ctx.log.detail(`kill returned not-ok: ${res.error} (${res.code ?? 'no code'}) -- continuing`)
}

/** Dispatch a worker (NEW/RESUME/external) and mirror it through an in-memory broker. */
async function dispatchAndMirror(
  ctx: SmokeContext,
  opts: { mode: DaemonMode; name: string; prompt: string; resumeFrom?: string },
): Promise<{ short: string; cwd: string; broker: InMemoryBroker; mirror: WorkerMirror }> {
  const cwd = mkProbeCwd(ctx.cleanup)
  ctx.log.detail(`probe cwd=${cwd} name=${opts.name}`)
  const short = await dispatchClaudeBgWorker({
    cwd,
    name: opts.name,
    prompt: opts.prompt,
    model: HAIKU,
    resumeFrom: opts.resumeFrom,
  })
  ctx.cleanup.trackJob(short)
  ctx.log.detail(`claude --bg dispatched worker short=${short}`)
  const broker = createInMemoryBroker(`smoke-${opts.mode}-${short}`)
  const mirror = await mirrorWorker({ controlSock: ctx.controlSock, short, mode: opts.mode, cwd, broker, log: ctx.log })
  ctx.log.detail(`attached: ccSessionId=${mirror.ccSessionId} attachState=${mirror.attachState}`)
  return { short, cwd, broker, mirror }
}

/** Assert at least one job state was observed via `list` (Section 6.2 assertion). */
async function assertJobStateObserved(ctx: SmokeContext, short: string, mirror: WorkerMirror): Promise<void> {
  const states = distinctStatesFrom([await fetchJobState(ctx.controlSock, short), mirror.attachState])
  ctx.log.detail(`job states observed via list: [${states.join(', ')}]`)
  if (states.length === 0) throw new Error(`no job state observed via list for ${short}`)
}

// ---------------------------------------------------------------------------
// MODE 1/3 -- NEW
// ---------------------------------------------------------------------------

/** Run the NEW-mode probe; returns the worker's ccSessionId for RESUME to fork. */
async function runNewMode(ctx: SmokeContext): Promise<string> {
  ctx.log.step('MODE 1/3: NEW -- claude --bg fresh dispatch -> attach -> reply -> kill')
  const codeword = `GIRAFFE-${randHex()}`
  const { short, broker, mirror } = await dispatchAndMirror(ctx, {
    mode: 'new',
    name: `cw-smoke-${randHex()}`,
    prompt: `Reply with exactly: PROBE-NEW-OK ${codeword} and nothing else.`,
  })

  await broker.waitForTranscript(e => transcriptContainsText([e], 'PROBE-NEW-OK'), {
    timeoutMs: TURN_TIMEOUT_MS,
    label: 'NEW assistant reply',
  })
  ctx.log.ok(`NEW transcript mirrored (${broker.transcriptEntries().length} entries, codeword ${codeword})`)
  await assertJobStateObserved(ctx, short, mirror)

  ctx.log.detail('replying a follow-up turn via the cc-daemon reply op ...')
  const rep = await reply(ctx.controlSock, short, 'Reply with exactly: PROBE-REPLY-OK and nothing else.')
  if (rep.ok === false) throw new Error(`reply op failed: ${rep.error} (${rep.code ?? 'no code'})`)
  await broker.waitForTranscript(e => transcriptContainsText([e], 'PROBE-REPLY-OK'), {
    timeoutMs: TURN_TIMEOUT_MS,
    label: 'NEW reply turn',
  })
  ctx.log.ok('NEW reply turn mirrored')

  mirror.stop()
  await killWorker(ctx, short)
  ctx.log.ok(`NEW mode passed (ccSessionId ${mirror.ccSessionId})`)
  return mirror.ccSessionId
}

// ---------------------------------------------------------------------------
// MODE 2/3 -- RESUME
// ---------------------------------------------------------------------------

/** Run the RESUME-mode probe -- forks from NEW's ccSessionId, asserts continuity. */
async function runResumeMode(ctx: SmokeContext, resumeFrom: string): Promise<void> {
  ctx.log.step('MODE 2/3: RESUME -- claude --bg --resume -> attach -> assert continuity')
  ctx.log.detail(`resuming from ccSessionId=${resumeFrom} (the worker forks a FRESH id -- spike 1)`)
  const { short, broker, mirror } = await dispatchAndMirror(ctx, {
    mode: 'resume',
    name: `cw-smoke-${randHex()}`,
    prompt: 'Reply with exactly: PROBE-RESUME-OK and nothing else.',
    resumeFrom,
  })
  if (mirror.ccSessionId === resumeFrom) {
    ctx.log.detail('WARNING: resumed worker kept the resume-input id -- spike 1 expected a fork')
  }

  await broker.waitForTranscript(e => transcriptContainsText([e], 'PROBE-NEW-OK'), {
    timeoutMs: 60_000,
    label: 'RESUME transcript continuity (the prior NEW turn)',
  })
  ctx.log.ok('RESUME transcript continuity confirmed -- prior NEW turn present in the forked session')
  await assertJobStateObserved(ctx, short, mirror)

  await broker.waitForTranscript(e => transcriptContainsText([e], 'PROBE-RESUME-OK'), {
    timeoutMs: TURN_TIMEOUT_MS,
    label: 'RESUME new turn',
  })
  ctx.log.ok('RESUME new turn mirrored')

  mirror.stop()
  await killWorker(ctx, short)
  ctx.log.ok('RESUME mode passed')
}

// ---------------------------------------------------------------------------
// MODE 3/3 -- ATTACH
// ---------------------------------------------------------------------------

/** Run the ATTACH-mode probe -- attach to an externally-dispatched worker. */
async function runAttachMode(ctx: SmokeContext): Promise<void> {
  ctx.log.step('MODE 3/3: ATTACH -- attach to an externally-dispatched worker')
  ctx.log.detail('the claude --bg below simulates a non-claudewerk session; ATTACH itself never dispatches')
  const { short, broker, mirror } = await dispatchAndMirror(ctx, {
    mode: 'attach',
    name: `cw-smoke-ext-${randHex()}`,
    prompt: 'Reply with exactly: PROBE-ATTACH-OK and nothing else.',
  })

  await broker.waitForTranscript(e => transcriptContainsText([e], 'PROBE-ATTACH-OK'), {
    timeoutMs: TURN_TIMEOUT_MS,
    label: 'ATTACH assistant reply',
  })
  ctx.log.ok(`ATTACH transcript mirrored (${broker.transcriptEntries().length} entries)`)
  await assertJobStateObserved(ctx, short, mirror)

  mirror.stop()
  await killWorker(ctx, short)
  ctx.log.ok('ATTACH mode passed')
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

/** Ping the daemon and assert the control protocol. Returns false on a bump. */
async function runVersionCanary(log: SmokeLogger, controlSock: string): Promise<boolean> {
  log.step('version canary: ping the daemon, assert the control protocol')
  const canary = checkVersionCanary(await ping(controlSock))
  if (!canary.ok) {
    log.fail(canary.error ?? 'version canary failed')
    return false
  }
  log.ok(`daemon proto=${canary.proto ?? 'n/a'} version=${canary.version ?? 'n/a'}`)
  if (canary.note) log.detail(canary.note)
  return true
}

/** Run NEW -> RESUME -> ATTACH. Returns the failure, or null when all passed. */
async function runAllModes(ctx: SmokeContext): Promise<Error | null> {
  try {
    const newSessionId = await runNewMode(ctx)
    await runResumeMode(ctx, newSessionId)
    await runAttachMode(ctx)
    return null
  } catch (err) {
    const error = err as Error
    if (error instanceof ProtocolMismatchError) {
      ctx.log.fail(
        `PROTOCOL MISMATCH -- Claude Code bumped the daemon protocol. claudewerk needs an update. ${error.message}`,
      )
    } else {
      ctx.log.fail(error.stack ?? String(error))
    }
    return error
  }
}

/** Remove every probe job + temp dir the run dispatched. */
async function runCleanup(ctx: SmokeContext): Promise<void> {
  ctx.log.step('cleanup: removing every probe job + temp dir')
  const summary = await ctx.cleanup.run({ removeJob, log: msg => ctx.log.detail(msg) })
  ctx.log.detail(
    `cleanup: ${summary.jobsRemoved} jobs removed, ${summary.jobsFailed} failed, ${summary.dirsRemoved} dirs removed`,
  )
  ctx.log.detail('the transient daemon idle-exits once its last probe worker + lease drop')
}

async function main(): Promise<void> {
  const log = createSmokeLogger()
  log.step('cc-daemon launch smoke -- NEW / RESUME / ATTACH against a live Claude Code daemon')
  log.detail(`model=${HAIKU} (protocol smoke, not a reasoning test)`)

  const controlSock = resolveControlSocket()
  if (!controlSock) {
    log.fail(
      'no Claude Code daemon control socket found -- start `claude daemon` or dispatch a `claude --bg` worker first',
    )
    process.exit(1)
    return
  }
  log.detail(`daemon control socket: ${controlSock}`)
  if (!(await runVersionCanary(log, controlSock))) {
    process.exit(1)
    return
  }

  const ctx: SmokeContext = { controlSock, log, cleanup: createCleanupRegistry() }
  const failure = await runAllModes(ctx)
  await runCleanup(ctx)

  if (failure) {
    log.fail('SMOKE FAILED -- see the failure above')
    process.exit(1)
    return
  }
  log.ok('SMOKE PASSED -- NEW + RESUME + ATTACH all green')
  process.exit(0)
}

main().catch(err => {
  process.stderr.write(`[smoke] FATAL: ${(err as Error).stack ?? err}\n`)
  process.exit(1)
})
