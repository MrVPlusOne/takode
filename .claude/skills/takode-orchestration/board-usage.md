# Work Board

The work board (`takode board show`) tracks Quest Journey v2 coordination: proposed rows, queued rows, active state, worker assignment, checkpoint waits, timing, and next action.

Active v2 states are:

`PROPOSED`, `QUEUED`, `PLANNING`, `WORKING`, `USER_CHECKPOINTING`, `MEMORY`

Legacy v1 states and phase IDs are historical-read compatibility only.

## Common Commands

Show compact board:

```bash
takode board show
```

Show full row detail:

```bash
takode board detail q-12
```

Create the default active Journey after authorization:

```bash
takode board set q-12 --worker 5 --phases alignment,work,memory --preset v2-work
```

Create a proposed approval-hold row:

```bash
takode board propose q-12 --phases alignment,work,memory --summary "Goal, key tradeoff, scheduling, and exact approval question."
takode board promote q-12 --worker 5
```

Advance from Alignment to Work:

```bash
takode board advance q-12
```

Worker-owned Work -> Memory transition:

```bash
takode board work-to-memory q-12 --work-note 3
```

Queue pre-active work on dependencies:

```bash
takode board set q-12 --status QUEUED --wait-for q-9,#14,free-worker
```

Pause active Work on a same-session user decision:

```bash
takode board set q-12 --status USER_CHECKPOINTING --wait-for-input 7
takode board set q-12 --status WORKING --clear-wait-for-input
```

## Rules

- `alignment`, `work`, `user-checkpoint`, and `memory` are the only active phase IDs.
- The default phase plan is `alignment,work,memory`.
- User Checkpoint is a pause/resume state inside Work. Link it with `--wait-for-input`; do not turn it into `QUEUED`.
- Work owns investigation, implementation, self-review, approved execution, validation, sync/push duties, and iterative fixes inside the approved envelope.
- Project-specific safety, permission, durable-data, lease, cluster/job, credential/privacy/security, external-effect, strong verification, and no-force Git rules remain authoritative.
- Memory normally stays with the same worker and completes the quest after durable closure.
- Independent review is a separate quest, not an embedded board phase.
- Do not create or revise rows with legacy v1 phase IDs such as `implement`, `code-review`, `port`, or `execute`.
- Use `takode board show --full` for full board inspection and `takode board detail q-N` for one row's timing, notes, legacy compatibility labels, and revision details.
- Do not restate current board rows in chat after updating the board; the UI already shows them live.

## Work To Memory Guard

`takode board work-to-memory` is intentionally narrower than generic board mutation. It succeeds only when the caller is the authenticated assigned worker, the quest is claimed by that worker, the row is `WORKING`, a current Work note exists, and no unresolved checkpoint is linked.

Leaders can still inspect or intervene, but routine Work completion should not require leader-owned Port/review/Memory dispatch.

## Historical Rows

Existing legacy rows are preserved as stored for compatibility: their phase IDs, notes, timings, statuses, and ownership remain readable and can finish their recorded Journey. New or materially revised rows must use active v2 phases only.
