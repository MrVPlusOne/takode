# Quest Journey Lifecycle

Quest Journey v2 has one active workflow:

`alignment -> work -> memory`

`user-checkpoint` is a durable pause state for decisions inside the same Work occurrence. It is not a separate default phase handoff and does not create a new worker. Legacy v1 phase IDs such as `explore`, `implement`, `code-review`, `execute`, `outcome-review`, `port`, and `bookkeeping` are historical-read compatibility only. Do not dispatch or propose them for new active work.

The work board (`takode board show`) tracks proposed rows, queued rows, active state, worker assignment, human-input waits, timing, and next action. Use `takode board show --full` for full board inspection and `takode board detail q-N` for one row's Journey, notes, legacy compatibility labels, and timing history.

## Active Phase Catalog

Built-in phase directories are seeded into `~/.companion/quest-journey-phases/<phase-id>/` with `phase.json`, `leader.md`, and `assignee.md`. Use `takode phases` to inspect the active catalog and exact brief paths.

| Phase | Board State | Purpose |
|-------|-------------|---------|
| Alignment | `PLANNING` | Fresh worker gives a concise leader-verification read-in. The leader approves or corrects the authorization envelope once before Work. |
| Work | `WORKING` | Assigned worker completes the authorized work end-to-end: investigation, implementation, validation, self-review, approved execution, Port/sync/push, iteration, and one current Work note. |
| User Checkpoint | `USER_CHECKPOINTING` | Visible decision pause when Work needs user authority or judgment outside the approved envelope. The same worker resumes Work after resolution. |
| Memory | `MEMORY` | Final durable closure: memory triage/update/deferral, quest metadata/debrief/quiz/check hygiene, cleanup/follow-up routing, and quest completion. |

Historical v1 phase metadata remains available only so stored Quest Detail timelines and old phase notes render intelligibly.

## Authorization

Before first dispatch, use `/leader-dispatch` to choose direct low-risk dispatch, pre-dispatch approval, or delayed approval through User Checkpoint. Direct dispatch is allowed only for clear, low-risk, reversible repo-local work with no material ambiguity, external side effect, security/privacy/global/shared-resource risk, product/policy choice, or user-level scheduling tradeoff.

Initial dispatch authorizes Alignment only. After the worker's read-in, the leader either corrects/escalates or approves Work and Memory within a clear envelope. That envelope may include sync/push and approved operations, but it does not expand authority: project-specific safety, durable-data, permission, lease, cluster/job, credential/privacy/security, external-effect, strong verification, and no-force Git rules remain authoritative.

## Work

Work owns the responsibilities that v1 split across Explore, Implement, Code Review, Execute, Outcome Review, and Port. The worker may self-review, delegate to subagents, run approved long operations, inspect outcomes, iterate, commit, sync, run strong verification, and push when authorized.

The worker keeps one current detailed Work note. Refresh that note for iterative fixes instead of appending a process timeline. The final Work note records outcome, key decisions, evidence, sync/external state, residual risk, checkpoint decisions, and Memory handoff.

Independent review is no longer an embedded phase. When review materially reduces risk, create a separate quest with its own Alignment -> Work -> Memory flow.

## User Checkpoint

Use User Checkpoint when Work needs user authority or judgment outside the approved envelope. The visible user prompt must be self-contained: findings, named options, key tradeoffs, recommendation, exact requested answer, and every notification shortcut explained in visible text before `takode notify needs-input` runs.

Link the active board row to the unresolved notification with `--wait-for-input`. Do not answer the decision yourself. After the answer, clear the wait and resume the same worker's Work occurrence. For externally consequential actions, fail closed on edit-only replies, questions, ambiguous approval, changed safety/monitor/stop conditions, or any remaining choice: publish a revised exact packet and wait for fresh explicit approval.

## Work To Memory

The assigned worker may use the worker-owned Work -> Memory transition only when all are true:

- caller is the authenticated assigned worker;
- quest is claimed by that worker;
- board state is `WORKING`;
- a current Work phase note by that worker exists;
- no unresolved User Checkpoint is linked.

The command is:

```bash
takode board work-to-memory q-N --work-note <feedback-index>
```

Leaders can still inspect or intervene, but routine Work completion does not require leader approval.

## Memory

Final Memory is mandatory for every non-cancelled quest. Memory normally stays with the same worker after Work. It performs catalog/direct-file memory triage, writes or defers durable memory, reconciles quest title/TLDR/description against delivered scope, settles genuine User review checks, records cleanup/follow-ups, writes final debrief metadata, and completes the quest.

Exactly one final memory statement is required:

- `memory updated: <commit>`
- `memory update deferred: <reason or curator>`
- `memory update not needed: <reason>`

Memory must not edit project-tracked implementation files. Missing tracked work returns to Work.

## Board Commands

Common v2 flow:

```bash
takode board set q-12 --worker 5 --phases alignment,work,memory --preset v2-work
takode board advance q-12
takode board work-to-memory q-12 --work-note 3
```

Use `takode board propose --summary ... --phases alignment,work,memory` when pre-dispatch approval should be durable on the board. Use `QUEUED --wait-for ...` only for pre-active scheduling/dependency waits. Use `--wait-for-input` only for active/proposed rows intentionally paused on a same-session needs-input notification.

Legacy v1 phase IDs are rejected for new active rows and revisions. Existing persisted legacy rows, completed historical runs, phase notes, and timings remain readable exactly as stored so they can finish without a rewrite.

## Startup Cutover

Server startup reseeds only v2 live phase directories, removes obsolete live v1 phase directories, and installs/symlinks current skills. It does not rewrite persisted board rows merely to adopt v2. Existing legacy rows finish through compatibility readers; new rows use v2 only.

Existing sessions adopt v2 only after server restart plus relaunch/recycle with regenerated injected instructions. Rereading a phase file alone is not enough.

## Phase Documentation

Every active phase needs durable quest documentation. Prefer:

```bash
quest feedback add q-N --text-file /tmp/phase.md --tldr-file /tmp/phase-tldr.md --kind phase-summary
```

Use phase-scoped inference when available, or explicit `--phase`, `--phase-position`, `--phase-occurrence`, `--phase-occurrence-id`, or `--journey-run` when needed. Keep phase notes useful and compressed: decisions, blockers, evidence, user choices, external state, residual risks, and next-phase handoff facts. Avoid file-by-file diff narration, long command transcripts, routine green-test lists, and repeated commit metadata.

Final chat handoffs should point to the phase feedback index and repeat only urgent blockers, safety facts, or narrow phase-required exceptions.
