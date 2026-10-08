---
name: takode-ui-e2e-validation
description: "Use when validating Takode UI or E2E workflows in a browser, checking frontend behavior, using shared persistent validation state or isolated exceptions, gathering screenshot evidence, exercising Playground states, coordinating dev-server:companion or agent-browser leases, or documenting Quest Journey Execute evidence. This Takode project skill uses agent-browser for interactive validation and forbids stopping, killing, or replacing the live :3456 server."
---

# Takode UI/E2E Validation

Validate Takode UI changes with `agent-browser`, scoped leases, an explicit state strategy, and evidence that future reviewers can trust.

## Non-Negotiables

- Use `agent-browser` for interactive Takode browser validation. It requires the real `agent-browser` program and a headless Chrome on the machine you run on; if either is missing, follow **Missing Agent Browser Or Chrome** instead of skipping browser validation or installing silently.
- Never stop, kill, restart, bind over, or replace an existing server on `:3456`. In this project, `:3456` is the live/session server agents depend on.
- Stop a validation server you started with `scripts/validation-server.ts stop` or by its own task, PID or port (`lsof -tiTCP:<port> -sTCP:LISTEN`), never by a command-line pattern such as `pkill -f server/index.ts`: the live `:3456` server runs with the same command line.
- Default normal Takode E2E/browser validation to the authorized shared persistent validation state when one is documented or explicitly authorized. Treat this as persistent validation state, not as permission to mutate live `:3456`.
- Use isolated temp HOME/state only for destructive tests, privacy-sensitive data, reset-sensitive scenarios, narrow frontend-only checks, or when retained shared state would make the result misleading. Playground/browser fixtures and sanitized copied-live snapshots remain valid for their narrower cases.
- Do not treat "the accepted code is only in my worktree / not ported yet" as an isolation reason by itself. Code and state are separable: run the worker worktree process on safe alternate ports, but point it at an authorized persistent validation profile when that profile is safe to reuse. Prefer that, or a sanitized copied persistent snapshot, before falling back to an empty temp HOME.
- If no shared persistent validation state is documented or authorized for the task, say so before falling back to isolated temp state, a Playground/browser fixture, or a sanitized copied-live snapshot.
- Hold the Takode lease for each shared resource you will use:
  - Full browser validation usually needs both `dev-server:companion` and `agent-browser`.
  - Server-only work needs `dev-server:companion`.
  - Use only the ports, state and browser session mapped to the slots you hold (see **Lease Slots**). Apply the shared **Global Resource Leases** instructions for capacity and recovery; do not increase capacity or treat another slot as permission to share conflicting ports/state.
  - Browser-only inspection of an already-authorized server needs `agent-browser`.
- Release leases promptly when validation is finished.
- Close Agent Browser/browser resources you opened before releasing the lease, especially after screenshots or capture work. On macOS, when practical, verify stale `Google Chrome for Testing` capture state is not still holding a display-sleep assertion such as `PreventUserIdleDisplaySleep` / `NoDisplaySleepAssertion`.
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
4. If starting a server, use your `dev-server:companion` slot's ports through `scripts/validation-server.ts` (see **Lease Slots**). Keep `:3456` untouched.
5. Open and operate the UI with `agent-browser`.
6. Capture screenshots for important visual states and optimized evidence paths.
7. End by deciding what state to retain or remove. Retain useful new scenarios by default; clean up only state that is clearly harmful, misleading, sensitive, destructive, or not useful. Close Agent Browser/browser resources and clean up only resources you own.
8. Record what was validated, what passed or failed, state provenance, screenshots/artifacts, retained/removed state, and residual risk in the quest phase notes or final report.

If a lease command queues you behind another session, wait for the Resource Lease message that says you now hold the resource. The queued output includes the current owner and queue details; do not poll unless you need a manual status refresh.

For command patterns, artifact handling, and surface-specific heuristics, read [references/takode-validation-guide.md](references/takode-validation-guide.md).

## Missing Agent Browser Or Chrome

Each machine that runs Takode sessions needs its own `agent-browser` and headless Chrome; a remote host does not share the laptop's. Takode's `~/.companion/bin/agent-browser` wrapper is only a shim: it reports `real agent-browser binary not found outside ~/.companion/bin` when the real program is missing, and `agent-browser doctor` reports `No Chrome binary found` when Chrome is missing.

When either is missing, stop the browser part of the validation and flag it to the user: name the machine, what is missing and the install commands from the guide's **Agent Browser Flow**, and offer to install. These are machine-level installs, so install only after the user approves. Workers ask their leader with `takode notify needs-input`, and the leader brings the decision to the user. Until the tools are installed, do not report the browser validation as done.

## Lease Slots

Each slot number of these pools maps to its own resources, so parallel holders never share a server, a HOME or a browser:

| Pool | Slot N resources |
|------|------------------|
| `dev-server:companion` | backend port `3470+N`, Vite port `5180+N`, state directory `/tmp/takode-validation/dev-server-N/` (HOME in its `home/`, plus logs) |
| `agent-browser` | agent-browser session `takode-browser-N` |

Slot 2, for example, gets backend `3472`, frontend `http://127.0.0.1:5182` and browser session `takode-browser-2`.

- Start and stop validation servers with the helper, run from `web/` of the checkout you are validating. It reads your slot from your lease, refuses ports that are already in use instead of stopping their owners, drops the live server's `COMPANION_*`/`TAKODE_*` identity from the inherited environment, and `stop` only stops processes this session started:

  ```bash
  bun --no-install scripts/validation-server.ts start   # add --fresh to empty the slot HOME first
  bun --no-install scripts/validation-server.ts status  # your slots, URLs and whether your servers run
  bun --no-install scripts/validation-server.ts stop
  ```

- The slot's state directory belongs to whoever holds the slot. It may contain an earlier holder's state, so use `start --fresh` when you need empty state.
- Takode's `agent-browser` wrapper drives your slot's session automatically while you hold an `agent-browser` slot, including `agent-browser close`. If you call the real binary directly, pass `--session takode-browser-N`. Never run `agent-browser close --all`; it closes other slots' browsers too.
- `make dev` and `scripts/dev-start.sh` use the default ports `3457`/`5174`, which belong to no slot. Do not use them for leased validation.

## Server Selection

Use the authorized shared persistent validation state as the default for normal Takode E2E/browser validation when the current owner/lease allows it. The profile must have an identified URL/ports, state location or name, and cleanup/retention expectations. If no safe persistent profile is documented or authorized, explicitly record that limitation, then use your slot's isolated HOME through the helper above.

Open your slot's frontend in `agent-browser`; the Vite proxy targets your slot's backend:

```bash
agent-browser --color-scheme dark open http://127.0.0.1:5182   # slot 2
agent-browser set viewport 1440 1000
```

Do not stop or kill any process you did not start, especially on `:3456`. Shared persistent validation state is intentionally long-lived; do not reset or prune it unless the task or profile policy authorizes that cleanup.

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
- New state created and the cleanup/retention decision: what was removed, what was intentionally retained, whether Agent Browser/browser resources were closed, and why retained state is useful for future validation. Retention is the default for useful scenarios.
- Any skipped checks and why they were not proportional or safe.

For future generalized lessons, update this skill or its reference files during the quest and mention that in phase notes. For major new workflow coverage, create a separate quest proposal instead of expanding this skill opportunistically.
