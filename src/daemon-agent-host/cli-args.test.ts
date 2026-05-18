/**
 * Tier 1 unit tests for `cli-args` -- daemon-agent-host env-var resolution.
 * Covers the CLAUDWERK_ >> RCLAUDE_ precedence covenant and the defaults.
 * The missing-required-var paths call `process.exit(1)` and are not unit-tested
 * here (they are two trivial guard clauses).
 */
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { parseDaemonHostConfig } from './cli-args'

/** Env keys this module reads -- saved + restored around every test. */
const KEYS = [
  'CLAUDWERK_BROKER',
  'RCLAUDE_BROKER',
  'CLAUDWERK_SECRET',
  'RCLAUDE_SECRET',
  'RCLAUDE_CONVERSATION_ID',
  'CLAUDWERK_DAEMON_SHORT',
  'RCLAUDE_CWD',
]

let saved: Record<string, string | undefined>

beforeEach(() => {
  saved = {}
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  // The two required vars -- set so the happy path does not exit().
  process.env.RCLAUDE_CONVERSATION_ID = 'conv_test'
  process.env.CLAUDWERK_DAEMON_SHORT = 'aaaa1111'
})

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

test('CLAUDWERK_ prefix wins over the RCLAUDE_ fallback', () => {
  process.env.CLAUDWERK_BROKER = 'ws://canonical:1'
  process.env.RCLAUDE_BROKER = 'ws://legacy:2'
  process.env.CLAUDWERK_SECRET = 'canonical-secret'
  process.env.RCLAUDE_SECRET = 'legacy-secret'
  const cfg = parseDaemonHostConfig()
  expect(cfg.brokerUrl).toBe('ws://canonical:1')
  expect(cfg.brokerSecret).toBe('canonical-secret')
})

test('falls back to the RCLAUDE_ prefix when CLAUDWERK_ is unset', () => {
  process.env.RCLAUDE_BROKER = 'ws://legacy:2'
  process.env.RCLAUDE_SECRET = 'legacy-secret'
  const cfg = parseDaemonHostConfig()
  expect(cfg.brokerUrl).toBe('ws://legacy:2')
  expect(cfg.brokerSecret).toBe('legacy-secret')
})

test('brokerUrl defaults when neither prefix is set; secret may be undefined', () => {
  const cfg = parseDaemonHostConfig()
  expect(cfg.brokerUrl).toBe('ws://localhost:9999')
  expect(cfg.brokerSecret).toBeUndefined()
})

test('carries the required conversationId + daemonShort through', () => {
  const cfg = parseDaemonHostConfig()
  expect(cfg.conversationId).toBe('conv_test')
  expect(cfg.daemonShort).toBe('aaaa1111')
})

test('cwd uses RCLAUDE_CWD when set, else process.cwd()', () => {
  process.env.RCLAUDE_CWD = '/tmp/worker-cwd'
  expect(parseDaemonHostConfig().cwd).toBe('/tmp/worker-cwd')
  delete process.env.RCLAUDE_CWD
  expect(parseDaemonHostConfig().cwd).toBe(process.cwd())
})
