---
name: takode-ui-e2e-validation
description: "Use when validating Takode UI or E2E workflows in a browser, checking frontend behavior, gathering screenshot evidence, exercising Playground states, coordinating dev-server:companion or agent-browser leases, or documenting Quest Journey Execute evidence. This Takode project skill uses agent-browser for interactive validation and forbids stopping, killing, or replacing the live :3456 server."
---

# Takode UI/E2E Validation

Validate Takode UI changes with `agent-browser`, scoped leases, isolated ports, and evidence that future reviewers can trust.

## Non-Negotiables

- Use `agent-browser` for interactive Takode browser validation. Do not use Playwright MCP, raw Playwright scripts, or other browser automation libraries for Takode exploration unless the user explicitly asks for a non-interactive automation artifact.
- Never stop, kill, restart, bind over, or replace an existing server on `:3456`. In this project, `:3456` is the live/session server agents depend on.
- Hold the relevant Takode lease before starting or using shared resources:
  - `takode lease acquire dev-server:companion --purpose "Validate <quest or change>" --ttl 30m --wait`
  - `takode lease acquire agent-browser --purpose "Validate <quest or change>" --ttl 20m --wait`
- Release leases promptly when validation is finished.
- Validate in dark theme. Use a mobile viewport at least `430x932` when checking mobile behavior.

## Workflow

1. Read the local task, changed files, and repo instructions that define the UI surface.
2. Decide whether existing UI is already reachable or whether you need an isolated dev server.
3. If starting a server, use alternate ports only. Keep `:3456` untouched.
4. Open and operate the UI with `agent-browser`.
5. Capture screenshots for important visual states and optimized evidence paths.
6. Record what was validated, what passed or failed, screenshots/artifacts, and residual risk in the quest phase notes or final report.

For command patterns, artifact handling, and surface-specific heuristics, read [references/takode-validation-guide.md](references/takode-validation-guide.md).

## Server Selection

Prefer an already-running validation server only when the current owner/lease allows it. If no safe server is available, use isolated ports such as backend `3467` plus frontend `5178`.

Example manual two-terminal pattern from `web/`:

```bash
PORT=3467 NODE_ENV=development bun server/index.ts
PORT=3467 bun run dev:vite -- --port 5178
```

Open `http://127.0.0.1:5178` in `agent-browser`. The Vite proxy will target the backend port from `PORT`.

```bash
agent-browser --color-scheme dark open http://127.0.0.1:5178
agent-browser set viewport 1440 1000
```

Do not run any helper that kills an occupied port unless you know the port is owned by your current validation run. This is especially strict for `:3456`.

## Playground

When the changed UI affects chat/message flow components, make sure `web/src/components/Playground.tsx` or its playground support files represent the new or changed state. Validate the relevant Playground route, usually `#/playground`, when component states are easier to inspect there than in a live session.

## Evidence Notes

For Quest Journey Execute or Implement notes, include:

- URL and viewport(s) used.
- Lease/resource decisions.
- Concrete workflow steps and result.
- Screenshot/artifact inventory, with optimized `.takode-agent.` paths when available.
- Any skipped checks and why they were not proportional or safe.

For future generalized lessons, update this skill or its reference files during the quest and mention that in phase notes. For major new workflow coverage, create a separate quest proposal instead of expanding this skill opportunistically.
