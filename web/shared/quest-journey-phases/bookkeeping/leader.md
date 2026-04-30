# Bookkeeping -- Leader Brief

Use this phase when durable shared state must be updated as a first-class step.

Leader actions:
- Keep the board row in `BOOKKEEPING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/bookkeeping/assignee.md`.
- Define exactly which shared facts, locations, or handoff records must be updated.
- Treat superseded or stale facts as part of the bookkeeping scope.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase bookkeeping` if current-phase inference is unavailable.
- Advance only when the shared state is current.
