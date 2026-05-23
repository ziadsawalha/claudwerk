#!/usr/bin/env bun
/**
 * spike-dispatch-phase4 -- the Phase 4 cutover acceptance spike.
 *
 * Two questions the cutover from `claude --bg` shell-out to the socket
 * `dispatch` op cannot ship without answering live (plan-claude-transport-reframe
 * § 7.1, the deferred Phase-0 P4 item):
 *
 *   PART A (fork decision). Dispatch a long-running seed worker, resume it via
 *     the SOCKET dispatch op with fork:false AND fork:true, capture each
 *     resumed worker's reported sessionId, and decide whether claudewerk uses
 *     fork:false (preserve the resumed sessionId -> simpler identity model) or
 *     fork:true (the legacy `claude --bg --resume` always-fork semantics).
 *     The Phase-0 probe could not capture the resumed sessionId because the
 *     workers exited before `list` saw them; this spike polls `list` every
 *     150ms so it catches them while alive.
 *
 *   PART B (NEW-mode flag passthrough). The cutover emits a DispatchSpec with
 *     `launch:{mode:'prompt', args:[...flags, prompt]}` where flags carry
 *     `--model`. Verify a socket-dispatched NEW worker (a) comes up, (b) runs
 *     the trailing-positional prompt (codeword lands in its transcript), and
 *     (c) actually honors `--model` in launch.args (the transcript assistant
 *     message reports the haiku model). This confirms the exact DispatchSpec
 *     shape buildDispatchSpec() will emit BEFORE the cutover is written.
 *
 * Pattern: Haiku probes, `claude rm` in finally, bounded cost (~4 Haiku turns,
 * well under the $1 spike ceiling). Run manually:
 *
 *     bun run scripts/spike-dispatch-phase4.ts
 *
 * Output goes to stdout and to scripts/spike-dispatch-phase4-findings.md.
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dispatchDaemonWorker } from '../src/daemon-agent-host/launch-smoke-mirror'
import { transcriptJsonlPath } from '../src/daemon-agent-host/transcript-path'
import { request } from '../src/shared/cc-daemon/client'
import { list, ping } from '../src/shared/cc-daemon/ops'
import { resolveControlSocket } from '../src/shared/cc-daemon/socket-path'
import type { JobRecord } from '../src/shared/cc-daemon/types'

const HAIKU = 'claude-haiku-4-5-20251001'
const FINDINGS = join(import.meta.dir, 'spike-dispatch-phase4-findings.md')

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

function mintHex8(): string {
  return randomBytes(4).toString('hex')
}

function mintSessionId(): string {
  return randomBytes(16).toString('hex')
}

async function removeJob(short: string): Promise<void> {
  try {
    const proc = Bun.spawn(['claude', 'rm', short], { stdout: 'pipe', stderr: 'pipe' })
    await proc.exited
  } catch {
    // ignore
  }
}

/** Poll `list` every 150ms until `short` appears (alive) or the window elapses. */
async function catchJob(sock: string, short: string, windowMs: number): Promise<JobRecord | null> {
  const deadline = Date.now() + windowMs
  while (Date.now() < deadline) {
    const r = await list(sock)
    const j = r.jobs.find(jj => jj.short === short)
    if (j) return j
    await sleep(150)
  }
  return null
}

/** Send one dispatch frame with the canonical claudewerk provenance source. */
async function dispatchRaw(sock: string, d: Record<string, unknown>): Promise<unknown> {
  const req = { op: 'dispatch', d: { proto: 1, ...d }, timeoutMs: 8000 }
  try {
    return await request(sock, req as never)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}

interface ForkProbeResult {
  resumedSessionId?: string
  matchesSeed: boolean
}

/** Resume `seedSessionId` via the socket op with the given fork flag; report the resumed worker's sessionId. */
async function forkProbe(
  sock: string,
  seedSessionId: string,
  seedCwd: string,
  fork: boolean,
  label: string,
): Promise<ForkProbeResult> {
  const short = mintHex8()
  const spec = {
    short,
    nonce: mintHex8(),
    sessionId: mintSessionId(),
    createdAt: Date.now(),
    source: 'fleet',
    cwd: seedCwd,
    launch: { mode: 'resume', sessionId: seedSessionId, fork, flagArgs: ['--model', HAIKU] },
    env: {},
    isolation: 'none',
    respawnFlags: [],
  }
  const resp = await dispatchRaw(sock, spec)
  logBoth(`[${label}] dispatch resp: ${JSON.stringify(resp)}`)
  const job = await catchJob(sock, short, 8000)
  logBoth(`[${label}] resumed job: ${JSON.stringify(job)}`)
  const resumedSessionId = job?.sessionId
  const matchesSeed = resumedSessionId === seedSessionId
  logBoth(`[${label}] resumedSessionId=${resumedSessionId} seedSessionId=${seedSessionId} match=${matchesSeed}`)
  await removeJob(short)
  return { resumedSessionId, matchesSeed }
}

interface TranscriptEntry {
  type?: string
  message?: { model?: string; content?: unknown }
}

/** Parse one JSONL line into a transcript entry, or null if it is not JSON. */
function parseEntry(line: string): TranscriptEntry | null {
  try {
    return JSON.parse(line) as TranscriptEntry
  } catch {
    return null
  }
}

/** The model on the last assistant entry that carries one, or null. */
function lastAssistantModel(entries: Array<TranscriptEntry | null>): string | null {
  const models = entries.filter(e => e?.type === 'assistant' && e.message?.model).map(e => e?.message?.model)
  return models.at(-1) ?? null
}

/** Read a worker transcript JSONL: did the codeword land, and what model did the assistant use? */
function inspectTranscript(
  jsonlPath: string,
  codeword: string,
): { codewordSeen: boolean; assistantModel: string | null } {
  let raw: string
  try {
    raw = readFileSync(jsonlPath, 'utf8')
  } catch (e) {
    logBoth(`[NEW] could not read transcript: ${(e as Error).message}`)
    return { codewordSeen: false, assistantModel: null }
  }
  const entries = raw.split('\n').filter(Boolean).map(parseEntry)
  const codewordSeen = entries.some(e => JSON.stringify(e?.message?.content ?? '').includes(codeword))
  return { codewordSeen, assistantModel: lastAssistantModel(entries) }
}

/** PART B -- dispatch a NEW worker via the socket op and verify flag passthrough. */
async function runFlagPassthrough(sock: string, shortsToClean: string[]): Promise<void> {
  header('PART B -- NEW-mode flag passthrough (launch.args carries --model + prompt)')
  const newCwd = mkdtempSync(join(tmpdir(), 'p4-new-'))
  const codeword = `NEW-CODEWORD-${mintHex8().toUpperCase()}`
  const newShort = mintHex8()
  const newSessionId = mintSessionId()
  const newSpec = {
    short: newShort,
    nonce: mintHex8(),
    sessionId: newSessionId,
    createdAt: Date.now(),
    source: 'fleet',
    cwd: newCwd,
    launch: { mode: 'prompt', args: ['--model', HAIKU, `Reply with exactly: ${codeword} and nothing else.`] },
    env: {},
    isolation: 'none',
    respawnFlags: ['--model', HAIKU],
  }
  const newResp = await dispatchRaw(sock, newSpec)
  logBoth(`[NEW] dispatch resp: ${JSON.stringify(newResp)}`)
  shortsToClean.push(newShort)
  const newJob = await catchJob(sock, newShort, 8000)
  logBoth(`[NEW] job: ${JSON.stringify(newJob)}`)
  const newWorkerSessionId = newJob?.sessionId ?? newSessionId
  logBoth(`[NEW] worker sessionId = ${newWorkerSessionId} (dispatch-supplied = ${newSessionId})`)

  // Wait for the turn, then inspect the transcript JSONL.
  await sleep(8000)
  const jsonlPath = transcriptJsonlPath(newCwd, newWorkerSessionId)
  logBoth(`[NEW] transcript path: ${jsonlPath}`)
  const { codewordSeen, assistantModel } = inspectTranscript(jsonlPath, codeword)
  logBoth(`[NEW] codeword "${codeword}" in transcript? ${codewordSeen}`)
  logBoth(`[NEW] assistant message model = ${assistantModel} (expected ${HAIKU})`)
  logBoth(`[NEW] --model honored via launch.args? ${assistantModel === HAIKU}`)
}

/** PART A -- resume a long-running seed worker with fork:false AND fork:true. */
async function runForkDecision(sock: string, shortsToClean: string[]): Promise<void> {
  header('PART A -- fork decision (resume via socket op)')
  // Seed via the known-good `claude --bg` CLI path -- a real, resumable session.
  const seedCwd = mkdtempSync(join(tmpdir(), 'p4-seed-'))
  const seedShort = await dispatchDaemonWorker({
    cwd: seedCwd,
    name: `p4-seed-${mintHex8()}`,
    prompt: 'Reply with exactly: SEED-CODEWORD-WALRUS and nothing else.',
    model: HAIKU,
  })
  shortsToClean.push(seedShort)
  logBoth(`seed dispatched: ${seedShort} (cwd=${seedCwd})`)
  const seedJob = await catchJob(sock, seedShort, 8000)
  logBoth(`seed job: ${JSON.stringify(seedJob)}`)
  const seedSessionId = seedJob?.sessionId
  if (!seedSessionId) throw new Error('seed worker never reported a sessionId')
  await sleep(6000) // let the seed turn finish so the transcript is on disk

  const forkFalse = await forkProbe(sock, seedSessionId, seedCwd, false, 'fork:false')
  const forkTrue = await forkProbe(sock, seedSessionId, seedCwd, true, 'fork:true')

  header('PART A -- conclusion')
  logBoth(`fork:false preserved the seed sessionId? ${forkFalse.matchesSeed}`)
  logBoth(`fork:true  preserved the seed sessionId? ${forkTrue.matchesSeed}`)
}

async function main(): Promise<void> {
  writeFileSync(FINDINGS, `# Spike: dispatch Phase 4 cutover -- ${new Date().toISOString()}\n\n`)
  const sock = resolveControlSocket()
  if (!sock) throw new Error('EXTERNAL BLOCKER: no daemon control socket reachable')
  logBoth(`daemon ping: ${JSON.stringify(await ping(sock))}`)

  const shortsToClean: string[] = []

  await runForkDecision(sock, shortsToClean)
  await runFlagPassthrough(sock, shortsToClean)

  header('Cleanup')
  for (const s of shortsToClean) {
    await removeJob(s)
    logBoth(`removed ${s}`)
  }
  logBoth('')
  logBoth('Spike complete.')
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
