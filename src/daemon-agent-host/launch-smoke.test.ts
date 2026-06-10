/**
 * Tier-1 unit smoke for the cc-daemon launch smoke harness
 * (plan-daemon-launch-ux.md Phase H).
 *
 * The live harness (`scripts/cc-daemon-launch-smoke.ts`) needs a real Claude
 * Code daemon. These tests cover its testable fixture layer with NO daemon:
 * the in-memory broker, the version canary, the `claude --bg` parser, the
 * cleanup registry, the assertion helpers, the logger -- and drive the live
 * orchestration seams (`runAttachStep`, `fetchJobState`, `mirrorWorker`)
 * against `fake-daemon.ts`, exercising the real cc-daemon socket framing.
 */

import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ProtocolMismatchError } from '../shared/cc-daemon/client'
import { type FakeDaemon, type FakeHandler, startFakeDaemon } from '../shared/cc-daemon/fake-daemon'
import type { DaemonResponse, ListResponse } from '../shared/cc-daemon/types'
import {
  assistantTextOf,
  checkVersionCanary,
  createCleanupRegistry,
  createInMemoryBroker,
  createSmokeLogger,
  distinctStatesFrom,
  parseBackgroundShort,
  transcriptContainsText,
  waitUntil,
} from './launch-smoke'
import { fetchJobState, mirrorWorker, runAttachStep } from './launch-smoke-mirror'
import { transcriptJsonlPath } from './transcript-path'

const ATTACH_ACK = { ok: true, op: 'attach', decModes: [], via: 'fake', tempo: 'idle', state: 'idle' }

/** A fake daemon answering `list` with `jobs` and `attach` with a plain ack. */
function smokeHandler(jobs: ListResponse['jobs']): FakeHandler {
  return (req, conn) => {
    if (req.op === 'list') {
      conn.send({ ok: true, op: 'list', jobs })
      conn.end()
    } else if (req.op === 'attach') {
      conn.send(ATTACH_ACK)
    } else {
      conn.send({ ok: false, error: `unhandled op ${req.op}` })
      conn.end()
    }
  }
}

describe('parseBackgroundShort', () => {
  it('extracts the 8-hex short from a plain line', () => {
    expect(parseBackgroundShort('backgrounded - a1b2c3d4')).toBe('a1b2c3d4')
  })
  it('strips ANSI escapes before matching', () => {
    expect(parseBackgroundShort('[32mbackgrounded - deadbeef[0m\n')).toBe('deadbeef')
  })
  it('returns null when no short is present', () => {
    expect(parseBackgroundShort('error: not logged in')).toBeNull()
  })
})

describe('checkVersionCanary', () => {
  it('passes when the daemon proto matches', () => {
    const result = checkVersionCanary({ ok: true, op: 'ping', proto: 1, version: '2.1.144' } as DaemonResponse)
    expect(result).toMatchObject({ ok: true, proto: 1, version: '2.1.144' })
  })
  it('FAILS LOUD on a daemon protocol bump', () => {
    const result = checkVersionCanary({ ok: true, op: 'ping', proto: 2 } as DaemonResponse)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('claudewerk needs an update')
  })
  it('passes with a note when the daemon does not echo proto', () => {
    const result = checkVersionCanary({ ok: true, op: 'ping' } as DaemonResponse)
    expect(result.ok).toBe(true)
    expect(result.note).toContain('EPROTO')
  })
  it('fails when the ping itself failed', () => {
    const result = checkVersionCanary({ ok: false, error: 'down', code: 'ENOCONN' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('ENOCONN')
  })
})

describe('assistant transcript helpers', () => {
  const entries = [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'PROBE-NEW-OK GIRAFFE-1' }] } },
    { type: 'assistant', message: { content: 'plain string reply' } },
    { type: 'user', message: { content: [{ type: 'text', text: 'ignored' }] } },
  ] as never[]
  it('collects assistant text from array and string content', () => {
    expect(assistantTextOf(entries)).toEqual(['PROBE-NEW-OK GIRAFFE-1', 'plain string reply'])
  })
  it('matches a needle, skipping non-assistant entries', () => {
    expect(transcriptContainsText(entries, 'GIRAFFE-1')).toBe(true)
    expect(transcriptContainsText(entries, 'ignored')).toBe(false)
  })
})

describe('distinctStatesFrom', () => {
  it('dedupes, drops empties, preserves order', () => {
    expect(distinctStatesFrom(['starting', 'working', null, '', 'working', 'idle'])).toEqual([
      'starting',
      'working',
      'idle',
    ])
  })
})

describe('createSmokeLogger', () => {
  it('writes timestamped lines with the right marks', () => {
    const lines: string[] = []
    const log = createSmokeLogger(line => lines.push(line))
    log.step('phase')
    log.ok('passed')
    log.fail('boom')
    expect(lines[0]).toMatch(/^\[smoke \+[\d.]+s] >> phase\n$/)
    expect(lines[1]).toContain('OK passed')
    expect(lines[2]).toContain('FAIL boom')
  })
})

describe('waitUntil', () => {
  it('resolves once the probe yields a value', async () => {
    let n = 0
    const got = await waitUntil(() => (++n >= 3 ? `hit-${n}` : null), { intervalMs: 1 })
    expect(got).toBe('hit-3')
  })
  it('throws on timeout', async () => {
    await expect(waitUntil(() => null, { timeoutMs: 30, intervalMs: 5, label: 'nothing' })).rejects.toThrow(
      /timed out.*nothing/,
    )
  })
})

describe('createInMemoryBroker', () => {
  it('records transcript entries opaquely and flattens them', () => {
    const broker = createInMemoryBroker('conv-1')
    broker.transport.sendTranscriptEntries([{ type: 'assistant' } as never], true)
    broker.transport.sendTranscriptEntries([{ type: 'user' } as never], false)
    expect(broker.batchCount()).toBe(2)
    expect(broker.transcriptEntries()).toHaveLength(2)
  })
  it('setSessionId is a no-op (boundary rule -- a broker never reads ccSessionId)', () => {
    const broker = createInMemoryBroker('conv-1')
    broker.transport.setSessionId('cc-secret-id', 'stream_json')
    expect(broker.messages()).toHaveLength(0)
  })
  it('waitForTranscript resolves on a match and rejects on timeout', async () => {
    const broker = createInMemoryBroker('conv-1')
    setTimeout(() => broker.transport.sendTranscriptEntries([{ type: 'assistant' } as never], false), 10)
    await expect(
      broker.waitForTranscript(e => (e as { type?: string }).type === 'assistant', { timeoutMs: 500 }),
    ).resolves.toBeDefined()
    await expect(broker.waitForTranscript(() => false, { timeoutMs: 30 })).rejects.toThrow(/timed out/)
  })
})

describe('createCleanupRegistry', () => {
  it('dedupes tracked jobs and dirs', () => {
    const reg = createCleanupRegistry()
    reg.trackJob('aaaa1111')
    reg.trackJob('aaaa1111')
    reg.trackTempDir('/tmp/x')
    expect(reg.jobs()).toEqual(['aaaa1111'])
    expect(reg.tempDirs()).toEqual(['/tmp/x'])
  })
  it('removes every job + dir and counts failures', async () => {
    const reg = createCleanupRegistry()
    const dir = mkdtempSync(join(tmpdir(), 'cleanup-test-'))
    reg.trackTempDir(dir)
    reg.trackJob('good')
    reg.trackJob('bad')
    const summary = await reg.run({
      removeJob: short => (short === 'bad' ? Promise.reject(new Error('rm failed')) : Promise.resolve()),
    })
    expect(summary).toEqual({ jobsRemoved: 1, jobsFailed: 1, dirsRemoved: 1 })
    expect(existsSync(dir)).toBe(false)
  })
})

describe('fetchJobState (against a fake list)', () => {
  const listFn = async (): Promise<ListResponse> => ({
    ok: true,
    op: 'list',
    jobs: [{ short: 'abcd1234', sessionId: 's', cwd: '/', state: 'working' }],
  })
  it('returns the job state for a known short', async () => {
    expect(await fetchJobState('/sock', 'abcd1234', listFn)).toBe('working')
  })
  it('returns null for an absent short', async () => {
    expect(await fetchJobState('/sock', 'ffffffff', listFn)).toBeNull()
  })
})

describe('runAttachStep (against a fake daemon)', () => {
  it('attaches and surfaces the ack state', async () => {
    const daemon = await startFakeDaemon(smokeHandler([]))
    const handle = await runAttachStep({ controlSock: daemon.sockPath, short: 'abcd1234' })
    expect(handle.ack.state).toBe('idle')
    handle.close()
    await daemon.close()
  })
  it('retries a transient ESTARTING, then succeeds', async () => {
    let attempts = 0
    const daemon = await startFakeDaemon((req, conn) => {
      if (req.op !== 'attach') return
      attempts++
      if (attempts === 1) {
        conn.send({ ok: false, error: 'worker starting', code: 'ESTARTING' })
        conn.end()
      } else {
        conn.send(ATTACH_ACK)
      }
    })
    const handle = await runAttachStep({ controlSock: daemon.sockPath, short: 'abcd1234', delayMs: 5 })
    expect(attempts).toBe(2)
    handle.close()
    await daemon.close()
  })
  it('never retries EPROTO -- throws ProtocolMismatchError', async () => {
    const daemon = await startFakeDaemon((req, conn) => {
      if (req.op !== 'attach') return
      conn.send({ ok: false, error: 'protocol bump', code: 'EPROTO' })
      conn.end()
    })
    await expect(runAttachStep({ controlSock: daemon.sockPath, short: 'abcd1234' })).rejects.toBeInstanceOf(
      ProtocolMismatchError,
    )
    await daemon.close()
  })
})

describe('mirrorWorker (against a fake daemon)', () => {
  const silent = createSmokeLogger(() => {})

  it('observes the worker, attaches, and wires the transcript bridge', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mirror-test-'))
    // The transcript bridge waits (waitForFileMs) for the worker's JSONL to
    // appear before it can open it. No real worker runs here, so seed the file
    // the bridge will watch -- otherwise bootstrap blocks on a file that never
    // exists and the mirror never resolves.
    const jsonl = transcriptJsonlPath(cwd, 'cc-smoke-1')
    mkdirSync(dirname(jsonl), { recursive: true })
    writeFileSync(jsonl, `${JSON.stringify({ type: 'assistant', message: { content: [] } })}\n`)
    const daemon: FakeDaemon = await startFakeDaemon(
      smokeHandler([{ short: 'abcd1234', sessionId: 'cc-smoke-1', cwd, state: 'working' }]),
    )
    const broker = createInMemoryBroker('conv-mirror')
    try {
      const mirror = await mirrorWorker({
        controlSock: daemon.sockPath,
        short: 'abcd1234',
        mode: 'new',
        cwd,
        broker,
        log: silent,
      })
      expect(mirror.ccSessionId).toBe('cc-smoke-1')
      expect(mirror.attachState).toBe('idle')
      mirror.stop()
    } finally {
      await daemon.close()
      rmSync(jsonl, { force: true })
    }
  })

  it('rejects when no ccSessionId is derived before the bootstrap timeout', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'mirror-test-'))
    const daemon = await startFakeDaemon(smokeHandler([]))
    await expect(
      mirrorWorker({
        controlSock: daemon.sockPath,
        short: 'deadbeef',
        mode: 'new',
        cwd,
        broker: createInMemoryBroker('conv-timeout'),
        log: silent,
        bootstrapTimeoutMs: 250,
      }),
    ).rejects.toThrow(/derived no ccSessionId/)
    await daemon.close()
  })
})
