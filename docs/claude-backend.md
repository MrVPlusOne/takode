# Claude backend

Takode runs Claude Code through the Agent SDK only: the server starts each Claude
session with [`@anthropic-ai/claude-agent-sdk`](https://code.claude.com/docs/en/agent-sdk/overview),
which owns the `claude` process and talks to it over stdio
(`web/server/claude-sdk-adapter.ts`). The backend type is `claude-sdk`; requests
that name the `claude` family (session creation, `takode spawn --backend claude`,
cron jobs) launch it.

**Which Claude Code runs.** When Settings "Claude binary" is empty, the SDK runs
the Claude Code build bundled with the pinned SDK version (SDK 0.3.289 bundles
Claude Code 2.1.289). A configured "Claude binary" is used instead, and a remote
host runs its own configured binary or the `claude` on its PATH. Upgrading the
SDK therefore upgrades Claude Code for default installs.

Takode used to offer a second Claude backend that started
`claude --sdk-url ws://localhost:<port>/ws/cli/<session>` and let the CLI connect
back over a newline-delimited JSON WebSocket. That backend, its `/ws/cli` route,
the "Default Claude Backend" setting and the per-session transport switch were
removed in October 2026. This page records why, so the decision is not revisited
on stale assumptions.

## Why the native WebSocket backend could not be kept

Two installed Claude Code builds were compared in October 2026:

| | Claude Code 2.1.118 | Claude Code 2.1.289 |
| --- | --- | --- |
| `--sdk-url` host | Any `ws`/`wss` URL, including localhost | Validated against a fixed list of Anthropic hosts (HTTPS/WSS only) before any connection is made; localhost is rejected |
| Transport behind `--sdk-url` | Bidirectional NDJSON over one WebSocket (what Takode spoke) | A remote-worker session protocol: events read as SSE from `/worker/events/stream`, writes through a separate session client |

Either difference alone breaks the old integration, and they are independent:
updating message formats, headers or the URL scheme cannot get past the host
check, and passing the host check would still not give the NDJSON socket. The
CLI's hidden `--sdk-url` help text still mentions WebSockets, but its reachable
startup code is the stronger evidence. The first release that changed this was
not identified, and the comparison does not show that Claude Code removed
WebSocket support in general, only that this local integration no longer works.
Keeping an old binary, or bypassing the host check, would not be a supported way
to run current models.

[WEBSOCKET_PROTOCOL_REVERSED.md](../WEBSOCKET_PROTOCOL_REVERSED.md) documents
the old protocol as observed with CLI 2.1.37 and is kept for history only.

## Transport is not plan eligibility

Running Claude through the SDK does not by itself mean API-key billing or rule
out using a personal Claude plan. These are separate questions:

- [Claude Code authentication](https://code.claude.com/docs/en/authentication)
  supports signing in with a Pro or Max claude.ai account.
- Anthropic's [Agent SDK plan article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
  (dated June 16, 2026, read October 5, 2026) says a proposed change was paused
  and that SDK, `claude -p` and third-party app usage continue to draw from
  subscription limits.
- The [SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)
  separately restricts third-party developers from offering claude.ai login or
  plan rate limits in their products without approval.

How those policies apply to a particular account or deployment is a product and
account question, not something the transport decides. Check the current
official pages before relying on any of this.

## Behavior after the retirement

- **Saved sessions.** Records saved as `claude`, or with no backend type (the
  old default), load as `claude-sdk` and resume the same Claude conversation by
  session ID. Text messages queued for the old CLI are delivered through the SDK.
- **Containers.** Claude sessions run on the host. Creating a Claude session
  with a Docker image is refused, and a saved Claude session that ran in a
  container is not resumed (its history is kept) rather than silently moving
  to the host. Codex sessions can still run in containers.
- **Failed launches.** A Claude session counts as starting until its process
  has spawned. If the process cannot start or ends unexpectedly, the session is
  reported as exited, keeping its Claude session ID so a relaunch resumes the
  same conversation.
- **MCP servers.** Claude sessions show the MCP servers Claude reports at
  startup. Enabling, disabling, reconnecting or adding servers from Takode is
  only available for Codex.
- **Revert.** Reverting to an earlier message relaunches Claude with
  `--resume-session-at`, so Claude's own context is truncated as well as the feed.
- **Permissions.** Takode owns the permission mode. "Always allow" choices are
  passed to Claude as permission updates, and a long `sleep` run in bypass mode
  (where Claude does not ask first) is interrupted with the timer reminder.
- **Network outages.** When Claude cannot reach the model API (no internet,
  DNS failure, refused or dropped connection, timeout), the turn is paused
  rather than failed. Claude retries on its own first; when it gives up, Takode
  keeps the error out of the feed and herd events, shows the turn as "Waiting
  for connection", and sends Claude a hidden prompt to continue once the
  network is back (retrying after 10, 30, then every 60 seconds). Takode
  launches Claude with `CLAUDE_CODE_MAX_RETRIES=15`, Claude Code's own maximum
  (about 6 minutes of in-turn retries instead of the default 3), unless the
  environment already sets it, so most outages end inside the original turn.
  At most 5 hidden continues are sent per outage; after that the turn keeps
  waiting until a new message arrives or the machine drops off and rejoins a
  network, which allows another 5. Errors that
  got an HTTP response (authentication, quota, invalid requests), SSL failures
  and proxy-tunnel refusals stay visible. Raw errors go to the server log.
  Codex network failures use Codex's own outage recovery.
