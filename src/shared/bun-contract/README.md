# Bun runtime contract suite

Characterization tests that pin the **exact Bun runtime behaviors the agent
hosts + broker depend on**. They mirror real usage sites so that a Bun upgrade
(or a Bun regression) is caught here instead of in production.

Run the whole suite:

```sh
bun test src/shared/bun-contract/
```

| File | Pins | Mirrors |
|---|---|---|
| `pty-spawn.contract.test.ts` | `Bun.spawn({ terminal })` data/write/resize/SIGWINCH/exit | `claude-agent-host/pty-spawn.ts` |
| `headless-stdio.contract.test.ts` | `Bun.spawn` stdin/stdout/stderr pipes + NDJSON | `claude-agent-host/stream-backend.ts`, opencode/acp hosts |
| `fs-watch.contract.test.ts` | `fs.watch` file + directory + bursty behavior | `claude-agent-host/transcript-watcher.ts` (the chokidar workaround) |
| `sqlite.contract.test.ts` | `bun:sqlite` FTS5, `VACUUM INTO`, STRICT tables | `broker/store/sqlite/*`, `broker/backup.ts` |
| `serve-ws.contract.test.ts` | `Bun.serve` ephemeral port + WebSocket upgrade/echo | `broker/index.ts`, `claude-agent-host/local-server.ts` |
| `write-perms.contract.test.ts` | `Bun.write` default 0644 vs `writeSecureFile` 0600 | `claude-agent-host/settings-merge.ts` security wrapper |

## Why `fs-watch` is the important one

`transcript-watcher.ts` ships **chokidar + a 500ms poll** purely to dodge a
Bun macOS `fs.watch` bug (closing a file watcher then watching a new file in
the same dir silently stops events -- which `/clear` and compaction trigger).
Bun 1.3.14 rewrote the `fs.watch` backend. If `fs-watch.contract.test.ts`
passes on 1.3.14, the workaround can be retired (see
`.claude/docs/plan-bun-1314-upgrade.md` Phase 2). If it fails, chokidar stays.
