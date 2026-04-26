---
name: quest-journey-execute
description: "Quest Journey phase: execute. Use when a leader is authorizing a high-stakes, long-running, costly, or externally consequential action."
---

# Quest Journey Phase: Execute

This phase runs the approved high-stakes or externally consequential action.

Leader actions:
- State the owner, artifacts, monitor plan, stop conditions, and alert triggers.
- Keep the board row in `EXECUTING`.
- Require explicit external-state and bookkeeping expectations when the action finishes.

Worker-visible boundary:
- The worker may run the approved operation and monitor it within the stated risk envelope.
- The worker must escalate when stop conditions or new risks appear.

Exit evidence:
- Execution report, artifact/run identifiers, monitor results, and any triggered alerts or stop conditions.

Advance when:
- The execution report is complete and the leader is ready for outcome review, bookkeeping, or Journey revision.
