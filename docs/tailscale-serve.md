# Tailscale HTTPS for Prod + Dev

Use [`scripts/tailscale-serve.sh`](file:/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-2726/scripts/tailscale-serve.sh) to expose Takode over Tailscale HTTPS.

## Recommended setup

- Production on the default `https://<node>.ts.net/` endpoint
- Development on the same hostname at `https://<node>.ts.net:8443/`

That keeps both environments available at the same time while preserving the same trusted `ts.net` hostname on the phone.

Example:

```bash
./scripts/tailscale-serve.sh both
```

Dry-run without changing serve state:

```bash
./scripts/tailscale-serve.sh --dry-run both
```

## Why not `https://<host>/dev`?

The current app is root-based, not path-prefix-safe.

Concrete blockers in the current repo:

- [`web/index.html`](file:/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-2726/web/index.html) loads root-relative assets like `/src/main.tsx`
- Production builds emit root-relative `/assets/...` URLs
- [`web/src/api.ts`](file:/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-2726/web/src/api.ts) calls `/api/...`
- [`web/src/ws-transport.ts`](file:/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-2726/web/src/ws-transport.ts) connects to `/ws/browser/...`
- [`web/src/terminal-ws.ts`](file:/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-2726/web/src/terminal-ws.ts) connects to `/ws/terminal/...`
- [`web/src/components/MessageBubble.tsx`](file:/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-2726/web/src/components/MessageBubble.tsx) loads `/api/images/...`
- [`web/vite.config.ts`](file:/home/jiayiwei/.companion/worktrees/companion/jiayi-wt-2726/web/vite.config.ts) proxies `/api` and `/ws` at the root

If the dev UI were mounted at `/dev`, those absolute URLs would still target `/api`, `/ws`, `/assets`, and `/src` at the root of the hostname instead of `/dev/...`. That would break normal API traffic, browser WebSockets, terminal WebSockets, image fetches, and Vite asset/HMR loading.

## Operational notes

- `prod` mode maps HTTPS `:443` to the production server, default local port `3456`
- `dev` mode maps HTTPS `:443` to the Vite dev server, default local port `5174`
- `both` mode keeps prod on `:443` and exposes dev on `:8443`
- Override ports with:
  - `COMPANION_PORT`
  - `COMPANION_DEV_PORT`
  - `COMPANION_TAILSCALE_PROD_HTTPS_PORT`
  - `COMPANION_TAILSCALE_DEV_HTTPS_PORT`

## Verification notes

This design was chosen after checking both the app and current Tailscale Serve behavior:

- Tailscale Serve supports alternate HTTPS ports on the same `ts.net` hostname
- The app currently derives WebSocket origins from `location.host`, so separate HTTPS ports remain safe
- The app does not currently support a `/dev` path base without a broader frontend and Vite refactor
