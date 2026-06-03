import { describe, expect, test } from 'bun:test'
import { SHELL_DATA_WS_FLAG, SHELL_DATA_WS_SENTINEL } from '../shared/protocol'
import { buildShellDataWsUrl } from './shell-data-ws'

describe('buildShellDataWsUrl', () => {
  test('tags the dedicated data socket with secret + flag + sentinel id', () => {
    const url = new URL(buildShellDataWsUrl('ws://localhost:9999', 'sekret', 'mach-abc'))
    expect(url.protocol).toBe('ws:')
    expect(url.host).toBe('localhost:9999')
    expect(url.searchParams.get('secret')).toBe('sekret')
    expect(url.searchParams.get(SHELL_DATA_WS_FLAG)).toBe('1')
    expect(url.searchParams.get(SHELL_DATA_WS_SENTINEL)).toBe('mach-abc')
  })

  test('omits secret when empty, preserves wss + path', () => {
    const url = new URL(buildShellDataWsUrl('wss://broker.example/ws', '', 'm1'))
    expect(url.protocol).toBe('wss:')
    expect(url.pathname).toBe('/ws')
    expect(url.searchParams.has('secret')).toBe(false)
    expect(url.searchParams.get(SHELL_DATA_WS_SENTINEL)).toBe('m1')
  })
})
