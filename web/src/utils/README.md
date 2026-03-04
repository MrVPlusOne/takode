# `web/src/utils`

Pure utility modules shared across frontend features.

This directory holds non-UI helper logic: routing, adapters, formatting,
local persistence helpers, and feature-specific pure calculations.

## What this directory contains

- Routing and navigation helpers
- Session/view-model adaptation helpers
- Display/formatting helpers for paths, highlights, copy behavior
- Storage-scoping and lightweight local persistence utilities
- Feature calculators (usage bars, project grouping, backend mode/model mapping)

## Key files

- `routing.ts`
  - Hash route parsing and route-aware navigation helpers.
- `navigation.ts`
  - Small centralized navigation helpers for hash mutation consistency.
- `session-view-model.ts`
  - Adapter between server snake_case session shapes and camelCase frontend usage.
- `tool-rendering.ts`
  - Shared tool input/result parsing helpers used by multiple components.
- `usage-bars.ts`
  - Shared usage percentage math/rendering helpers.
- `project-grouping.ts`
  - Session grouping/ordering helpers used by sidebar views.
- `scoped-storage.ts`
  - Server-ID-scoped localStorage access helpers.
- `backends.ts`
  - Backend/mode/model mapping and permission-mode translation helpers.
- `path-display.ts`, `highlight.ts`, `copy-utils.ts`
  - Common UI formatting and copy behavior helpers.

## How utilities fit together

- Components call utility modules to avoid duplicating formatting and adapter logic.
- Hooks use utils for pure transformations; hooks retain stateful behavior.
- Store and websocket handlers use utilities for consistent parsing and persistence keys.

## Conventions

- Prefer pure functions with explicit input/output types.
- Keep side effects isolated (for example, storage wrappers) and clearly named.
- If logic is reused in two+ places, move it here and add tests.

## Practical boundaries

- Keep React hooks out of this directory.
- Avoid importing component modules into utils.
- Prefer frontend-facing adapters here instead of duplicating shape-conversion logic in components.

## Related modules

- `../hooks`: stateful wrappers around pure utility logic.
- `../components`: primary consumers of formatting and adapter helpers.
