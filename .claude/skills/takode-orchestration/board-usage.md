# Work Board

The work board (`takode board show`) is your primary coordination tool. It tracks proposed approval-hold Quest Journeys, active Quest Journey phases during execution, and what action is required next.

While a quest is on the board, the current planned Journey shown there is board-owned draft-or-active state for that quest. Quest creation or refinement defines the quest text, but the board carries the live Journey the leader is currently drafting or running.

## Commands

### `takode board show`

Display the routine decision board: quest, title, worker/reviewer status, current state, wait-for state, and next-action hints. Default output is intentionally compact and does not repeat full Journey paths or phase notes.

Use `takode board show --full` or `takode board show --verbose` when you need full board inspection with Journey paths and indexed phase notes for every row.

### `takode board detail <quest-id>`

Display full board-owned context for one row: full Journey path, indexed phase notes, phase timing history, revision metadata, wait-for state, worker/reviewer status, and timestamps.

### `takode board propose <quest-id> --summary "approval packet" (--phases phase-a,phase-b | --journey-file proposal.json) [--preset preset-id] [--wait-for-input 3,4 | --clear-wait-for-input] [--full|--verbose]`

Create a proposed pre-dispatch Journey row when a quest needs an approval hold or durable draft before active dispatch. `--summary` is mandatory and is the user-visible approval packet: put the Goal / Acceptance, key tradeoffs, dependencies, scheduling context, and exact approval question there. Do not repeat the same packet as separate leader chat text after running the command; the tool result renders the full summary and Journey. Existing proposed Journey changes use `takode board revise`. Proposed rows:

- keep the Journey on the board before approval/dispatch
- can explicitly wait on same-session approval/input
- do not pretend to be generic `QUEUED` worker-capacity rows
- do not assign a worker yet
- are draft state until you promote them into execution

Use `--journey-file` when composing a full proposal with phase notes and presentation/scheduling metadata. The JSON shape should use ordered phases so repeated phases and notes stay attached to the intended occurrence. Omit standard-phase notes by default; add notes only for non-standard phases or unusual phase-specific handling:

```json
{
  "presetId": "proposal-flow",
  "phases": [
    { "id": "alignment" },
    { "id": "explore", "note": "Classify the noisy log source before changing severity handling." },
    { "id": "user-checkpoint", "note": "Present severity options before implementation." },
    { "id": "implement" }
  ],
  "presentation": {
    "summary": "Proposed Journey for approval",
    "scheduling": { "intent": "dispatch-after-approval", "worker": "fresh" }
  }
}
```

Do not propose adjacent `explore -> implement`. Use `implement` directly for normal bug fixes, docs changes, config changes, prompt changes, and artifact changes; Implement includes ordinary investigation, reproduction, root-cause analysis, code/design reading, and test planning. Use `explore -> user-checkpoint -> implement` when Explore findings may need user steering before implementation. After a legitimate Explore completes, leaders may revise the remaining active Journey directly to `implement` when findings reveal a clear low-risk repo-local fix within existing user intent and no product/policy/user-visible tradeoff, risky external effect, or scope expansion needs user choice. Before dropping the immediate post-Explore User Checkpoint, consider those factors; if the user explicitly asked for the checkpoint or the decision truly needs input, keep the checkpoint. For other future phases whose need depends on later evidence, leaders may mark the phase note optional when the user did not explicitly require it. The note should name when the phase is needed and/or can be skipped. Remove or add non-checkpoint optional phases with `takode board revise`; there is no generic optional-phase skip command.

### `takode board promote <quest-id> [--worker N] [--status STATE] [--active-phase-position N] [--wait-for q-X,#Y,free-worker] [--wait-for-input 3,4 | --clear-wait-for-input] [--full|--verbose]`

Promote an existing proposed Journey into active execution without redefining its phase sequence. Use this after approval.

Promotion does not require a separate presentation step; the proposal card is rendered by `takode board propose --summary`, then the leader promotes the approved board-owned row before dispatch.

When promoting into `QUEUED`, `--wait-for` accepts one comma-separated value containing every blocker, for example `--wait-for q-1143,q-1139` or `--wait-for q-1143,#12,free-worker`.

### `takode board note <quest-id> <phase-position> [--text "note" | --clear] [--full|--verbose]`

Add or clear one lightweight free-form note for a specific phase occurrence. Phase positions are 1-based in the CLI, so repeated phases can carry different notes.

### `takode board set <quest-id> [--worker N] [--status STATE] [--active-phase-position N] [--wait-for q-X,#Y,free-worker] [--wait-for-input 3,4 | --clear-wait-for-input] [--phases phase-a,phase-b | --journey-file plan.json] [--preset preset-id] [--full|--verbose]`

Add or update a row. Use `set` to create the initial Journey or update non-Journey row state; once a row already has a Journey, use `takode board revise` for phase-plan changes.

- `--wait-for` marks what a `QUEUED` row is blocked on. It accepts one comma-separated value containing one or more blockers, for example `--wait-for q-1143,q-1139` or `--wait-for q-1143,#12,free-worker`:
  - `q-N` for another quest to clear
  - `#N` for a specific session to become reusable
  - `free-worker` when herd worker-slot capacity must clear
- A row with multiple `--wait-for` blockers remains queued until every listed quest, session, or capacity blocker is clear. Use the comma-separated form directly instead of retargeting the row from one blocker to the next.
- `QUEUED --wait-for` is durable board tracking, not a substitute for the resource-lease queue. When the next active phase is Execute and the only blocker is a shared lease, dispatch the worker so it can run `takode lease acquire --wait` and receive the lease-promotion event. If a leader queues externally instead, the leader owns an explicit `takode timer` checkback and a `{[(Thread Waiting: q-N | waiting on lease)]}` marker.
- `--wait-for-input` links an active row to same-session `needs-input` notification IDs when the quest is intentionally paused on a human answer
- `--clear-wait-for-input` removes that intentional human-input hold and resolves the linked notification(s)
- `--phases` assembles the initial row Journey from built-in phase IDs; repeated phases are allowed
- `--journey-file` reads `{ "phases": [{ "id": "explore", "note": "..." }] }` JSON for initial Journey creation with planned phase notes
- `--preset` labels the planned phase sequence
- `--active-phase-position` pins the active occurrence for repeated phases using a 1-based position when `--status` alone would be ambiguous

Built-in phase IDs are:

`alignment`, `explore`, `user-checkpoint`, `implement`, `code-review`, `mental-simulation`, `execute`, `outcome-review`, `port`, `memory`, `bookkeeping`

Use `takode phases` for the read-only phase catalog, including descriptions, source metadata, and exact leader/assignee brief paths.

Compatibility aliases remain accepted for older rows and habits:

`planning -> alignment`, `implementation -> implement`, `skeptic-review -> code-review`, `reviewer-groom -> code-review`, `porting -> port`, `final-memory -> memory`, `stream-update -> bookkeeping`, `state-update -> bookkeeping`

Examples:

- Default tracked-code Journey:
  `takode board set q-12 --worker 5 --phases alignment,implement,code-review,port,memory --preset full-code`
- Draft the initial board-owned proposal before dispatch:
  `takode board propose q-12 --journey-file /tmp/q-12-proposal.json --summary "Goal / Acceptance and scheduling context for approval."`
- Promote that same proposal after approval:
  `takode board promote q-12 --worker 5`
- Explore with user steering before implementation:
  `takode board set q-12 --worker 5 --phases alignment,explore,user-checkpoint,implement,code-review,port,memory --preset explore-checkpoint`
- Expensive or approval-gated run that needs independent outcome judgment:
  `takode board set q-12 --worker 5 --phases alignment,explore,execute,outcome-review,memory --preset ops-investigation`
- Bounded Execute where leader acceptance may be enough:
  `takode board set q-12 --worker 5 --phases alignment,explore,execute,memory --preset bounded-run`
- Zero-tracked-change evidence review:
  `takode board set q-12 --worker 5 --phases alignment,explore,outcome-review,memory --preset investigation`
- Scenario/design replay:
  `takode board set q-12 --worker 5 --phases alignment,mental-simulation,memory --preset design-validation`
- Revise the remaining Journey:
  `takode board revise q-12 --from-position 3 --expect-phase code-review --phases outcome-review,code-review,port,memory --preset cli-rollout`
- Queue a row on multiple blockers:
  `takode board set q-12 --status QUEUED --wait-for q-1143,#12,free-worker`
- Add a note to the second `code-review` occurrence in a rework loop:
  `takode board note q-12 5 --text "inspect only the follow-up diff"`

When revising an active row, already completed and current phase occurrences are historical. Start revisions after the current phase, and append a later repeated phase occurrence when requirements change after a phase has run.

When `--phases` is supplied for a new active row and `--status` is omitted, the board starts that row at the first planned phase.
If a repeated phase is active and the occurrence itself matters, use `--active-phase-position` so the board state and UI do not have to guess which occurrence is current.

### `takode board advance <quest-id> [--full|--verbose]`

Advance a quest to the next phase in that row's planned Journey. At the final planned phase, `advance` removes the row from the board, even when the Journey never included `port`.

### `takode board rm <quest-id> [<quest-id> ...] [--full|--verbose]`

Remove row(s) manually.

## Rules

- Routine mutation commands output a compact delta by default: what changed plus the affected quest row's state, worker/reviewer, wait-for state, and next action. Use `--full` or `--verbose` on mutations when you need the full board after the operation.
- Routine `takode board show` is compact. Use `takode board show --full` for full-board Journey paths and notes, or `takode board detail q-N` for one quest's full Journey, notes, timing history, and revision metadata.
- Use natural prose as the normal lightweight approval surface when not using a proposed row. When using a proposed row, put the approval packet in `takode board propose --summary` and keep surrounding chat minimal.
- Use `takode board set --worker ... --phases ...` when you want to create the active durable row in one step after approval or direct-dispatch authorization.
- Use `takode board propose` when an existing quest benefits from a pre-dispatch draft or approval-hold row.
- Use `takode board promote` to reuse a proposed Journey object after approval.
- Set `--worker N` when dispatching active work, but proposed rows intentionally have no worker.
- Use `takode board advance` for normal phase transitions.
- Do not use `takode board advance` on `PROPOSED` rows; promote first.
- Use `takode board set --status ...` for intentional resets or active-boundary changes.
- Every `QUEUED` row must keep an explicit `--wait-for` reason.
- `--wait-for` and `--wait-for-input` are mutually exclusive on a single row.
- `--wait-for-input` is valid on active rows and proposed approval-hold rows. Do not use it on `QUEUED` rows.
- When an active phase is paused because a human or safety decision is needed before continuing, keep the row active, create a `needs-input` notification, and attach it with `--wait-for-input <id>`. Do not convert the row to `QUEUED --wait-for #N`; use `QUEUED --wait-for` only for pre-active scheduling/dependency waits.
- Do not convert an approved Execute phase to `QUEUED` only because a shared lease is currently held. The worker should enter Execute and use the lease queue; leader-side queueing bypasses worker lease-promotion wakeups.
- Update the board immediately when herd events change quest state.
- Do not restate current board rows in chat after updating the board; the UI already shows them live.
- Treat quest threads as the shared quest-scoped context surface: Main is the staging area for unthreaded/global work, quest-backed threads carry quest-specific activity, and All Threads/global inspection preserves the append-only audit stream. Chat should carry the next decision, reasoning, and facts that are not yet modeled structurally.
- Optional non-checkpoint phases are leader-owned Journey planning notes, not a separate skip mechanic. Use `takode board revise --from-position N --expect-phase phase-id ...` to remove an unnecessary future optional phase or add one that later evidence proves necessary, while preserving explicit user-required phases, required User Checkpoints, Code Review, Port for tracked changes, and final Memory.
- At quest create/refine/dispatch setup points, include a lightweight non-blocking reminder to attach clearly quest-specific prior Main discussion with `takode thread attach`.
- For leader sessions, user-visible Markdown is a normal leader response with a mandatory first-line thread marker: `[thread:main]` or `[thread:q-N]`. Use `takode notify needs-input` afterward only when notification state or suggested answers are needed. `takode user-message` is deprecated compatibility, not the new publishing path.
