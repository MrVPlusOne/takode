# Work -- Leader Brief

Use this phase after approving Alignment and authorizing the assigned worker's Work and Memory envelope.

Leader responsibilities:
- Keep the board row in `WORKING` while the worker performs the authorized work.
- Treat the quest and approved Alignment envelope as the worker's scope. The Work message should contain only the Work assignee brief path plus leader-owned deltas the worker cannot already access: later user decisions, cross-quest dependencies, external-state changes, unavailable source pointers, nonstandard authority boundaries, safety warnings, scheduling constraints, or preset User Checkpoint obligations.
- After a clean Alignment, the default Work authorization is minimal: `Leader-only deltas: none`. Do not restate generic phase duties, worker-derived findings, or likely implementation approaches. Avoid reintroducing phase-by-phase v1 routing.
- Work may include investigation, implementation, tests, self-review, approved execution, browser/E2E validation, Port/sync/push, and iterative fixes. Project-specific safety, permission, durable-data, shared-resource lease, cluster/job, credential, external-side-effect, verification, and no-force Git rules remain authoritative.
- Recovery preserves the full remaining authorized Work envelope. After a system, transport, provider-stream, compaction, or leader-recycle interruption, recover the latest durable state and resume every still-authorized Work responsibility in one continuation instead of authorizing implementation, validation, commit, sync/push, approved preparation, or read-only preflight as separate micro-handoffs. Treat a status request as an update, not an implicit pause.
- For `recovery pending`, inspect progress once and allow one short verification window. If progress continues, let the same turn run. If no progress is evident, interrupt the stale turn and resume the same full remaining authorized Work envelope. Refresh volatile preconditions inside that envelope; verify rather than repeat completed side effects, and do not override Takode's exact-once replay proof or recovery suppression.
- If the worker needs authority or user judgment outside the approved envelope, keep the same Work occurrence and pause the row at `USER_CHECKPOINTING` with linked needs-input. Resume the same worker in Work after the decision.
- Do not routinely spawn embedded review phases. If independent review is genuinely needed, create a separate quest with its own Alignment -> Work -> Memory flow.
- Require the worker to keep one detailed Work phase note current. The final Work note should record outcome, key decisions, evidence, sync/external state, residual risk, checkpoint decisions, and Memory handoff.

Completion:
- The assigned and claimed worker may use the worker-owned Work -> Memory transition only after the current Work note exists, unresolved checkpoints are settled, and the quest remains within the approved authorization envelope.
- Treat a handoff with uncommitted changes, unsettled target sync/push, or missing final verification as incomplete Work even if the worker says "Work complete"; route the same worker back to Work with the exact missing facts.
- Missing project-tracked work returns to Work; final Memory must not patch tracked implementation files.
