# `web/server/`

Backend runtime for The Companion (Bun + Hono + WebSocket bridge).

This directory contains the server process that:
- Starts HTTP + WebSocket endpoints
- Launches backend agent processes (Claude CLI, Codex, Claude SDK)
- Bridges protocol messages between agent backends and browser clients
- Persists session and quest state
- Exposes REST APIs consumed by the frontend and CLI tools

## Core flow

1. [index.ts](./index.ts) boots the server and wires dependencies.
2. [routes/index.ts](./routes/index.ts) mounts REST API modules.
3. [ws-bridge.ts](./ws-bridge.ts) is the real-time session/message router.
4. [cli-launcher.ts](./cli-launcher.ts) starts/stops/relaunches backend sessions.
5. Browser clients connect over `/ws/browser/:sessionId`; backend agents connect over backend-specific channels.

## Key files

- [index.ts](./index.ts)
  - Server bootstrap, dependency wiring, WebSocket upgrade handling.
- [ws-bridge.ts](./ws-bridge.ts)
  - Session-level state machine and WebSocket message router.
  - Broadcast/replay, permission handling, orchestration event emission.
- [session-types.ts](./session-types.ts)
  - Shared protocol and state types used by server + frontend.
- [cli-launcher.ts](./cli-launcher.ts)
  - Backend process lifecycle management, relaunch logic, worktree setup.
- [session-store.ts](./session-store.ts)
  - Persistent storage for session snapshots/history metadata.
- [routes/](./routes/)
  - REST endpoints, organized by domain modules.
- [bridge/](./bridge/)
  - Extracted ws-bridge subsystems (permission pipeline, generation lifecycle, adapter contract).
- [codex-adapter.ts](./codex-adapter.ts)
  - Codex JSON-RPC adapter to/from bridge message model.
- [claude-sdk-adapter.ts](./claude-sdk-adapter.ts)
  - Claude SDK adapter to/from bridge message model.

## Supporting subsystems

- Orchestration and Takode: `takode-*.ts`, [herd-event-dispatcher.ts](./herd-event-dispatcher.ts), [session-tag.ts](./session-tag.ts)
- Questmaster: `quest-*.ts`, [quest-integration.ts](./quest-integration.ts)
- Transcription: [transcription.ts](./transcription.ts), [transcription-enhancer.ts](./transcription-enhancer.ts)
- Infra/utilities: [recorder.ts](./recorder.ts), [replay.ts](./replay.ts), [server-logger.ts](./server-logger.ts), [usage-limits.ts](./usage-limits.ts), [perf-tracer.ts](./perf-tracer.ts), [git-utils.ts](./git-utils.ts)

## How pieces fit together

- Types in `session-types.ts` define the contract.
- Adapters normalize backend-specific protocols into bridge events.
- `ws-bridge.ts` applies session logic and emits authoritative browser events.
- Route modules in `routes/` expose control/query APIs over HTTP.
- Stores/managers persist data and handle long-lived background concerns.

## Testing pattern

Most modules have colocated `*.test.ts` files in this directory.
Protocol/architecture guard tests are also here (for drift and sync-I/O constraints).

