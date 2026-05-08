---
name: takode-ui-e2e-validation
description: "Use when validating Takode UI or E2E workflows in a browser, checking frontend behavior, using shared persistent validation state or isolated exceptions, gathering screenshot evidence, exercising Playground states, coordinating dev-server:companion or agent-browser leases, or documenting Quest Journey Execute evidence. This Takode project skill uses agent-browser for interactive validation and forbids stopping, killing, or replacing the live :3456 server."
---

# Takode UI/E2E Validation

Validate Takode UI changes with `agent-browser`, scoped leases, an explicit state strategy, and evidence that future reviewers can trust.

## Non-Negotiables

- Use `agent-browser` for interactive Takode browser validation.
- Never stop, kill, restart, bind over, or replace an existing server on `:3456`. In this project, `:3456` is the live/session server agents depend on.
- Default normal Takode E2E/browser validation to the authorized shared persistent validation state when one is documented or explicitly authorized. Treat this as persistent validation state, not as permission to mutate live `:3456`.
- Use isolated temp HOME/state only for destructive tests, privacy-sensitive data, reset-sensitive scenarios, narrow frontend-only checks, or when retained shared state would make the result misleading. Playground/browser fixtures and sanitized copied-live snapshots remain valid for their narrower cases.
- Do not treat "the accepted code is only in my worktree / not ported yet" as an isolation reason by itself. Code and state are separable: run the worker worktree process on safe alternate ports, but point it at an authorized persistent validation profile when that profile is safe to reuse. Prefer that, or a sanitized copied persistent snapshot, before falling back to an empty temp HOME.
- If no shared persistent validation state is documented or authorized for the task, say so before falling back to isolated temp state, a Playground/browser fixture, or a sanitized copied-live snapshot.
- Hold the Takode lease for each shared resource you will use:
  - Full browser validation usually needs both `dev-server:companion` and `agent-browser`.
  - Server-only work needs `dev-server:companion`.
  - Browser-only inspection of an already-authorized server needs `agent-browser`.
- Release leases promptly when validation is finished.
- Validate in dark theme. Use a mobile viewport at least `430x932` when checking mobile behavior.

## Workflow

1. Read the local task, changed files, and repo instructions that define the UI surface.
2. Choose and record a state strategy. The default for normal Takode E2E/browser validation is the authorized shared persistent validation state because accumulated sessions and scenarios are useful test data.
   - Use the shared persistent validation state for representative app workflows, long conversations, Questmaster scenarios, Work Board/thread state, notifications, reconnect behavior, and other state that future validators can reuse.
   - Use isolated temp HOME/state only when destructive behavior, privacy, resetability, or misleading retained state makes sharing unsafe.
   - Use Playground/browser fixtures for frontend-only component states.
   - Use sanitized copied-live snapshots for bugs anchored to a specific live session/history.
   - If the implementation is still in a worker worktree, remember that code location and state location are separate choices: run the worktree frontend/backend on alternate ports, then point it at the authorized persistent validation state when safe. If direct reuse is unsafe, try a sanitized copied persistent snapshot. Empty isolated state is the last fallback, not the default consequence of working before Port.
3. Before using shared persistent validation state, inventory the starting state: profile name or state location, URL/ports, known useful scenarios, owner/lease status, and anything you expect to preserve.
4. If starting a server, use authorized profile ports or alternate isolated ports only. Keep `:3456` untouched.
5. Open and operate the UI with `agent-browser`.
6. Capture screenshots for important visual states and optimized evidence paths.
7. End by deciding what state to retain or remove. Retain useful new scenarios by default; clean up only state that is clearly harmful, misleading, sensitive, destructive, or not useful. Clean up only resources you own.
8. Record what was validated, what passed or failed, state provenance, screenshots/artifacts, retained/removed state, and residual risk in the quest phase notes or final report.

If a lease command queues you behind another session, wait for the Resource Lease message that says you now hold the resource. The queued output includes the current owner and queue details; do not poll unless you need a manual status refresh.

For command patterns, artifact handling, and surface-specific heuristics, read [references/takode-validation-guide.md](references/takode-validation-guide.md).

## Server Selection

Use the authorized shared persistent validation state as the default for normal Takode E2E/browser validation when the current owner/lease allows it. The profile must have an identified URL/ports, state location or name, and cleanup/retention expectations. If no safe persistent profile is documented or authorized, explicitly record that limitation, then use an isolated temp `HOME` plus alternate ports such as backend `3467` and frontend `5178`.

Example manual two-terminal pattern from `web/`:

```bash
mkdir -p /tmp/takode-q-N/home
HOME=/tmp/takode-q-N/home PORT=3467 NODE_ENV=development bun server/index.ts
HOME=/tmp/takode-q-N/home PORT=3467 bun run dev:vite -- --port 5178
```

Open `http://127.0.0.1:5178` in `agent-browser`. The Vite proxy will target the backend port from `PORT`.

```bash
agent-browser --color-scheme dark open http://127.0.0.1:5178
agent-browser set viewport 1440 1000
```

Do not run any helper that kills an occupied port unless you know the port is owned by your current validation run. This is especially strict for `:3456`. Shared persistent validation state is intentionally long-lived; do not reset or prune it unless the task or profile policy authorizes that cleanup.

## Playground

When the changed UI affects chat/message flow components, make sure `web/src/components/Playground.tsx` or its playground support files represent the new or changed state. Validate the relevant Playground route, usually `#/playground`, when component states are easier to inspect there than in a live session.

Prefer screenshots first for Playground evidence. Use scoped or lower-depth snapshots and section-specific DOM probes when you need structure; avoid broad deep snapshots and fuzzy clicks on dense long Playground pages. For deep fixtures, take a fresh scoped snapshot, then use deterministic refs or selectors for interaction.

## Evidence Notes

For Quest Journey Execute or Implement notes, include:

- Profile/state strategy used: shared persistent validation state, isolated temp state, Playground/browser fixture, or sanitized copied-live snapshot.
- Shared persistent state inventory when applicable: profile name or state location, URL/ports, reused scenarios/session IDs, and starting-state caveats.
- URL and viewport(s) used.
- Lease/resource decisions.
- Concrete workflow steps and result.
- Screenshot/artifact inventory, with optimized `.takode-agent.` paths when available.
- New state created and the cleanup/retention decision: what was removed, what was intentionally retained, and why retained state is useful for future validation. Retention is the default for useful scenarios.
- Any skipped checks and why they were not proportional or safe.

For future generalized lessons, update this skill or its reference files during the quest and mention that in phase notes. For major new workflow coverage, create a separate quest proposal instead of expanding this skill opportunistically.
