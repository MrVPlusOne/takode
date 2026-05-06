# Bookkeeping -- Leader Brief

Use this phase when durable shared state must be updated as a first-class step.

Bookkeeping is for cross-phase or external durable state beyond normal phase notes: consolidated summaries, final debrief metadata after port when the port worker could not reliably create it, verification checklist reconciliation, external docs or links, superseded facts, notification cleanup, thread cleanup, file-based memory updates, or shared-state updates. Do not dispatch Bookkeeping just to repeat the documentation a phase actor should already write.

Leader actions:
- Keep the board row in `BOOKKEEPING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/bookkeeping/assignee.md`.
- Define exactly which shared facts, locations, or handoff records must be updated.
- When the durable state belongs in file-based memory, specify the intended memory responsibility (`current/`, `knowledge/`, `procedures/`, `decisions/`, `references/`, or `artifacts/`) and require the assignee to use visible `memory recall`, the repo-level write lock, direct file edits, lint/doctor, diff review, and a source-trailed memory commit. Normal `memory` commands auto-create the current server/session-space repo; do not instruct the assignee to run a separate init step.
- Require the assignee to report exactly one memory statement when memory was in scope: `memory updated: <commit>`, `memory update deferred: <reason or curator>`, or `memory update not needed: <reason>`.
- Use this phase as the fallback owner for final debrief metadata when Port is omitted, when a Port worker cannot reliably draft it, or when leader-owned completion after Outcome Review lacks enough consolidated context. Require both a final debrief and debrief TLDR before completing a non-cancelled quest.
- Treat superseded or stale facts as part of the bookkeeping scope.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase bookkeeping` if current-phase inference is unavailable.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Advance only when the shared state is current.
