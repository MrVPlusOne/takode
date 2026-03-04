# `landing`

Standalone marketing/landing site for The Companion (`thecompanion.sh`).

This is a separate Vite + React app from the main `web/` product UI. It is used
for the public-facing homepage and onboarding copy/screenshots.

## What it contains

- Single-page landing layout and content sections
- Tailwind-based styling/theme for the marketing site
- Reusable section components (`Hero`, `Features`, `HowItWorks`, etc.)

## Key files

- `src/main.tsx`
  - App bootstrap and system dark-mode preference binding.
- `src/App.tsx`
  - Page composition: nav, hero, screenshot, features, flow, get-started, footer.
- `src/components/*`
  - Section-level components for page content and interactions.
- `src/index.css`
  - Tailwind imports, theme tokens, typography, and animation styles.
- `vite.config.ts`
  - Vite configuration for this standalone app.

## Run and lifecycle

Preferred entrypoint (repo root):

- `./scripts/landing-start.sh`
  - Idempotent starter for local landing dev server on port `5175`.
  - Supports `--stop` and `--status`.

Direct commands inside `landing/` are still available:

- `bun run dev`
- `bun run build`
- `bun run preview`

## Relationship to `web/`

- `landing/` is static marketing UI.
- `web/` is the authenticated interactive application (sessions, websocket chat, tooling).
- They are intentionally decoupled so product UI changes do not block landing updates.

## Contributor notes

- Keep this app dependency-light and focused on content clarity/performance.
- Prefer section components in `src/components/` for page-level blocks.
- Visual identity tokens and animation defaults should be centralized in `src/index.css`.
- If adding assets, place static files in `landing/public/`.
