# Bookkeeping -- Leader Brief

Use this compatibility phase when targeted durable shared state must be updated as a first-class intermediate step. New non-cancelled quests should still end in final `Memory`; do not use Bookkeeping as a substitute for Memory closure.

Bookkeeping is for cross-phase or external durable state beyond normal phase notes: consolidated summaries, verification checklist reconciliation, external docs or links, superseded facts, notification cleanup, thread cleanup, file-based memory updates, or shared-state updates. Do not dispatch Bookkeeping just to repeat the documentation a phase actor should already write, and do not use it for final closure now owned by Memory.

Leader actions:
- Keep the board row in `BOOKKEEPING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/bookkeeping/assignee.md`.
- Define exactly which shared facts, locations, or handoff records must be updated.
- When the durable state belongs in file-based memory, specify the intended memory responsibility (`current/`, `knowledge/`, `procedures/`, `decisions/`, `references/`, or `artifacts/`) plus any context-specific memory deltas the assignee cannot infer: relevant files or terms already inspected, source evidence, accepted decisions, freshness concerns, migration/audit constraints, or a required curator. The assignee brief owns the standard catalog-first reading, `memory catalog diff` freshness check, direct-file inspection, write-lock, lint, diff, commit, release, and no-init mechanics.
- When memory is in scope, rely on the assignee brief for the single required memory statement. Override only with a context-specific expectation, such as a required durable write or known deferral owner.
- Use final Memory, not Bookkeeping, as the normal owner for final debrief metadata and debrief TLDR before completing a non-cancelled quest.
- Treat superseded or stale facts as part of the bookkeeping scope.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase bookkeeping` if current-phase inference is unavailable.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Advance only when the shared state is current.
