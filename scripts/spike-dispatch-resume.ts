#!/usr/bin/env bun
/**
 * Follow-up to spike-dispatch-op.ts: tighter probe of resume mode with
 * fork:true and fork:false. Question: does fork:false preserve the resumed
 * worker's ccSessionId (the historical claudewerk-blocker), or does the
 * daemon ignore fork:false and always fork?
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
const FINDINGS = join(import.meta.dir, 'spike-dispatch-resume-findings.md')

function logBoth(line: string): void {
  console.log(line)
  appendFileSync(FINDINGS, `${line}\n`)
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>(r => setTimeout(r, ms))
}

async function removeJob(short: string): Promise<void> {
  try {
    const proc = Bun.spawn(['claude', 'rm', short], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
  } catch {
    // ignore
  }
}

async function pollJob(sock: string, short: string, timeoutMs: number): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const r = await list(sock)
    const j = r.jobs.find(jj => jj.short === short)
    if (j) return j
    await sleep(300)
  }
  return null
}

async function main(): Promise<void> {
  writeFileSync(FINDINGS, `# Spike: dispatch resume fork:false -- ${new Date().toISOString()}\n\n`)
  const sock = await resolveControlSocket()
  if (!sock) throw new Error('No daemon socket -- run the broader spike first to wake the daemon.')
  logBoth(`daemon: ${JSON.stringify(await ping(sock))}`)

  // -------------------------------------------------------------------
  // Step 1: dispatch a seed worker via claude --bg to obtain a real
  // sessionId we can resume from. claude --bg's resume goes through the
  // CLI path; we want to test the SOCKET dispatch op's resume path
  // specifically.
  // -------------------------------------------------------------------
  const seedCwd = mkdtempSync(join(tmpdir(), 'resume-spike-seed-'))
  const seedShort = await dispatchDaemonWorker({
    cwd: seedCwd,
    name: `resume-spike-seed-${randomBytes(4).toString('hex')}`,
    prompt: 'reply SEED-CODEWORD-WAFFLE-7392',
    model: HAIKU,
  })
  logBoth(`seed worker dispatched: ${seedShort}`)
  // Wait for the worker to settle and write its sessionId to JobRecord.
  await sleep(2500)
  const seedJob = await pollJob(sock, seedShort, 6000)
  logBoth(`seed job: ${JSON.stringify(seedJob)}`)
  const seedSessionId = (seedJob as { sessionId?: string })?.sessionId
  if (!seedSessionId) throw new Error('seed worker has no sessionId')

  // Wait for the seed turn to complete so resume has something to fork from.
  await sleep(5000)
  const seedDone = await pollJob(sock, seedShort, 2000)
  logBoth(`seed job after wait: ${JSON.stringify(seedDone)}`)

  // -------------------------------------------------------------------
  // Probe A: dispatch resume fork:false.
  // Expectation: if the daemon honors fork:false, the dispatched worker's
  // sessionId equals seedSessionId. If it ignores fork:false, the worker
  // gets a fresh ccSessionId (the plan-daemon spike-1 surprise).
  // -------------------------------------------------------------------
  const probeAShort = randomBytes(4).toString('hex')
  const probeANonce = randomBytes(4).toString('hex')
  const specA = {
    proto: 1,
    short: probeAShort,
    nonce: probeANonce,
    sessionId: randomBytes(16).toString('hex'),
    createdAt: Date.now(),
    source: 'shell',
    cwd: seedCwd,
    launch: { mode: 'resume', sessionId: seedSessionId, fork: false, flagArgs: [] },
    env: {},
    isolation: 'none',
    respawnFlags: [],
  }
  const respA = await request(sock, { op: 'dispatch', d: specA, timeoutMs: 8000 } as never)
  logBoth(`PROBE A (fork:false) dispatch resp: ${JSON.stringify(respA)}`)
  await sleep(2500)
  const probeAJob = await pollJob(sock, probeAShort, 6000)
  logBoth(`PROBE A job after dispatch: ${JSON.stringify(probeAJob)}`)
  const probeASid = (probeAJob as { sessionId?: string })?.sessionId
  logBoth(`PROBE A: probe sessionId=${probeASid} vs seed=${seedSessionId} -- match=${probeASid === seedSessionId}`)

  // -------------------------------------------------------------------
  // Probe B: dispatch resume fork:true.
  // Expectation: fork:true forks the worker to a fresh sessionId. Should
  // match the historical `claude --bg --resume` CLI behavior.
  // -------------------------------------------------------------------
  const probeBShort = randomBytes(4).toString('hex')
  const probeBNonce = randomBytes(4).toString('hex')
  const specB = {
    proto: 1,
    short: probeBShort,
    nonce: probeBNonce,
    sessionId: randomBytes(16).toString('hex'),
    createdAt: Date.now(),
    source: 'shell',
    cwd: seedCwd,
    launch: { mode: 'resume', sessionId: seedSessionId, fork: true, flagArgs: [] },
    env: {},
    isolation: 'none',
    respawnFlags: [],
  }
  const respB = await request(sock, { op: 'dispatch', d: specB, timeoutMs: 8000 } as never)
  logBoth(`PROBE B (fork:true) dispatch resp: ${JSON.stringify(respB)}`)
  await sleep(2500)
  const probeBJob = await pollJob(sock, probeBShort, 6000)
  logBoth(`PROBE B job after dispatch: ${JSON.stringify(probeBJob)}`)
  const probeBSid = (probeBJob as { sessionId?: string })?.sessionId
  logBoth(`PROBE B: probe sessionId=${probeBSid} vs seed=${seedSessionId} -- match=${probeBSid === seedSessionId}`)

  // Cleanup.
  logBoth('')
  logBoth('## Cleanup')
  await removeJob(seedShort)
  await removeJob(probeAShort)
  await removeJob(probeBShort)
  logBoth('Done.')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
