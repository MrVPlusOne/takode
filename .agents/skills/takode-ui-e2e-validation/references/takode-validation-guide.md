# Takode Validation Guide

Use this reference after loading the `takode-ui-e2e-validation` skill when detailed command patterns or workflow heuristics are needed.

## Lease Pattern

Acquire leases before touching shared browser or server resources. Choose the lease scope by the resource you will actually use:

```bash
# Full browser validation normally needs both when it starts or uses a shared
# persistent validation server. Isolated Takode apps also need both:
takode lease acquire dev-server:companion --purpose "Validate q-N UI" --ttl 30m --wait
takode lease acquire agent-browser --purpose "Validate q-N UI" --ttl 20m --wait

# Server-only validation or setup:
takode lease acquire dev-server:companion --purpose "Validate q-N server" --ttl 30m --wait

# Browser-only inspection of an already-authorized server:
takode lease acquire agent-browser --purpose "Inspect q-N UI" --ttl 20m --wait
```

If the command queues behind another holder, it prints the owner and queue details, then the server sends a Resource Lease message to your session when you are promoted. Do not poll in a loop; use `takode lease status <resource>` only for an intentional manual refresh.

Renew long sessions before leases expire:

```bash
takode lease renew dev-server:companion
takode lease renew agent-browser
```

Release promptly:

```bash
takode lease release agent-browser
takode lease release dev-server:companion
```

If a lease is held by another session, queue, wait for the Resource Lease promotion message, or choose a documented non-conflicting path. Do not start a competing browser or dev server.

## State Strategy

Choose the state strategy before opening the browser or starting a server. Record the choice in the quest note or final report so future reviewers know what the evidence represents.

Use shared persistent validation state by default for normal Takode UI/E2E checks. Accumulated sessions, long leader histories, Questmaster data, notifications, Work Board/thread state, reconnection artifacts, and other realistic state are useful validation assets rather than noise to discard. The profile must be documented or explicitly authorized for the task, with known URL/ports and state ownership. Persistent validation state is not permission to mutate the live/session server on `:3456`.

Use isolated temp HOME/state only when isolation, resetability, privacy, or destructive testing matters more than representative accumulated state. This is the safer choice for destructive permission flows, cleanup behavior, migration experiments, failure injection, privacy-sensitive data, reset-sensitive scenarios, narrow frontend-only checks, tests that may create harmful or misleading session data, or any run where stale retained state could confuse the result. Set `HOME` to a temp directory for both backend and frontend commands, then record the temporary HOME, companion settings/session path, backend port, frontend port, and cleanup performed.

Unported worktree code does not automatically justify empty isolated state. Code and state are separable: for pre-Port UI validation, run the worker worktree frontend/backend on safe alternate ports while pointing it at the authorized persistent validation profile when that profile can be reused safely. If direct reuse would risk corrupting or confusing shared state, use a sanitized copied persistent snapshot before falling back to an empty temp HOME. Record which option you chose and why, especially when persistent state cannot safely run the worktree code.

Use Playground or browser fixtures when the target is a frontend-only component state and the behavior does not need real backend/session history. This keeps setup cheap and makes unusual visual states repeatable, especially for message rows, tool blocks, permission banners, composer states, and compacted/streaming examples.

Use a sanitized copied-live snapshot when a bug is anchored to a specific live session, quest history, or session-store shape that cannot be represented with the shared persistent state or Playground. Copy the minimum needed state, remove secrets or unrelated user data when applicable, run against isolated ports, and treat the copied snapshot as disposable unless the quest explicitly asks to preserve it.

Curated fixture packs are a later evolution. Do not block current validation on repo-checked fixture packs unless a quest specifically implements them.

## Shared Persistent State Inventory

Before using shared persistent validation state, capture a start-of-test inventory:

- Profile name or state location, if documented.
- Backend and frontend URL/ports.
- Lease owner/status and whether you are reusing an already-running authorized server.
- Known useful scenarios or session/quest IDs you expect to exercise.
- Starting-state caveats that could affect interpretation, such as stale notifications, existing failed runs, large histories, or intentionally retained test data.
- Cleanup and retention expectation for new state created during this run. Useful scenarios should be retained by default with enough provenance for the next tester.

If any of those facts are unknown, write that down before testing. Do not invent missing profile commands, names, ports, owners, or reset policies. If no authorized shared persistent state is available, document that limitation before falling back to isolated state, a Playground/browser fixture, or a sanitized copied-live snapshot.

## Server And Port Safety

Takode agents depend on the live/session server on `:3456`. Never stop, kill, replace, restart, or bind over it during validation.

For normal E2E/browser validation, prefer the authorized shared persistent validation state with documented URL/ports and retention policy. If no such profile is available, fall back to isolated temp state, Playground/browser fixtures, or a sanitized copied-live snapshot and document the limitation.

For isolated validation, use both a temp `HOME` and alternate ports:

```bash
# Shared setup:
mkdir -p /tmp/takode-q-N/home

# Terminal 1, from web/
HOME=/tmp/takode-q-N/home PORT=3467 NODE_ENV=development bun server/index.ts

# Terminal 2, from web/
HOME=/tmp/takode-q-N/home PORT=3467 bun run dev:vite -- --host 0.0.0.0 --port 5178
```

Then browse:

```bash
agent-browser --color-scheme dark open http://127.0.0.1:5178
agent-browser set viewport 1440 1000
agent-browser set viewport 430 932
```

Use existing project scripts only when their hardcoded ports are appropriate and you hold the lease. `scripts/dev-start.sh` uses backend `3457` and frontend `5174`; it may stop processes on those ports when asked to start or stop, so do not use it for unknown or shared port occupants.

Do not reset, prune, or clean shared persistent validation state unless the task or documented profile policy authorizes that cleanup. Long-lived validation state is allowed to accumulate useful scenarios, but every retained scenario needs a reason and enough provenance for the next tester to understand it.

## Agent Browser Flow

Run `agent-browser skills get core --full`, `agent-browser --help`, or a subcommand help page if exact syntax is uncertain; the installed wrapper also optimizes screenshot output by default.

If `agent-browser` fails before help or navigation, check local setup before debugging the app:

```bash
command -v agent-browser
agent-browser --version
agent-browser doctor
```

Takode installs a stable wrapper at `~/.companion/bin/agent-browser`; that wrapper expects a real `agent-browser` delegate elsewhere on `PATH`, such as `~/.bun/bin/agent-browser`. If the wrapper reports `real agent-browser binary not found outside ~/.companion/bin`, install the delegate:

```bash
bun add -g agent-browser@0.27.0
```

If `doctor` reports no Chrome binary, populate the cache used by Agent Browser:

```bash
agent-browser install
```

The expected Chrome for Testing cache is `~/.agent-browser/browsers`, for example `~/.agent-browser/browsers/chrome-148.0.7778.97/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing` after installing Agent Browser `0.27.0` on macOS arm64.

Typical flow:

```bash
agent-browser --color-scheme dark open http://127.0.0.1:5178
agent-browser set viewport 1440 1000
agent-browser screenshot /tmp/takode-q-N/desktop-initial.png
agent-browser open http://127.0.0.1:5178/#/playground
agent-browser set viewport 430 932
agent-browser screenshot /tmp/takode-q-N/mobile-playground.png
```

Prefer semantic interactions and visible UI checks. Use DOM probes only when they answer an objective question that screenshots or visible interaction cannot, such as bounding boxes, aria state, or exact row counts.

## Theme And Viewports

Dark theme is Takode's primary validation theme. If the app persists a different theme, switch to dark before taking acceptance screenshots.

Use at least:

- Desktop: around `1440x1000` for dense workspaces.
- Mobile: at least `430x932`, matching a normal iPhone Pro/Max-sized screen.

Add narrower or wider viewports only when the changed surface depends on them.

## Screenshot And Artifact Handling

Store transient evidence outside tracked source unless the quest explicitly asks for committed artifacts:

```bash
mkdir -p /tmp/takode-q-N
```

Use descriptive names:

- `desktop-quest-detail-open.png`
- `mobile-permission-banner-denied.png`
- `playground-tool-block-streaming.png`

Takode's `agent-browser screenshot` wrapper preserves the original screenshot and returns an optimized `.takode-agent.` sibling by default. Cite the optimized path in notes unless pixel-level debugging requires the original. For screenshots produced by other local tools, run:

```bash
quest optimize-image /tmp/takode-q-N/example.png
```

Do not recompress paths that already contain `.takode-agent.`. Clean up large temporary directories when they are no longer useful.

Name screenshots and artifact directories so the state provenance is visible, for example `persistent-profile-desktop-quest-detail.png`, `isolated-home-mobile-permission-denied.png`, or `playground-tool-block-streaming.png`. If screenshots come from a copied snapshot, include the snapshot source and sanitization status in the notes rather than only in the filename.

## Playground Coverage

Update and validate Playground when a changed state belongs to the message/chat flow:

- Message rows and grouping.
- Tool blocks and tool summaries.
- Permission banners and approval states.
- Composer states.
- Streaming, subagent, terminal, or thread-related message states.

The route is `#/playground`. Prefer validating the specific section that represents the changed component state.

For Playground, prefer screenshots first. The page intentionally contains many dense fixtures, so broad deep snapshots can produce huge output and fuzzy clicks can target the wrong repeated label or control. When structure or interaction is needed:

- Take scoped snapshots around the relevant section instead of full-page high-depth snapshots.
- Use lower snapshot depth unless the deeper tree is specifically needed.
- Prefer section-specific DOM probes for objective checks such as bounding boxes, text presence, aria state, or row counts.
- After a fresh scoped snapshot, interact through deterministic refs or selectors. Avoid relying on fuzzy clicks for deep fixtures with repeated buttons, labels, or controls.
- If navigation changes the URL but the visible route appears stale, reload before capturing acceptance screenshots and document the reload.

## Surface Heuristics

Questmaster:

- Check both list/card state and detail-panel state when the change affects quest metadata, review state, verification items, or feedback.
- Be careful with mutable quest actions. In shared persistent validation state, prefer read-only visual checks or clearly labeled validation quests unless the quest explicitly authorizes broader state changes. If a created quest becomes a useful scenario, retain it intentionally and document why; otherwise remove or mark it according to the profile policy.

Work Board and thread tabs:

- Verify status movement, attention/read indicators, thread selection, and persistence after navigation.
- Use screenshots before and after tab/session switches when the bug involves stale state.

Chat/message feed:

- Verify streaming, completed, compacted, and tool-result states as applicable.
- Check that messages do not overlap fixed composer or sidebar regions on mobile.
- If a component state cannot be naturally produced, represent it in Playground and validate there.

Permission/tool blocks:

- Exercise pending, approved, denied, cancelled, collapsed, and expanded states when touched by the change.
- Keep permission actions local and reversible. Do not approve externally consequential tools just to get a screenshot.

## Scenario Labels And Handoff

Treat validation state as shared evidence. For each scenario you reuse or create, record a short label in the quest note, such as `large leader history`, `quest detail with User Checkpoint feedback`, `pending permission banner`, or `restored session after reconnect`. Include the session IDs, quest IDs, routes, or screenshot names needed to find it again when those identifiers exist.

At the end of testing, decide what happens to new state:

- Retain representative scenarios that are likely to help future UI validation, and document the label, provenance, and reason for retention. This is the default for useful conversations, sessions, quests, and scenarios created during shared-state validation.
- Remove or mark throwaway state when it is noisy, misleading, sensitive, or created only to exercise a destructive path.
- Leave pre-existing shared profile state alone unless cleanup is authorized and you understand the ownership.
- Release leases and stop only the resources you started or are explicitly responsible for. Never kill a server just because it is on a familiar port.

## Phase Note Template

Use this structure for Implement or Execute notes when browser evidence matters:

```markdown
Validation method: agent-browser workflow using <shared persistent validation state | isolated temp state | Playground/browser fixture | sanitized copied-live snapshot>.
State provenance: <profile name/state location/snapshot source/temp HOME; starting-state caveats; sanitized status when applicable>.
Resources: <leases held, owner handoff, whether an already-running authorized server was reused>; did not touch :3456.
URL/ports/viewports: <backend/frontend URLs and ports>; <desktop/mobile viewport sizes>; dark theme status.
Scenarios: reused <labels/session IDs/quest IDs/routes>; created <new sessions/quests/state and labels>.
Coverage: <workflow steps and expected result>.
Evidence: <optimized screenshot paths or artifact inventory>.
Cleanup/retention: <what was removed>; <what was retained and why>; <state handoff for the next tester>.
Skipped: <checks not run and why>.
Risk: <remaining uncertainty, stale-state caveats, or guidance gaps>.
```

## Extending This Skill

Add new generalized lessons when a quest reveals repeatable Takode validation friction. Keep `SKILL.md` lean; place detailed workflow notes in this reference or a sibling reference. Add scripts only when they remove a repeated, deterministic source of mistakes.

Create a new quest instead of opportunistically expanding this skill when the change is broad, controversial, or motivated by one major workflow that needs its own design discussion.
