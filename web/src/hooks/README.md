# `web/src/hooks`

Custom React hooks used by frontend components.

These hooks extract reusable stateful logic from large components and provide
focused, typed interfaces for specific behaviors.

## What lives here

- Message feed modeling and collapse policy hooks
- Usage-limits polling/fetch hooks
- Voice input and recording hook logic

## Key hooks

- `use-feed-model.ts`
  - Normalizes message history for feed rendering.
  - Groups messages into turns and reconstructs subagent/task relationships.
  - Keeps feed shaping logic out of `MessageFeed.tsx` view rendering.

- `use-collapse-policy.ts`
  - Encapsulates turn collapse/expand policy.
  - Combines default auto-collapse behavior with user override state.

- `useUsageLimits.ts`
  - Fetches and tracks usage/rate-limit information for sessions.

- `useVoiceInput.ts`
  - Microphone capture, transcription input handling, and level meter logic.

## How hooks fit into the frontend

- `components/MessageFeed.tsx` consumes `use-feed-model` and `use-collapse-policy`
  to stay focused on rendering.
- Input-focused components (for example `Composer.tsx`) consume `useVoiceInput`.
- Session metadata components consume `useUsageLimits` when showing limit bars/countdowns.

## Guidance

- Hooks in this directory should expose typed, narrow APIs.
- Keep protocol parsing and formatting in `utils/` when not inherently React-stateful.
- Add colocated tests for non-trivial hook behavior (timers, normalization, policy logic).

## Typical usage pattern

1. Keep expensive normalization/calculation in a hook.
2. Return pre-shaped view data plus small event handlers.
3. Keep component files focused on layout, rendering, and user interaction wiring.

## Related directories

- `../components`: UI consumers of hook outputs.
- `../utils`: pure helpers shared by hooks/components.
- `../store.ts`: shared application state that hooks may read/write through selectors/actions.
