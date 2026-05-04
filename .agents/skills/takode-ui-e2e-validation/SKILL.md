---
name: takode-ui-e2e-validation
description: "Use when validating Takode UI or E2E workflows in a browser, checking frontend behavior, using persistent validation profiles or isolated fixtures, gathering screenshot evidence, exercising Playground states, coordinating dev-server:companion or agent-browser leases, or documenting Quest Journey Execute evidence. This Takode project skill uses agent-browser for interactive validation and forbids stopping, killing, or replacing the live :3456 server."
---

# Takode UI/E2E Validation

Validate Takode UI changes with `agent-browser`, scoped leases, an explicit state strategy, and evidence that future reviewers can trust.

## Non-Negotiables

- Use `agent-browser` for interactive Takode browser validation.
- Never stop, kill, restart, bind over, or replace an existing server on `:3456`. In this project, `:3456` is the live/session server agents depend on.
- When representative state matters, prefer an authorized persistent validation profile over starting from an empty temp state. Treat this as persistent validation state, not as permission to mutate live `:3456`.
- If no persistent validation profile is documented or authorized for the task, use an isolated temp profile, Playground/browser fixture, or sanitized copied-live snapshot and document that fallback.
- Hold the Takode lease for each shared resource you will use:
  - Full browser validation usually needs both `dev-server:companion` and `agent-browser`.
  - Server-only work needs `dev-server:companion`.
  - Browser-only inspection of an already-authorized server needs `agent-browser`.
- Release leases promptly when validation is finished.
- Validate in dark theme. Use a mobile viewport at least `430x932` when checking mobile behavior.

## Workflow

1. Read the local task, changed files, and repo instructions that define the UI surface.
2. Choose and record a state strategy:
   - Persistent validation profile when representative existing sessions/state matter.
   - Isolated temp HOME/state when isolation or resetability matters more than accumulated scenarios.
   - Playground/browser fixture for frontend-only component states.
   - Sanitized copied-live snapshot for bugs anchored to a specific live session/history.
3. Before using a persistent profile, inventory the starting state: profile name, URL/ports, known useful scenarios, owner/lease status, and anything you expect to preserve.
4. If starting a server, use authorized profile ports or alternate isolated ports only. Keep `:3456` untouched.
5. Open and operate the UI with `agent-browser`.
6. Capture screenshots for important visual states and optimized evidence paths.
7. End by deciding what state to retain or remove, documenting new/reused scenarios, and cleaning up only resources you own.
8. Record what was validated, what passed or failed, state provenance, screenshots/artifacts, retained/removed state, and residual risk in the quest phase notes or final report.

If a lease command queues you behind another session, wait for the Resource Lease message that says you now hold the resource. The queued output includes the current owner and queue details; do not poll unless you need a manual status refresh.

For command patterns, artifact handling, and surface-specific heuristics, read [references/takode-validation-guide.md](references/takode-validation-guide.md).

## Server Selection

Prefer an authorized persistent validation profile when representative state matters and the current owner/lease allows it. The profile must have an identified URL/ports, state location or name, and cleanup/retention expectations. If no safe persistent profile is available, use an isolated temp `HOME` plus alternate ports such as backend `3467` and frontend `5178`.

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

Do not run any helper that kills an occupied port unless you know the port is owned by your current validation run. This is especially strict for `:3456`. A persistent validation profile can be long-lived; do not reset or prune its state unless the task or profile policy authorizes that cleanup.

## Playground

When the changed UI affects chat/message flow components, make sure `web/src/components/Playground.tsx` or its playground support files represent the new or changed state. Validate the relevant Playground route, usually `#/playground`, when component states are easier to inspect there than in a live session.

Prefer screenshots first for Playground evidence. Use scoped or lower-depth snapshots and section-specific DOM probes when you need structure; avoid broad deep snapshots and fuzzy clicks on dense long Playground pages. For deep fixtures, take a fresh scoped snapshot, then use deterministic refs or selectors for interaction.

## Evidence Notes

For Quest Journey Execute or Implement notes, include:

- Profile/state strategy used: persistent profile, isolated temp state, Playground/browser fixture, or sanitized copied-live snapshot.
- Persistent profile inventory when applicable: profile name, URL/ports, reused scenarios/session IDs, and starting-state caveats.
- URL and viewport(s) used.
- Lease/resource decisions.
- Concrete workflow steps and result.
- Screenshot/artifact inventory, with optimized `.takode-agent.` paths when available.
- New state created and the cleanup/retention decision: what was removed, what was intentionally retained, and why retained state is useful for future validation.
- Any skipped checks and why they were not proportional or safe.

For future generalized lessons, update this skill or its reference files during the quest and mention that in phase notes. For major new workflow coverage, create a separate quest proposal instead of expanding this skill opportunistically.
