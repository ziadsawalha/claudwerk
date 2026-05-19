import { describe, expect, it } from 'bun:test'
import type { DaemonResponse } from '../shared/cc-daemon/types'
import {
  buildDaemonDispatchArgs,
  daemonJobName,
  evaluateAttachPresence,
  mergeDaemonWorkerEnv,
  modeDispatchesWorker,
  parseDaemonShort,
  validateDaemonConfigPaths,
} from './daemon-dispatch'

/** ANSI ESC -- built via charCode so no literal control byte lands in source. */
const ESC = String.fromCharCode(27)

describe('buildDaemonDispatchArgs -- NEW mode', () => {
  it('assembles a bare new dispatch as `claude --bg <prompt>`', () => {
    expect(buildDaemonDispatchArgs({ mode: 'new', prompt: 'do the thing' })).toEqual(['claude', '--bg', 'do the thing'])
  })

  it('injects --model/--name/--settings/--mcp-config/--append-system-prompt in order, prompt last', () => {
    expect(
      buildDaemonDispatchArgs({
        mode: 'new',
        prompt: 'go',
        model: 'claude-haiku-4-5-20251001',
        name: 'My Conv',
        settingsPath: '/abs/settings.json',
        mcpConfigPath: '/abs/mcp.json',
        appendSystemPrompt: 'reply PROBE-OK',
      }),
    ).toEqual([
      'claude',
      '--bg',
      '--model',
      'claude-haiku-4-5-20251001',
      '--name',
      'cw-My-Conv',
      '--settings',
      '/abs/settings.json',
      '--mcp-config',
      '/abs/mcp.json',
      '--append-system-prompt',
      'reply PROBE-OK',
      'go',
    ])
  })

  it('omits flags that are not supplied', () => {
    expect(buildDaemonDispatchArgs({ mode: 'new', prompt: 'go', model: 'm' })).toEqual([
      'claude',
      '--bg',
      '--model',
      'm',
      'go',
    ])
  })
})

describe('buildDaemonDispatchArgs -- RESUME mode', () => {
  it('emits `--resume <sessionId>` before the other flags', () => {
    expect(
      buildDaemonDispatchArgs({ mode: 'resume', resumeSessionId: '27dc07b0-cafe', model: 'm', prompt: 'next turn' }),
    ).toEqual(['claude', '--bg', '--resume', '27dc07b0-cafe', '--model', 'm', 'next turn'])
  })

  it('treats the prompt as optional -- a resume without a prompt drops the trailing positional', () => {
    expect(buildDaemonDispatchArgs({ mode: 'resume', resumeSessionId: 'sess-1' })).toEqual([
      'claude',
      '--bg',
      '--resume',
      'sess-1',
    ])
  })

  it('treats a whitespace-only prompt as absent (resume)', () => {
    expect(buildDaemonDispatchArgs({ mode: 'resume', resumeSessionId: 'sess-1', prompt: '   ' })).toEqual([
      'claude',
      '--bg',
      '--resume',
      'sess-1',
    ])
  })

  it('throws when resume mode has no resumeSessionId', () => {
    expect(() => buildDaemonDispatchArgs({ mode: 'resume', prompt: 'x' })).toThrow(/resume mode requires/)
  })
})

describe('daemonJobName', () => {
  it('prefixes cw- and collapses non-alphanumeric runs to a single hyphen', () => {
    expect(daemonJobName('My Conv / test!!')).toBe('cw-My-Conv-test-')
  })

  it('caps the slug at 40 chars', () => {
    expect(daemonJobName('a'.repeat(100)).length).toBe(43) // 'cw-' + 40
  })
})

describe('parseDaemonShort', () => {
  it('captures the 8-hex short from a `backgrounded` line', () => {
    expect(parseDaemonShort('backgrounded - aeb185f9')).toBe('aeb185f9')
  })

  it('strips ANSI SGR colour codes around the separator and captures the bare short', () => {
    // claude --bg styles the `-` separator; the 8-hex short id is printed bare.
    const line = `backgrounded ${ESC}[2m-${ESC}[22m 9647c9a0`
    expect(parseDaemonShort(line)).toBe('9647c9a0')
  })

  it('returns null when no short id is present', () => {
    expect(parseDaemonShort('error: claude --bg failed')).toBeNull()
  })
})

describe('mergeDaemonWorkerEnv', () => {
  it('merges per-spawn env over the base env', () => {
    expect(mergeDaemonWorkerEnv({ A: '1' }, { B: '2' })).toEqual({ A: '1', B: '2' })
  })

  it('lets per-spawn env override a base key', () => {
    expect(mergeDaemonWorkerEnv({ A: '1' }, { A: '2' })).toEqual({ A: '2' })
  })

  it('returns a copy of the base when no extra env is supplied', () => {
    const base = { A: '1' }
    const merged = mergeDaemonWorkerEnv(base)
    expect(merged).toEqual({ A: '1' })
    expect(merged).not.toBe(base)
  })
})

describe('validateDaemonConfigPaths', () => {
  const allMissing = () => false
  const allPresent = () => true

  it('passes when no paths are supplied', () => {
    expect(validateDaemonConfigPaths({}, allMissing).ok).toBe(true)
  })

  it('passes when supplied paths exist', () => {
    const check = validateDaemonConfigPaths({ settingsPath: '/s.json', mcpConfigPath: '/m.json' }, allPresent)
    expect(check.ok).toBe(true)
  })

  it('fails with a clear message when --settings is missing', () => {
    const check = validateDaemonConfigPaths({ settingsPath: '/nope.json' }, allMissing)
    expect(check.ok).toBe(false)
    expect(check.error).toContain('/nope.json')
  })

  it('fails when --mcp-config is missing', () => {
    const check = validateDaemonConfigPaths({ mcpConfigPath: '/nope.json' }, p => p !== '/nope.json')
    expect(check.ok).toBe(false)
    expect(check.error).toContain('mcp-config')
  })
})

describe('evaluateAttachPresence -- ATTACH short-circuit gate', () => {
  it('passes when the worker is present', () => {
    const resp = { ok: true, op: 'has', present: true, alive: true } as unknown as DaemonResponse
    expect(evaluateAttachPresence(resp, 'aeb185f9').ok).toBe(true)
  })

  it('fails when the worker is not present in the roster', () => {
    const resp = { ok: true, op: 'has', present: false, alive: false } as unknown as DaemonResponse
    const check = evaluateAttachPresence(resp, 'aeb185f9')
    expect(check.ok).toBe(false)
    expect(check.error).toContain('aeb185f9')
  })

  it('fails when the daemon `has` op returned an error', () => {
    const resp: DaemonResponse = { ok: false, error: 'no such job', code: 'ENOJOB' }
    const check = evaluateAttachPresence(resp, 'deadbeef')
    expect(check.ok).toBe(false)
    expect(check.error).toContain('ENOJOB')
  })
})

describe('modeDispatchesWorker -- which modes run claude --bg', () => {
  it('NEW and RESUME dispatch a worker', () => {
    expect(modeDispatchesWorker('new')).toBe(true)
    expect(modeDispatchesWorker('resume')).toBe(true)
  })

  it('ATTACH does not dispatch -- it short-circuits to the roster short', () => {
    expect(modeDispatchesWorker('attach')).toBe(false)
  })
})
