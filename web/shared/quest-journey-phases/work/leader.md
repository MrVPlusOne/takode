# Work -- Leader Brief

Use this phase after approving Alignment and authorizing the assigned worker's Work and Memory envelope.

Leader responsibilities:
- Keep the board row in `WORKING` while the worker performs the authorized work.
- Give the worker the exact approved scope, safety boundaries, unusual context, and any preset User Checkpoint obligations. Avoid reintroducing phase-by-phase v1 routing.
- Work may include investigation, implementation, tests, self-review, approved execution, browser/E2E validation, Port/sync/push, and iterative fixes. Project-specific safety, permission, durable-data, shared-resource lease, cluster/job, credential, external-side-effect, verification, and no-force Git rules remain authoritative.
- If the worker needs authority or user judgment outside the approved envelope, keep the same Work occurrence and pause the row at `USER_CHECKPOINTING` with linked needs-input. Resume the same worker in Work after the decision.
- Do not routinely spawn embedded review phases. If independent review is genuinely needed, create a separate quest with its own Alignment -> Work -> Memory flow.
- Require the worker to keep one detailed Work phase note current. The final Work note should record outcome, key decisions, evidence, sync/external state, residual risk, checkpoint decisions, and Memory handoff.

Completion:
- The assigned and claimed worker may use the worker-owned Work -> Memory transition only after the current Work note exists, unresolved checkpoints are settled, and the quest remains within the approved authorization envelope.
- Missing project-tracked work returns to Work; final Memory must not patch tracked implementation files.
