# `web/src/components`

React UI components for chat, sessions, settings, and utility pages.

This directory contains most of the visible application surface. Components are
primarily organized by feature area rather than strict design-system layering.

## What this directory contains

- Session workspace shell and navigation
- Chat/message rendering stack
- Task/diff/context side panels
- Session creation and management UI
- Settings, env manager, cron manager, terminal, quest pages
- Shared interaction primitives (menus, chips, collapsibles, lightbox, buttons)

## Key components by area

### Shell and workspace

- `Sidebar.tsx` / `SessionItem.tsx` / `ProjectGroup.tsx`
  - Session list rendering, grouping, ordering, and per-session affordances.
- `TopBar.tsx`
  - Active session metadata and top-level session actions.
- `ChatView.tsx`
  - Main center-pane composition for a selected session.
- `TaskPanel.tsx` and `DiffPanel.tsx`
  - Right-side contextual panes.

### Chat rendering stack

- `MessageFeed.tsx`
  - Turn-level feed rendering, grouping/collapse wiring, scroll behavior.
- `MessageBubble.tsx`
  - User/assistant/system message bubble rendering.
- `ToolBlock.tsx`
  - Tool call details, previews, and expandable output.
- `MarkdownContent.tsx`
  - Markdown rendering and custom link handling (`quest:`, `session:`, `file:`).
- `PermissionBanner.tsx`
  - Inline approval UI for tool permission requests.

### Session flows and pages

- `NewSessionModal.tsx` / `SessionCreationView.tsx` / `SessionCreationProgress.tsx`
  - New session flow and progress states.
- `SettingsPage.tsx`, `EnvManager.tsx`, `ActiveTimersPage.tsx`, `TerminalPage.tsx`, `QuestmasterPage.tsx`
  - App-level management pages.
- `Playground.tsx`
  - Visual/component state sandbox for chat-related UI.

## How components fit together

- Components consume state from `store.ts` and trigger actions through store methods,
  `api.ts`, and `ws.ts` helpers.
- Page/shell components compose feature components; feature components delegate to
  smaller rendering primitives.
- Tests are colocated next to components to validate behavior, rendering states,
  and protocol/UI edge cases.

## Conventions

- Keep rendering concerns in components, not protocol parsing logic.
- Prefer shared helpers from `../utils` for duplicated formatting/parsing rules.
- If chat/message behavior changes, update `Playground.tsx` mocks to reflect new states.
