#!/usr/bin/env bun
/**
 * spike-dispatch-op -- live recon of the daemon control-socket `dispatch` op.
 *
 * Phase 0 research thread #1 of plan-claude-transport-reframe.md. The goal is
 * to determine if claudewerk can retire its `claude --bg` CLI shell-out in
 * favor of the socket `dispatch` op (`op:'dispatch'` with a `DispatchSpec`),
 * and to map out what extras the spec exposes that the CLI does not.
 *
 * Pattern lifted from `scripts/spike-permission-response.ts`: Haiku probes,
 * `claude rm` in `finally`, bounded cost ceiling (~$0.20 total).
 *
 * Run manually:
 *     bun run scripts/spike-dispatch-op.ts
 *
 * Output goes to stdout and to scripts/spike-dispatch-findings.md verbatim.
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatchDaemonWorker } from '../src/daemon-agent-host/launch-smoke-mirror'
import { request } from '../src/shared/cc-daemon/client'
import { list, ping } from '../src/shared/cc-daemon/ops'
import { resolveControlSocket } from '../src/shared/cc-daemon/socket-path'

const HAIKU = 'claude-haiku-4-5-20251001'
const FINDINGS = join(import.meta.dir, 'spike-dispatch-findings.md')

function logBoth(line: string): void {
  console.log(line)
  appendFileSync(FINDINGS, `${line}\n`)
}

function header(title: string): void {
  logBoth('')
  logBoth(`## ${title}`)
  logBoth('')
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(r => setTimeout(r, ms))
}

function mintShort(): string {
  return randomBytes(4).toString('hex')
}

function mintNonce(): string {
  return randomBytes(4).toString('hex')
}

async function removeJob(short: string): Promise<void> {
  try {
    const proc = Bun.spawn(['claude', 'rm', short], { stdout: 'pipe', stderr: 'pipe' })
    const code = await proc.exited
    if (code !== 0) {
      const err = await new Response(proc.stderr as ReadableStream).text()
      logBoth(`  claude rm ${short} exited ${code}: ${err.slice(0, 200)}`)
    } else {
      logBoth(`  cleaned up ${short}`)
    }
  } catch (e) {
    logBoth(`  claude rm threw: ${(e as Error).message}`)
  }
}

async function ensureDaemon(): Promise<string> {
  let sock = await resolveControlSocket()
  if (sock) return sock
  logBoth('No daemon control socket -- dispatching a kick-start worker to wake the supervisor.')
  const tmpCwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-kickstart-'))
  const short = await dispatchDaemonWorker({
    cwd: tmpCwd,
    name: `dispatch-spike-kickstart-${mintShort()}`,
    prompt: 'reply OK',
    model: HAIKU,
  })
  logBoth(`Kick-started worker ${short}. Waiting for daemon to settle...`)
  for (let i = 0; i < 10; i++) {
    await sleep(500)
    sock = await resolveControlSocket()
    if (sock) break
  }
  if (!sock) throw new Error('daemon socket never came up after kick-start')
  // Clean up the kick-start worker immediately (we have the socket now).
  await removeJob(short)
  return sock
}

interface DispatchOutcome {
  ok: boolean
  short: string
  nonce: string
  resp: unknown
  cleanup: () => Promise<void>
}

/** Send one dispatch frame and decide how to clean up the resulting worker. */
async function dispatch(sock: string, d: Record<string, unknown>, label: string): Promise<DispatchOutcome> {
  const short = (d.short as string) || mintShort()
  const nonce = (d.nonce as string) || mintNonce()
  const spec = { proto: 1, short, nonce, ...d }
  const req = { op: 'dispatch', d: spec, timeoutMs: 8000 }
  logBoth(`[${label}] short=${short} nonce=${nonce} mode=${(spec.launch as { mode?: string })?.mode ?? 'n/a'}`)
  logBoth(`[${label}] req=${JSON.stringify(req).slice(0, 200)}`)
  let resp: unknown
  try {
    resp = await request(sock, req as { op: 'dispatch'; d: typeof spec; timeoutMs: number })
  } catch (err) {
    resp = { ok: false, error: (err as Error).message }
  }
  logBoth(`[${label}] resp=${JSON.stringify(resp).slice(0, 400)}`)
  const ok = (resp as { ok?: boolean }).ok === true
  const cleanup = async (): Promise<void> => {
    if (ok) await removeJob(short)
  }
  return { ok, short, nonce, resp, cleanup }
}

function dispatchSpecBase(opts: { cwd: string; sessionId?: string }): Record<string, unknown> {
  const cwd = opts.cwd
  const sessionId = opts.sessionId ?? randomBytes(16).toString('hex')
  return {
    sessionId,
    createdAt: Date.now(),
    source: 'shell',
    cwd,
    env: {},
    isolation: 'none',
    respawnFlags: [],
  }
}

async function main(): Promise<void> {
  writeFileSync(
    FINDINGS,
    `# Spike: dispatch op -- ${new Date().toISOString()}\n\nLive recon against the running daemon. Pattern: each probe dispatches a Haiku worker (or attempts to), then \`claude rm\`s it in finally.\n`,
  )
  const sock = await ensureDaemon()
  const versionResp = await ping(sock)
  logBoth(`daemon ping: ${JSON.stringify(versionResp)}`)

  const cleanups: Array<() => Promise<void>> = []

  // -----------------------------------------------------------------
  // Probe 1 -- prompt mode with an empty prompt array.
  // Question: does the daemon accept a NEW worker dispatched with no prompt
  // (closes the "claude --bg requires <prompt>" gap)?
  // -----------------------------------------------------------------
  header('Probe 1 -- prompt mode, empty args')
  {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p1-'))
    const spec = { ...dispatchSpecBase({ cwd }), launch: { mode: 'prompt', args: [] } }
    const o = await dispatch(sock, spec, 'P1')
    cleanups.push(o.cleanup)
  }

  // -----------------------------------------------------------------
  // Probe 2 -- prompt mode with a single-element prompt (the normal shape).
  // Sanity check: confirms our dispatch frame is otherwise well-formed.
  // -----------------------------------------------------------------
  header('Probe 2 -- prompt mode, simple prompt')
  {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p2-'))
    const spec = { ...dispatchSpecBase({ cwd }), launch: { mode: 'prompt', args: ['reply PROBE2-OK'] } }
    const o = await dispatch(sock, spec, 'P2')
    cleanups.push(o.cleanup)
  }

  // -----------------------------------------------------------------
  // Probe 3 -- prompt mode with a slash-only arg.
  // Question: can we dispatch into a slash command (e.g. "/clear", "/model")
  // as the first turn, skipping any chat prompt? Interesting for promptless
  // session bootstraps.
  // -----------------------------------------------------------------
  header('Probe 3 -- prompt mode, slash-only')
  {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p3-'))
    const spec = { ...dispatchSpecBase({ cwd }), launch: { mode: 'prompt', args: ['/model'] } }
    const o = await dispatch(sock, spec, 'P3')
    cleanups.push(o.cleanup)
  }

  // -----------------------------------------------------------------
  // Probe 4 -- resume mode with fork:false.
  // Spike-1 finding (plan-daemon-launch-ux.md §8) said `claude --bg --resume`
  // ALWAYS forks. The DispatchSpec exposes an explicit fork:boolean. Does
  // fork:false skip the fresh-fork (preserve the resumed ccSessionId)?
  // -----------------------------------------------------------------
  header('Probe 4 -- resume mode, fork:false')
  {
    // First spawn a small worker so we have a sessionId to resume from.
    const seedCwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p4-seed-'))
    const seedShort = await dispatchDaemonWorker({
      cwd: seedCwd,
      name: `dispatch-spike-p4-seed-${mintShort()}`,
      prompt: 'reply SEED-OK',
      model: HAIKU,
    })
    logBoth(`P4 seed worker dispatched: ${seedShort}`)
    cleanups.push(async () => removeJob(seedShort))
    // Discover the seed worker's sessionId via list.
    await sleep(1500)
    const ls = await list(sock)
    const seedJob = ls.jobs.find(j => j.short === seedShort)
    logBoth(`P4 seed list: ${JSON.stringify(seedJob)}`)
    const seedSessionId = seedJob?.sessionId
    if (!seedSessionId) {
      logBoth('P4: seed worker has no sessionId yet -- skipping resume probe.')
    } else {
      const spec = {
        ...dispatchSpecBase({ cwd: seedCwd }),
        launch: { mode: 'resume', sessionId: seedSessionId, fork: false, flagArgs: [] },
      }
      const o = await dispatch(sock, spec, 'P4')
      cleanups.push(o.cleanup)
      // If it succeeded, check whether the resumed worker reports the SAME
      // sessionId (fork:false preserved it) or a fresh one (fork:false was ignored).
      if (o.ok) {
        await sleep(2000)
        const ls2 = await list(sock)
        const dispatched = ls2.jobs.find(j => j.short === o.short)
        logBoth(`P4 resumed worker job: ${JSON.stringify(dispatched)}`)
        logBoth(`P4 conclusion: dispatched.sessionId === seed.sessionId? ${dispatched?.sessionId === seedSessionId}`)
      }
    }
  }

  // -----------------------------------------------------------------
  // Probe 5 -- exec mode.
  // Question: does the daemon let us dispatch arbitrary processes (`cmd`,
  // `args`) under its supervision? If so, it is a general-purpose worker
  // spawner -- not just a `claude` wrapper.
  // -----------------------------------------------------------------
  header('Probe 5 -- exec mode')
  {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p5-'))
    const spec = {
      ...dispatchSpecBase({ cwd }),
      launch: { mode: 'exec', cmd: '/bin/sh', args: ['-c', 'echo DISPATCH-EXEC-OK; sleep 5'] },
    }
    const o = await dispatch(sock, spec, 'P5')
    cleanups.push(o.cleanup)
  }

  // -----------------------------------------------------------------
  // Probe 6 -- prompt mode with seed.intent + agent + routine extras.
  // DispatchSpec exposes structured metadata fields the CLI does not. Do
  // they ride end-to-end and surface in JobRecord / subscribe?
  // -----------------------------------------------------------------
  header('Probe 6 -- prompt mode + seed.intent + agent + routine')
  {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p6-'))
    const spec = {
      ...dispatchSpecBase({ cwd }),
      launch: { mode: 'prompt', args: ['reply PROBE6-OK'] },
      seed: { intent: 'claudewerk-research-spike', name: 'P6 probe' },
      agent: 'general-purpose',
      routine: 'dispatch-spike',
    }
    const o = await dispatch(sock, spec, 'P6')
    cleanups.push(o.cleanup)
    if (o.ok) {
      await sleep(1500)
      const ls = await list(sock)
      const j = ls.jobs.find(jj => jj.short === o.short)
      logBoth(`P6 list entry: ${JSON.stringify(j)}`)
    }
  }

  // -----------------------------------------------------------------
  // Probe 7 -- prompt mode + isolation:"worktree" + worktree object.
  // Plan-daemon-launch-ux mentions worktree.ownershipToken gates concurrent
  // worktree adoption. Does the daemon accept a worktree spec at dispatch?
  // -----------------------------------------------------------------
  header('Probe 7 -- isolation:worktree + worktree.ownershipToken')
  {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p7-'))
    const spec = {
      ...dispatchSpecBase({ cwd }),
      launch: { mode: 'prompt', args: ['reply PROBE7-OK'] },
      isolation: 'worktree',
      worktree: { path: cwd, ownershipToken: randomBytes(8).toString('hex') },
    }
    const o = await dispatch(sock, spec, 'P7')
    cleanups.push(o.cleanup)
  }

  // -----------------------------------------------------------------
  // Probe 8 -- prompt mode with respawnFlags + attachStallRespawns.
  // -----------------------------------------------------------------
  header('Probe 8 -- respawnFlags + attachStallRespawns')
  {
    const cwd = mkdtempSync(join(tmpdir(), 'dispatch-spike-p8-'))
    const spec = {
      ...dispatchSpecBase({ cwd }),
      launch: { mode: 'prompt', args: ['reply PROBE8-OK'] },
      respawnFlags: ['--model', HAIKU],
      attachStallRespawns: 2,
    }
    const o = await dispatch(sock, spec, 'P8')
    cleanups.push(o.cleanup)
  }

  // -----------------------------------------------------------------
  // Probe 9 -- source enum validation. Each value the schema admits.
  // -----------------------------------------------------------------
  header('Probe 9 -- source enum coverage')
  for (const source of ['shell', 'slash', 'fleet', 'spare', 'respawn'] as const) {
    const cwd = mkdtempSync(join(tmpdir(), `dispatch-spike-p9-${source}-`))
    const spec = {
      ...dispatchSpecBase({ cwd }),
      source,
      launch: { mode: 'prompt', args: [`reply PROBE9-${source.toUpperCase()}-OK`] },
    }
    const o = await dispatch(sock, spec, `P9-${source}`)
    cleanups.push(o.cleanup)
  }

  // -----------------------------------------------------------------
  // Cleanup -- claude rm every probe job. Don't fail the spike on a
  // cleanup error; just log it.
  // -----------------------------------------------------------------
  header('Cleanup')
  for (const c of cleanups) {
    try {
      await c()
    } catch (e) {
      logBoth(`cleanup error: ${(e as Error).message}`)
    }
  }
  logBoth('')
  logBoth('Spike complete.')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
