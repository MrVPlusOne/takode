# Implement -- Leader Brief

Use this phase after approving the plan or another prior phase result.

Leader actions:
- Keep the board row in `IMPLEMENTING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/implement/assignee.md`.
- Authorize only the approved implementation scope for this phase.
- Let the worker gather cheap, local, reversible outcome evidence during this phase when that evidence can be produced inside the approved implementation scope.
- Route expensive, risky, long-running, externally consequential, or approval-gated runs to `EXECUTING` instead of stretching `IMPLEMENTING`.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase implement` if current-phase inference is unavailable.
- Require the assignee to stop after reporting back.
- Route the result into the next review, execute, bookkeeping, or port phase explicitly.
