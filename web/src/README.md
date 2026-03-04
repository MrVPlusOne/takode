# `web/src`

Frontend source for the Takode React app.

This directory is the browser-side application: routing, UI state, WebSocket client,
REST client, and page/component composition.

## What lives here

- App shell and routing entrypoints
- Zustand application state store
- Browser WebSocket transport and message handlers
- REST API client
- Frontend type layer shared with server types
- Cross-cutting styles and test setup

## Key files

- `main.tsx`
  - React bootstrap, global error boundary wiring, global UI crash hooks.
- `App.tsx`
  - Top-level app composition and hash-route switching.
  - Coordinates page layout (`Sidebar`, `ChatView`, `TaskPanel`, settings/pages).
- `store.ts`
  - Central Zustand store for per-session and global frontend state.
  - Includes actions used by components and WebSocket handlers.
- `ws.ts`
  - Public WebSocket client surface (`connectSession`, `sendToSession`, etc.).
  - Composes `ws-transport.ts` and `ws-handlers.ts`.
- `ws-transport.ts`
  - Socket lifecycle, reconnect/backoff, heartbeat, sequence ACK/replay handling.
- `ws-handlers.ts`
  - Message-type-specific handling that mutates `store.ts` from incoming events.
- `api.ts`
  - Typed fetch helpers and REST endpoint wrappers.
- `types.ts`
  - Re-exports server types and defines frontend-only view types.
- `index.css`
  - Global app styles and theme primitives.

## How pieces fit together

1. `main.tsx` renders `App`.
2. `App.tsx` parses hash routes and mounts page-level components.
3. UI reads/writes state through `store.ts` selectors/actions.
4. `ws.ts` maintains per-session browser sockets and dispatches incoming data.
5. `ws-handlers.ts` normalizes incoming events and updates store maps.
6. `api.ts` handles non-streaming actions (session CRUD, settings, filesystem, etc.).

## Directory relationships

- `components/` contains all rendered UI.
- `hooks/` contains reusable stateful logic used by components.
- `utils/` contains pure helpers (routing, display formatting, adapters, local persistence helpers).

## Testing pattern

- Frontend unit/integration tests are colocated as `*.test.ts` / `*.test.tsx`.
- `test-setup.ts` provides shared test environment setup.
