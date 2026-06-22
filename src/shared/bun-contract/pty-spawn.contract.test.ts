/**
 * CONTRACT: Bun.spawn({ terminal }) PTY behavior.
 *
 * Mirrors claude-agent-host/pty-spawn.ts, which spawns `claude` under a PTY and
 * relies on: the `terminal.data(_t, bytes)` callback for output, `terminal.write()`
 * for input, `terminal.resize()` delivering SIGWINCH to the child, and onExit /
 * proc.exited carrying the exit code.
 */

import { describe, expect, test } from 'bun:test'
import { waitFor } from './_helpers'

// A tiny PTY-aware child: reports its window size, echoes a marker, repaints on
// SIGWINCH, and exits with a known code. Kept quote-free internally (string
// concat, no backticks) so it embeds cleanly.
const CHILD = [
  'const sz = () => process.stdout.columns + "x" + process.stdout.rows;',
  'process.stdout.write("READY " + sz() + "\\n");',
  'process.on("SIGWINCH", () => process.stdout.write("WINCH " + sz() + "\\n"));',
  'process.stdin.on("data", (d) => {',
  '  const s = d.toString();',
  '  if (s.includes("PING")) process.stdout.write("PONG\\n");',
  '  if (s.includes("QUIT")) process.exit(7);',
  '});',
].join('\n')

describe('Bun.spawn PTY contract', () => {
  test('terminal callback, write, resize/SIGWINCH, and exit code', async () => {
    let out = ''
    let exitFromCallback: number | null | undefined
    const dec = new TextDecoder('utf-8', { fatal: false })

    const proc = Bun.spawn(['bun', '-e', CHILD], {
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal: {
        cols: 90,
        rows: 30,
        data(_t, bytes) {
          out += dec.decode(bytes, { stream: true })
        },
      },
      onExit(_p, code) {
        exitFromCallback = code
      },
    })

    // 1) data callback fires with the child's startup line, reflecting our cols/rows.
    await waitFor(() => out.includes('READY 90x30'), { label: 'READY 90x30' })

    // 2) terminal.write() reaches the child's stdin; it answers PONG.
    proc.terminal?.write('PING\n')
    await waitFor(() => out.includes('PONG'), { label: 'PONG' })

    // 3) terminal.resize() delivers a real SIGWINCH with the new window size.
    proc.terminal?.resize(120, 40)
    await waitFor(() => out.includes('WINCH 120x40'), { label: 'WINCH 120x40' })

    // 4) exit code propagates via proc.exited AND the onExit callback.
    // (onExit can land a tick after proc.exited resolves -- wait for it.)
    proc.terminal?.write('QUIT\n')
    const code = await proc.exited
    expect(code).toBe(7)
    await waitFor(() => exitFromCallback !== undefined, { label: 'onExit callback' })
    expect(exitFromCallback).toBe(7)
  })

  test('proc.kill(signal) terminates the child', async () => {
    const proc = Bun.spawn(['bun', '-e', 'setInterval(() => {}, 1000)'], {
      terminal: { cols: 80, rows: 24, data() {} },
    })
    proc.kill('SIGTERM')
    const code = await proc.exited
    // Killed by signal -> non-zero exit (Bun surfaces 143 / signal-mapped code).
    expect(code).not.toBe(0)
  })
})
