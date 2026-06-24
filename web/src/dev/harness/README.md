# Dev component harness

Mount **one** component against the **real broker**, as an impersonated user, with
no full app shell and no auth UI. This is the tool that makes a dead client-side
component visible: it surfaces the throws the real app swallows.

> Built because the dispatch overlay was dead client-side (a `submit()` threw
> before any `dispatch_request` reached the broker, and the throw vanished with
> no `lastError`). There was no way to mount that one piece and drive it. Now
> there is.

## How it works

```
/dev/harness?mount=<id>&key=<devToken>
```

1. The route is **dev-only**: it's behind `import.meta.env.DEV`, wrapped so Vite
   dead-code-eliminates the route AND its chunk out of production builds. It
   cannot exist in a prod bundle.
2. The `key` (a `dvk_` dev token, minted by `broker-cli mint-dev-key`) is injected
   as the `cw-session` cookie **before** the WebSocket handshake. The broker then
   authenticates the socket AS the impersonated user -- but **only** when the
   broker has `DEV_HARNESS_ENABLED=1`. A prod broker (flag off) rejects the token.
3. `mount=<id>` resolves in the registry (`mount-registry.ts`) and that one
   component is rendered inside an **error surface** -- a React error boundary +
   `window` error/unhandledrejection listeners that render every captured failure
   in a loud banner.

## Run it locally

Against a throwaway/staging broker -- **never** the prod broker.

```bash
# 1. Boot a throwaway broker with the flag on (fresh cache dir, not prod's)
DEV_HARNESS_ENABLED=1 bun run src/broker/index.ts --cache-dir /tmp/harness --port 9347

# 2. Mint an impersonation key (docker-exec / CLI only -- never an HTTP route)
DEV_HARNESS_ENABLED=1 bun run src/broker/cli.ts mint-dev-key --as jonas --cache-dir /tmp/harness
#   -> prints a dvk_... token + the ready-to-open /dev/harness URL

# 3. Start the web dev server (vite proxies /ws + /api to the broker)
cd web && bun run dev

# 4. Open the printed URL, e.g.
#    http://localhost:3456/dev/harness?mount=dispatch-overlay&key=dvk_...
```

## Add a new mount

One line in `mount-registry.ts`:

```ts
export const MOUNTS: Record<string, MountDef> = {
  'dispatch-overlay': { label: 'Dispatch overlay', Component: lazy(() => import('./mounts/dispatch-overlay-mount')) },
  'my-thing':         { label: 'My thing',         Component: lazy(() => import('./mounts/my-thing-mount')) },
}
```

A mount is a tiny default-export component that renders the target and does any
setup it needs (the dispatch mount opens the overlay on mount). Then open
`/dev/harness?mount=my-thing&key=...`.

## One-command smoke

```bash
bun run harness:smoke
```

Boots a throwaway broker and proves the dev-key path end-to-end: mint -> the key
authenticates as the user (flag on), a tampered token is rejected, and the SAME
valid token is rejected with the flag off (prod safety). Browserless; the
component-mount + error-surface behaviour is covered by the web tests
(`error-surface.test.tsx`, `dispatch-store.test.ts`).

## Security

- The signing secret is broker-internal (the session HMAC secret, or
  `DEV_HARNESS_SIGNING_SECRET`); it is never shipped to the client or logged.
- Minting is **only** `broker-cli mint-dev-key` (docker-exec), never an HTTP/WS
  route.
- `DEV_HARNESS_ENABLED` defaults **off**. With it off, minting refuses and the
  broker rejects every dev token -- so even a leaked secret can't impersonate prod.
- Every mint and every dev-token auth is logged (`[dev-harness] ...`), greppable.
