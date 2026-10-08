# Browser login

Takode can require a password before a browser may use it. Turn it on before making a server reachable from other machines, for example through Tailscale, a relay tunnel or a coordinator that remote hosts connect to.

## Turning it on

Open **Settings > System > Login**, enter a password twice and choose **Turn on login**. Every other browser is signed out at once and sees the login screen. The same section changes the password, signs out other devices, logs this browser out and turns login off; changing the password or turning login off needs the current password.

Login is off by default. While it is off, anyone who can reach the server can use it, as before.

## What it protects

- **Protected:** every `/api`, `/ws` and `/file-preview` request.
- **Public:** the static frontend, so it can show the login screen, and `/api/auth/status`, `/api/auth/login`, `/api/auth/logout`, `/api/health` and `/api/ready`.
- **Their own credentials:** agent CLIs (`takode`, `quest`, `memory`) send their per-session token, including through a remote host's `takode node` proxy. Hosts connect with their host token, and the Codex sidecar routes accept only loopback callers that hold the sidecar capability.

Connections from `127.0.0.1` are not exempt. Tunnels, reverse proxies, `tailscale serve` and the Vite dev proxy all deliver outside traffic from loopback, so trusting it would leave exactly the exposed paths open. A browser on the same machine logs in once like any other.

## How it works

- The server keeps a scrypt hash of the password and a cookie-signing secret in `~/.companion/browser-login/<server ID>.json` (mode 0600), not in `settings.json`.
- A login sets an HttpOnly, `SameSite=Lax` cookie, marked Secure over HTTPS (directly or through a proxy that sends `X-Forwarded-Proto: https`). The cookie holds its issue time and an HMAC of it, lasts 30 days and is renewed when the app loads after a day. The cookie name includes the server ID because browsers share cookies across ports on one host.
- Changing the password or signing out other devices replaces the secret, which invalidates every existing cookie, and closes open browser and terminal WebSockets so those browsers must log in again.
- Ten wrong passwords within 15 minutes pause login attempts until the oldest failure is 15 minutes old. Browsers that are already logged in keep working.

## Forgotten password

Stop the server, delete this server's file in `~/.companion/browser-login`, and start the server again. Login is then off.

## Limits

- One password for the server; there are no separate user accounts.
- The VS Code panel prototype embeds Takode in a cross-site frame, which does not receive the login cookie, so it cannot be used while login is on.
- `takode` and `quest` commands run from a plain terminal, outside any Takode session, have no session token and are refused while login is on. Quest reads fall back to the local store.
