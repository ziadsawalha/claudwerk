#!/usr/bin/env bun
/**
 * One-command smoke for the dev component harness (`bun run harness:smoke`).
 *
 * Boots a THROWAWAY broker (fresh temp cache, never the prod broker) and proves
 * the dev-key impersonation path end-to-end against a real broker process:
 *   1. flag ON  -> broker-cli mints a key -> /auth/status authenticates AS the user
 *   2. a tampered token is rejected (signature integrity)
 *   3. flag OFF -> the SAME valid token is rejected AND mint refuses (prod safety)
 *
 * No browser required: this exercises the broker auth path the harness route
 * relies on. The component-mount + error-surface behaviour is covered by the
 * web tests (dev/harness/error-surface.test.tsx, dispatch-store.test.ts).
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = Number(process.env.HARNESS_SMOKE_PORT) || 9347
const BASE = `http://localhost:${PORT}`
const AS_USER = 'jonas'
const REPO = join(import.meta.dir, '..')

type Proc = ReturnType<typeof spawn>

function bootBroker(cacheDir: string, enabled: boolean): Proc {
  return spawn('bun', ['run', 'src/broker/index.ts', '--cache-dir', cacheDir, '--port', String(PORT)], {
    cwd: REPO,
    // VAPID disabled (an http base URL fails VAPID subject validation); flag
    // toggled per phase.
    env: { ...process.env, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', DEV_HARNESS_ENABLED: enabled ? '1' : '' },
    stdio: 'ignore',
  })
}

async function waitHealth(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return
    } catch {}
    await Bun.sleep(500)
  }
  throw new Error(`broker did not become healthy on ${BASE}`)
}

async function authStatus(token: string): Promise<{ authenticated: boolean; name: string | null }> {
  const r = await fetch(`${BASE}/auth/status`, { headers: { Cookie: `cw-session=${token}` } })
  return (await r.json()) as { authenticated: boolean; name: string | null }
}

function mint(cacheDir: string, enabled: boolean): { ok: boolean; token: string | null; stderr: string } {
  const r = Bun.spawnSync(
    ['bun', 'run', 'src/broker/cli.ts', 'mint-dev-key', '--as', AS_USER, '--cache-dir', cacheDir],
    {
      cwd: REPO,
      env: { ...process.env, DEV_HARNESS_ENABLED: enabled ? '1' : '' },
    },
  )
  const out = r.stdout.toString()
  const token = out.match(/dvk_[A-Za-z0-9._-]+/)?.[0] ?? null
  return { ok: r.exitCode === 0, token, stderr: r.stderr.toString() }
}

async function kill(proc: Proc): Promise<void> {
  proc.kill('SIGTERM')
  await Bun.sleep(300)
}

function check(label: string, cond: boolean): void {
  console.log(`${cond ? '  ✓' : '  ✗'} ${label}`)
  if (!cond) throw new Error(`FAILED: ${label}`)
}

/** flag ON: mint -> the key authenticates as the user; a tampered token fails. */
async function phaseFlagOn(cacheDir: string): Promise<{ proc: Proc; token: string }> {
  console.log('Phase 1: DEV_HARNESS_ENABLED=1')
  const proc = bootBroker(cacheDir, true)
  await waitHealth()

  const minted = mint(cacheDir, true)
  check('broker-cli mints a dev key', minted.ok && !!minted.token)
  const token = minted.token as string

  const authed = await authStatus(token)
  check(`dev key authenticates AS "${AS_USER}"`, authed.authenticated && authed.name === AS_USER)

  const tampered = await authStatus(`${token}x`)
  check('a tampered token is rejected', !tampered.authenticated)
  return { proc, token }
}

/** flag OFF (same cache dir + secret): the SAME valid token is rejected, mint refuses. */
async function phaseFlagOff(cacheDir: string, token: string): Promise<Proc> {
  console.log('Phase 2: DEV_HARNESS_ENABLED unset (prod-safety gate)')
  const proc = bootBroker(cacheDir, false)
  await waitHealth()

  const offAuth = await authStatus(token)
  check('the SAME valid token is rejected with the flag off', !offAuth.authenticated)

  const offMint = mint(cacheDir, false)
  check('mint refuses with the flag off', !offMint.ok && /disabled/i.test(offMint.stderr))
  return proc
}

async function main(): Promise<void> {
  const cacheDir = mkdtempSync(join(tmpdir(), 'harness-smoke-'))
  let proc: Proc | null = null
  try {
    const on = await phaseFlagOn(cacheDir)
    proc = on.proc
    await kill(proc)
    proc = await phaseFlagOff(cacheDir, on.token)
    console.log('\nHARNESS SMOKE PASSED ✓')
  } finally {
    if (proc) await kill(proc)
    rmSync(cacheDir, { recursive: true, force: true })
  }
}

main().catch(err => {
  console.error(`\nHARNESS SMOKE FAILED: ${err.message}`)
  process.exit(1)
})
