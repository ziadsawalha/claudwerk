import { afterEach, describe, expect, it } from 'bun:test'
import { ProtocolMismatchError, request } from './client'
import { type FakeDaemon, startFakeDaemon } from './fake-daemon'
import { awaitAck, dispatch, has, kill, lease, leases, list, ping, reply, resize, respawnStale } from './ops'
import { CC_DAEMON_PROTO, type DispatchSpec } from './types'

/** A minimal NEW-mode DispatchSpec for the dispatch op tests. */
function newSpec(overrides: Partial<DispatchSpec> = {}): DispatchSpec {
  return {
    short: 'cb2892db',
    nonce: '08c8b601',
    sessionId: 'df140babfa311efb1c4c30f77e6d231d',
    createdAt: 1779519070513,
    source: 'fleet',
    cwd: '/tmp/probe',
    launch: { mode: 'prompt', args: ['--model', 'm', 'do the thing'] },
    env: {},
    isolation: 'none',
    respawnFlags: ['--model', 'm'],
    ...overrides,
  }
}

let daemon: FakeDaemon | undefined

afterEach(async () => {
  await daemon?.close()
  daemon = undefined
})

describe('ops against a fake daemon', () => {
  it('ping resolves the daemon ok response', async () => {
    daemon = await startFakeDaemon((req, conn) => {
      expect(req.proto).toBe(CC_DAEMON_PROTO) // client stamps every frame
      expect(req.op).toBe('ping')
      conn.send({ ok: true, op: 'ping', version: '2.1.143', proto: 1 })
      conn.end()
    })
    const resp = await ping(daemon.sockPath)
    expect(resp.ok).toBe(true)
    if (resp.ok) expect(resp.version).toBe('2.1.143')
  })

  it('list returns inline job records', async () => {
    daemon = await startFakeDaemon((_req, conn) => {
      conn.send({
        ok: true,
        op: 'list',
        jobs: [{ short: 'aeb185f9', sessionId: 'aeb185f9-c7c3', cwd: '/tmp', state: 'done' }],
      })
      conn.end()
    })
    const resp = await list(daemon.sockPath)
    expect(resp.jobs).toHaveLength(1)
    expect(resp.jobs[0]?.short).toBe('aeb185f9')
  })

  it('list throws when the daemon answers an error frame', async () => {
    daemon = await startFakeDaemon((_req, conn) => {
      conn.send({ ok: false, error: 'daemon busy' })
      conn.end()
    })
    expect(list(daemon.sockPath)).rejects.toThrow(/daemon busy/)
  })

  it('has reports job liveness', async () => {
    daemon = await startFakeDaemon((req, conn) => {
      expect(req.short).toBe('aeb185f9')
      conn.send({ ok: true, op: 'has', alive: true, present: true })
      conn.end()
    })
    const resp = await has(daemon.sockPath, 'aeb185f9')
    expect(resp.ok).toBe(true)
    if (resp.ok) expect(resp.alive).toBe(true)
  })

  it('leases returns the client list', async () => {
    daemon = await startFakeDaemon((_req, conn) => {
      conn.send({ ok: true, op: 'leases', clients: [{ label: 'sentinel', cwd: '/x', pid: 1 }] })
      conn.end()
    })
    const resp = await leases(daemon.sockPath)
    expect(resp.ok).toBe(true)
  })

  it('lease registers a client with label/cwd/pid', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'lease' })
      conn.end()
    })
    await lease(daemon.sockPath, { label: 'sentinel', cwd: '/x', pid: 42 })
    expect(seen?.op).toBe('lease')
    expect(seen?.client).toEqual({ label: 'sentinel', cwd: '/x', pid: 42 })
  })

  it('resize sends cols/rows and the attachId when given', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'resize' })
      conn.end()
    })
    await resize(daemon.sockPath, 'aeb185f9', 100, 30, 'att_1')
    expect(seen).toMatchObject({ op: 'resize', short: 'aeb185f9', cols: 100, rows: 30, attachId: 'att_1' })
  })

  it('resize omits attachId when not given', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'resize' })
      conn.end()
    })
    await resize(daemon.sockPath, 'aeb185f9', 80, 24)
    expect(seen).toMatchObject({ op: 'resize', short: 'aeb185f9', cols: 80, rows: 24 })
    expect(seen).not.toHaveProperty('attachId')
  })

  it('reply injects text into a worker', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'reply' })
      conn.end()
    })
    await reply(daemon.sockPath, 'aeb185f9', 'continue please')
    expect(seen).toMatchObject({ op: 'reply', short: 'aeb185f9', text: 'continue please' })
  })

  it('kill passes the signal through when given', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'kill' })
      conn.end()
    })
    await kill(daemon.sockPath, 'aeb185f9', 'SIGKILL')
    expect(seen).toMatchObject({ op: 'kill', short: 'aeb185f9', signal: 'SIGKILL' })
  })

  it('respawnStale targets a worker short id', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'respawn-stale' })
      conn.end()
    })
    await respawnStale(daemon.sockPath, 'aeb185f9')
    expect(seen).toMatchObject({ op: 'respawn-stale', short: 'aeb185f9' })
  })

  it('dispatch wraps the spec in `d`, stamps the inner proto, and returns the response', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'dispatch', short: 'cb2892db', pid: 57183, messagingSock: '', via: 'spare' })
      conn.end()
    })
    const resp = await dispatch(daemon.sockPath, newSpec(), 8000)
    expect(resp).toMatchObject({ ok: true, op: 'dispatch', short: 'cb2892db', pid: 57183, via: 'spare' })
    expect(seen?.op).toBe('dispatch')
    expect(seen?.timeoutMs).toBe(8000)
    const d = seen?.d as Record<string, unknown>
    expect(d.proto).toBe(CC_DAEMON_PROTO) // inner spec is proto-stamped too
    expect(d.source).toBe('fleet')
    expect(d.short).toBe('cb2892db')
    expect(d.launch).toEqual({ mode: 'prompt', args: ['--model', 'm', 'do the thing'] })
  })

  it('dispatch carries a resume launch with fork:true (the legacy continuity semantics)', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'dispatch', short: 'cb2892db', pid: 1, messagingSock: '', via: 'cold' })
      conn.end()
    })
    await dispatch(
      daemon.sockPath,
      newSpec({ launch: { mode: 'resume', sessionId: 'seed-sess', fork: true, flagArgs: ['--model', 'm'] } }),
    )
    const d = seen?.d as Record<string, unknown>
    expect(d.launch).toEqual({ mode: 'resume', sessionId: 'seed-sess', fork: true, flagArgs: ['--model', 'm'] })
  })

  it('dispatch throws on a not-ok response, surfacing the daemon code', async () => {
    daemon = await startFakeDaemon((_req, conn) => {
      conn.send({ ok: false, error: 'short-alive', code: 'EALIVE' })
      conn.end()
    })
    expect(dispatch(daemon.sockPath, newSpec())).rejects.toThrow(/dispatch failed: short-alive \(EALIVE\)/)
  })

  it('awaitAck sends short + timeoutMs, omitting nonce when not given', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'await-ack' })
      conn.end()
    })
    await awaitAck(daemon.sockPath, 'cb2892db', { timeoutMs: 5000 })
    expect(seen).toMatchObject({ op: 'await-ack', short: 'cb2892db', timeoutMs: 5000 })
    expect(seen).not.toHaveProperty('nonce')
  })

  it('awaitAck passes the nonce through when given', async () => {
    let seen: Record<string, unknown> | undefined
    daemon = await startFakeDaemon((req, conn) => {
      seen = req
      conn.send({ ok: true, op: 'await-ack' })
      conn.end()
    })
    await awaitAck(daemon.sockPath, 'cb2892db', { nonce: '08c8b601' })
    expect(seen).toMatchObject({ op: 'await-ack', short: 'cb2892db', nonce: '08c8b601' })
  })

  it('maps an EPROTO error frame to ProtocolMismatchError', async () => {
    daemon = await startFakeDaemon((_req, conn) => {
      conn.send({ ok: false, error: 'unsupported proto', code: 'EPROTO' })
      conn.end()
    })
    expect(request(daemon.sockPath, { op: 'ping' })).rejects.toBeInstanceOf(ProtocolMismatchError)
  })

  it('times out when the daemon never answers', async () => {
    daemon = await startFakeDaemon(() => {
      /* hold the connection, send nothing */
    })
    expect(request(daemon.sockPath, { op: 'ping' }, { timeoutMs: 150 })).rejects.toThrow(/timed out/)
  })

  it('rejects when the socket path does not exist', async () => {
    expect(request('/tmp/cc-daemon-test-nonexistent.sock', { op: 'ping' })).rejects.toThrow(/socket error/)
  })
})
