/**
 * Tests for the `sentinel profile` CLI's pure pieces: list / add / rm / pool.
 * The `auth` subcommand shells out to `claude auth login`, which is not
 * exercised here -- the smoke script covers env propagation separately.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProfileCli } from './profile-cli'

let scratch = ''
let configPath = ''

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'profile-cli-'))
  configPath = join(scratch, 'sentinel.json')
})
afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('sentinel profile list', () => {
  test('handles missing file (prints implicit default)', async () => {
    const code = await runProfileCli(['list'], { configPath })
    expect(code).toBe(0)
  })

  test('reads an existing file', async () => {
    writeFileSync(configPath, JSON.stringify({ profiles: { work: { configDir: join(scratch, 'cd-work') } } }))
    const code = await runProfileCli(['list'], { configPath })
    expect(code).toBe(0)
  })
})

describe('sentinel profile add', () => {
  test('creates a profile in a fresh file (omitted pool defaults to "default")', async () => {
    const code = await runProfileCli(['add', 'work', '--config-dir', join(scratch, 'cd-work'), '--label', 'Work'], {
      configPath,
    })
    expect(code).toBe(0)
    expect(existsSync(configPath)).toBe(true)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.profiles.work.configDir).toBe(join(scratch, 'cd-work'))
    expect(written.profiles.work.label).toBe('Work')
    // pool not written when omitted; loader synthesises "default".
    expect(written.profiles.work.pool).toBeUndefined()
  })

  test('creates a profile with --pool <name>', async () => {
    const code = await runProfileCli(['add', 'work-1', '--config-dir', join(scratch, 'cd-w1'), '--pool', 'work'], {
      configPath,
    })
    expect(code).toBe(0)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.profiles['work-1'].pool).toBe('work')
  })

  test('creates a profile with --no-pool (excluded)', async () => {
    const code = await runProfileCli(['add', 'priv', '--config-dir', join(scratch, 'cd-priv'), '--no-pool'], {
      configPath,
    })
    expect(code).toBe(0)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.profiles.priv.pool).toBeNull()
  })

  test('rejects --pool together with --no-pool', async () => {
    const code = await runProfileCli(
      ['add', 'mix', '--config-dir', join(scratch, 'cd-mix'), '--pool', 'work', '--no-pool'],
      { configPath },
    )
    expect(code).toBe(2)
  })

  test('rejects bad pool name', async () => {
    const code = await runProfileCli(['add', 'work', '--config-dir', join(scratch, 'cd-w'), '--pool', 'Bad Pool'], {
      configPath,
    })
    expect(code).toBe(2)
  })

  test('rejects duplicate add', async () => {
    await runProfileCli(['add', 'work', '--config-dir', '/x'], { configPath })
    const code = await runProfileCli(['add', 'work', '--config-dir', '/y'], { configPath })
    expect(code).toBe(1)
  })

  test('rejects bad profile name', async () => {
    const code = await runProfileCli(['add', 'Bad Name', '--config-dir', '/x'], { configPath })
    expect(code).toBe(2)
  })

  test('rejects missing --config-dir', async () => {
    const code = await runProfileCli(['add', 'work'], { configPath })
    expect(code).toBe(2)
  })
})

describe('sentinel profile rm', () => {
  test('removes an existing profile', async () => {
    writeFileSync(configPath, JSON.stringify({ profiles: { work: { configDir: join(scratch, 'cd-work') } } }))
    const code = await runProfileCli(['rm', 'work'], { configPath })
    expect(code).toBe(0)
    const written = JSON.parse(readFileSync(configPath, 'utf8'))
    expect(written.profiles).toEqual({})
  })

  test('refuses to remove default', async () => {
    const code = await runProfileCli(['rm', 'default'], { configPath })
    expect(code).toBe(2)
  })

  test('reports unknown profile', async () => {
    writeFileSync(configPath, '{}')
    const code = await runProfileCli(['rm', 'no-such'], { configPath })
    expect(code).toBe(1)
  })
})

describe('sentinel profile pool', () => {
  test('--set moves a profile to a named pool', async () => {
    writeFileSync(configPath, JSON.stringify({ profiles: { work: { configDir: join(scratch, 'cd-work') } } }))
    const code = await runProfileCli(['pool', 'work', '--set', 'alt'], { configPath })
    expect(code).toBe(0)
    expect(JSON.parse(readFileSync(configPath, 'utf8')).profiles.work.pool).toBe('alt')
  })

  test('--none excludes a profile from every pool', async () => {
    writeFileSync(
      configPath,
      JSON.stringify({ profiles: { work: { configDir: join(scratch, 'cd-work'), pool: 'work' } } }),
    )
    const code = await runProfileCli(['pool', 'work', '--none'], { configPath })
    expect(code).toBe(0)
    expect(JSON.parse(readFileSync(configPath, 'utf8')).profiles.work.pool).toBeNull()
  })

  test('rejects missing --set / --none', async () => {
    writeFileSync(configPath, JSON.stringify({ profiles: { work: { configDir: join(scratch, 'cd-work') } } }))
    const code = await runProfileCli(['pool', 'work'], { configPath })
    expect(code).toBe(2)
  })

  test('rejects --set without a pool name', async () => {
    writeFileSync(configPath, JSON.stringify({ profiles: { work: { configDir: join(scratch, 'cd-work') } } }))
    const code = await runProfileCli(['pool', 'work', '--set'], { configPath })
    expect(code).toBe(2)
  })

  test('rejects --set with a bad pool name', async () => {
    writeFileSync(configPath, JSON.stringify({ profiles: { work: { configDir: join(scratch, 'cd-work') } } }))
    const code = await runProfileCli(['pool', 'work', '--set', 'Bad Pool'], { configPath })
    expect(code).toBe(2)
  })

  test('reports unknown profile', async () => {
    const code = await runProfileCli(['pool', 'no-such', '--set', 'work'], { configPath })
    expect(code).toBe(1)
  })
})

describe('sentinel profile -- unknown subcommand + help', () => {
  test('--help exits 0', async () => {
    expect(await runProfileCli(['--help'])).toBe(0)
    expect(await runProfileCli([])).toBe(0)
  })

  test('unknown subcommand exits 2', async () => {
    expect(await runProfileCli(['frob'], { configPath })).toBe(2)
  })
})
