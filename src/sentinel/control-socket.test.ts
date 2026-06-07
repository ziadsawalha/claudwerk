import { describe, expect, it } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ControlDeps,
  handleControlRequest,
  resolveControlSocketPath,
  sendControlRequest,
  startControlSocketServer,
} from './control-socket'

function deps(over: Partial<ControlDeps> = {}): ControlDeps {
  return { shellEnabled: true, openShell: (p, t) => `sh_${p}_${t ?? ''}`, ...over }
}

describe('resolveControlSocketPath', () => {
  it('lives next to sentinel.json under XDG_CONFIG_HOME', () => {
    expect(resolveControlSocketPath({ XDG_CONFIG_HOME: '/cfg' } as NodeJS.ProcessEnv, '/home/u')).toBe(
      '/cfg/rclaude/control.sock',
    )
  })
  it('falls back to ~/.config when XDG is unset', () => {
    expect(resolveControlSocketPath({} as NodeJS.ProcessEnv, '/home/u')).toBe('/home/u/.config/rclaude/control.sock')
  })
})

describe('handleControlRequest', () => {
  it('ping -> ok', async () => {
    expect(await handleControlRequest({ op: 'ping' }, deps())).toEqual({ ok: true })
  })

  it('shell_open -> ok with the shellId from openShell', async () => {
    expect(await handleControlRequest({ op: 'shell_open', path: '/x', title: 't' }, deps())).toEqual({
      ok: true,
      shellId: 'sh_/x_t',
    })
  })

  it('shell_open is refused when the shell feature is disabled', async () => {
    const r = await handleControlRequest({ op: 'shell_open', path: '/x' }, deps({ shellEnabled: false }))
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/disabled/)
  })

  it('shell_open requires a path', async () => {
    const r = await handleControlRequest({ op: 'shell_open' }, deps())
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/path/)
  })

  it('maps an openShell failure to ok:false', async () => {
    const r = await handleControlRequest(
      { op: 'shell_open', path: '/x' },
      deps({
        openShell: () => {
          throw new Error('spawn boom')
        },
      }),
    )
    expect(r).toEqual({ ok: false, error: 'spawn boom' })
  })

  it('rejects malformed + unknown ops', async () => {
    expect((await handleControlRequest(null, deps())).ok).toBe(false)
    expect((await handleControlRequest({ op: 'nope' }, deps())).ok).toBe(false)
  })
})

describe('control socket round-trip (real unix socket)', () => {
  it('a client request reaches the handler and gets the response', async () => {
    const path = join(tmpdir(), `cw-control-${Math.random().toString(36).slice(2)}.sock`)
    let seen: unknown = null
    const srv = startControlSocketServer(
      path,
      req => {
        seen = req
        return handleControlRequest(req, deps({ openShell: () => 'sh_roundtrip' }))
      },
      () => {},
    )
    try {
      // wait for the listener to bind
      for (let i = 0; i < 50 && !require('node:fs').existsSync(path); i++) await Bun.sleep(10)
      const resp = await sendControlRequest(path, { op: 'shell_open', path: '/tmp/work', title: 'work' })
      expect(resp).toEqual({ ok: true, shellId: 'sh_roundtrip' })
      expect(seen).toEqual({ op: 'shell_open', path: '/tmp/work', title: 'work' })
    } finally {
      srv.close()
    }
  })

  it('sendControlRequest rejects when no sentinel is listening', async () => {
    const path = join(tmpdir(), `cw-control-missing-${Math.random().toString(36).slice(2)}.sock`)
    let threw = false
    try {
      await sendControlRequest(path, { op: 'ping' })
    } catch {
      threw = true
    }
    expect(threw).toBe(true)
  })
})
