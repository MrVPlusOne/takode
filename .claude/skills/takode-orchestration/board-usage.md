# Work Board

The work board (`takode board show`) is your primary coordination tool. It tracks the active Quest Journey phase for each quest, the remaining planned phases, and what action is required next.

## Commands

### `takode board show`

Display the board with phase boundaries and next-action hints.

### `takode board set <quest-id> [--worker N] [--status STATE] [--wait-for q-X,#Y,free-worker] [--phases phase-a,phase-b] [--preset preset-id] [--revise-reason "why"] [--no-code|--code-change]`

Add or update a row.

- `--wait-for` marks what the row is blocked on:
  - `q-N` for another quest to clear
  - `#N` for a specific session to become reusable
  - `free-worker` when the only blocker is herd worker-slot capacity
- `--phases` assembles the row's active Journey from built-in phase IDs
- `--preset` labels the planned phase sequence
- `--revise-reason` records why an existing Journey's remaining phases changed
- `--no-code` marks a true zero-code quest that may later skip porting
- `--code-change` clears that marker

Built-in phase IDs are:

`planning`, `explore`, `implement`, `code-review`, `mental-simulation`, `execute`, `outcome-review`, `bookkeeping`, `port`

Compatibility aliases remain accepted for older rows and habits:

`implementation -> implement`, `skeptic-review -> code-review`, `reviewer-groom -> code-review`, `porting -> port`, `stream-update -> bookkeeping`, `state-update -> bookkeeping`

Examples:

- Default tracked-code Journey:
  `takode board set q-12 --worker 5 --phases planning,implement,code-review,port --preset full-code`
- Investigation before action:
  `takode board set q-12 --worker 5 --phases planning,explore,execute,outcome-review --preset ops-investigation`
- Revise the remaining Journey:
  `takode board set q-12 --phases implement,outcome-review,code-review,port --preset cli-rollout --revise-reason "Need real outcome evidence before final review"`

When `--phases` is supplied for a new active row and `--status` is omitted, the board starts that row at the first planned phase. When revising an existing active row, omitting `--status` preserves the current phase boundary as long as the revised phase list still includes it.

### `takode board advance <quest-id>`

Advance a quest to the next phase in that row's planned Journey. At the final planned phase, `advance` removes the row from the board.

### `takode board advance-no-groom <quest-id>`

Explicitly complete a true zero-code quest from review without porting. Use this only after the accepted result produced zero git-tracked changes and the row was already marked `--no-code`.

### `takode board rm <quest-id> [<quest-id> ...]`

Remove row(s) manually.

## Rules

- Every command outputs the full board after the operation.
- Always set `--worker N` when adding an active quest to the board.
- Use `takode board advance` for normal phase transitions.
- Use `takode board set --status ...` for intentional resets or active-boundary changes.
- Every `QUEUED` row must keep an explicit `--wait-for` reason.
- Update the board immediately when herd events change quest state.
- Do not restate current board rows in chat after updating the board; the UI already shows them live.
