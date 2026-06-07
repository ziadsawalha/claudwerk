/**
 * Sentinel-local control socket -- the host-side entry point for
 * sentinel-ORIGINATED host shells (plan-shell-sentinel-truth.md, phase 2).
 *
 * The running sentinel daemon listens on a Unix domain socket. A `sentinel shell
 * [path]` invocation (a separate, short-lived process) connects to it and asks
 * the daemon to spawn a host shell at `path`; the daemon spawns the PTY, adds it
 * to its registry, and announces it to the broker (`shell_originated`), so it
 * appears in the control panel. You tmux into the box, run `sentinel shell`, and
 * a terminal shows up in the broker.
 *
 * Framing: newline-delimited JSON, one response per connection (mirrors the
 * cc-daemon control socket, `src/shared/cc-daemon/client.ts`). Transport is
 * `node:net` (not `Bun.*`) so it type-checks under every tsconfig.
 *
 * AUTH: the socket file is the gate. It is created mode 0600 in the per-user XDG
 * config dir, so only the user running the sentinel can connect. There is no
 * network exposure -- a raw `$SHELL` PTY is RCE as the host user, so this MUST
 * stay local + owner-only (mirrors the shell-env scrub rationale in shell-pty.ts).
 */

import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { createConnection, createServer, type Socket } from 'node:net'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Request a host shell at `path` (absolute), or a liveness `ping`. */
export type ShellControlRequest = { op: 'ping' } | { op: 'shell_open'; path: string; title?: string }

/** One-shot response: the minted shellId on success, else a human error. */
export type ShellControlResponse = { ok: true; shellId?: string } | { ok: false; error: string }

/**
 * Resolve the control-socket path: a `control.sock` next to the sentinel config
 * (`~/.config/rclaude/`), honoring `XDG_CONFIG_HOME`. Server + client derive it
 * the same way so they agree without passing it around. (A custom `--config`
 * dir is not reflected here -- v1 assumes the XDG default; documented limitation.)
 */
export function resolveControlSocketPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const xdg = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0 ? env.XDG_CONFIG_HOME : join(home, '.config')
  return join(xdg, 'rclaude', 'control.sock')
}

/** Dependencies the request handler needs from the daemon. Kept as a seam so the
 *  dispatch is unit-testable without a live socket or a real PTY. */
export interface ControlDeps {
  /** Whether `--no-shell` / `CLAUDWERK_NO_SHELL` disabled host shells. */
  shellEnabled: boolean
  /** Spawn a host shell at `path`; returns the minted shellId or throws. */
  openShell: (path: string, title?: string) => string
}

/**
 * Pure dispatch of one control request -> response. No socket, no PTY -- the
 * `openShell` seam does the side effect. Validates input + maps the verb.
 */
export async function handleControlRequest(req: unknown, deps: ControlDeps): Promise<ShellControlResponse> {
  if (!req || typeof req !== 'object') return { ok: false, error: 'malformed request' }
  const op = (req as { op?: unknown }).op
  if (op === 'ping') return { ok: true }
  if (op === 'shell_open') {
    if (!deps.shellEnabled) return { ok: false, error: 'host shells are disabled on this host (--no-shell)' }
    const path = (req as { path?: unknown }).path
    if (typeof path !== 'string' || path.length === 0) return { ok: false, error: 'shell_open requires a path' }
    const rawTitle = (req as { title?: unknown }).title
    const title = typeof rawTitle === 'string' && rawTitle.length > 0 ? rawTitle : undefined
    try {
      return { ok: true, shellId: deps.openShell(path, title) }
    } catch (e) {
      return { ok: false, error: (e as Error).message || String(e) }
    }
  }
  return { ok: false, error: `unknown op: ${String(op)}` }
}

/** Write a response frame + close the connection (one-response-per-connection). */
function writeResponse(sock: Socket, resp: ShellControlResponse): void {
  try {
    sock.write(`${JSON.stringify(resp)}\n`)
    sock.end()
  } catch {}
}

/**
 * Bind the control-socket server. Unlinks a stale socket first, chmods 0600 once
 * listening. Each connection delivers exactly one newline-framed JSON request,
 * gets one response, then closes. Returns a `close()` that stops the server +
 * removes the socket file (call it on sentinel shutdown).
 */
export function startControlSocketServer(
  path: string,
  onRequest: (req: unknown) => Promise<ShellControlResponse>,
  log: (msg: string) => void,
): { close: () => void } {
  if (existsSync(path)) {
    try {
      unlinkSync(path)
    } catch {}
  }
  const server = createServer(sock => {
    let buf = ''
    let handled = false
    sock.on('data', chunk => {
      if (handled) return
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      handled = true
      const line = buf.slice(0, nl)
      let req: unknown
      try {
        req = JSON.parse(line)
      } catch {
        writeResponse(sock, { ok: false, error: 'malformed request (not JSON)' })
        return
      }
      onRequest(req)
        .then(resp => writeResponse(sock, resp))
        .catch(e => writeResponse(sock, { ok: false, error: (e as Error).message || String(e) }))
    })
    sock.on('error', () => {})
  })
  server.on('error', e => log(`[control-socket] server error: ${(e as Error).message}`))
  server.listen(path, () => {
    try {
      chmodSync(path, 0o600)
    } catch {}
    log(`[control-socket] listening at ${path}`)
  })
  return {
    close: () => {
      try {
        server.close()
      } catch {}
      if (existsSync(path)) {
        try {
          unlinkSync(path)
        } catch {}
      }
    },
  }
}

/** Send one request to the running sentinel's control socket + resolve its
 *  response. Opens a fresh connection (one-response-per-connection). Rejects on
 *  connect error (no sentinel running) or timeout. */
export function sendControlRequest(
  path: string,
  req: ShellControlRequest,
  timeoutMs = 8000,
): Promise<ShellControlResponse> {
  return new Promise((resolve, reject) => {
    const sock = createConnection(path)
    let buf = ''
    const timer = setTimeout(() => {
      sock.destroy()
      reject(new Error(`control socket timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    sock.on('connect', () => sock.write(`${JSON.stringify(req)}\n`))
    sock.on('data', chunk => {
      buf += chunk.toString('utf8')
      const nl = buf.indexOf('\n')
      if (nl < 0) return
      clearTimeout(timer)
      try {
        resolve(JSON.parse(buf.slice(0, nl)) as ShellControlResponse)
      } catch (e) {
        reject(e as Error)
      }
      sock.end()
    })
    sock.on('error', e => {
      clearTimeout(timer)
      reject(e)
    })
  })
}

const SHELL_CLI_USAGE =
  'Usage: sentinel shell [path] [--title <text>]\n' +
  '  Spawn a host shell on this machine that shows up in the control panel.\n' +
  '  path     directory to open the shell in (default: current directory)\n' +
  '  --title  display title for the tile (default: directory basename)\n'

/** Parse `[path] [--title <t>]` -- first bare arg is the path, `--title` its value. */
function parseShellCliArgs(args: string[]): { path?: string; title?: string } {
  let path: string | undefined
  let title: string | undefined
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title') title = args[++i]
    else if (path === undefined && !args[i].startsWith('-')) path = args[i]
  }
  return { path, title }
}

/** A connect failure to the socket = no sentinel running; anything else is raw. */
function describeReachError(e: unknown, socketPath: string): string {
  const code = (e as NodeJS.ErrnoException).code
  if (code === 'ENOENT' || code === 'ECONNREFUSED')
    return `no running sentinel found at ${socketPath} (is the sentinel daemon running on this host?)`
  return (e as Error).message || String(e)
}

/**
 * `sentinel shell [path] [--title <t>]` CLI. Asks the RUNNING sentinel daemon to
 * spawn a host shell (default path = cwd), which surfaces in the control panel.
 * Returns a process exit code. Connection-refused = no sentinel running here.
 */
export async function runShellCli(args: string[]): Promise<number> {
  if (args[0] === '--help' || args[0] === '-h') {
    process.stdout.write(SHELL_CLI_USAGE)
    return 0
  }
  const { path, title } = parseShellCliArgs(args)
  const absPath = resolve(path ?? process.cwd())
  const socketPath = resolveControlSocketPath()
  try {
    const resp = await sendControlRequest(socketPath, { op: 'shell_open', path: absPath, title })
    if (resp.ok) {
      process.stdout.write(`Opened host shell ${resp.shellId ?? ''} at ${absPath} -- it's now in the control panel.\n`)
      return 0
    }
    process.stderr.write(`Failed to open host shell: ${resp.error}\n`)
    return 1
  } catch (e) {
    process.stderr.write(`Failed to reach the sentinel: ${describeReachError(e, socketPath)}\n`)
    return 1
  }
}
