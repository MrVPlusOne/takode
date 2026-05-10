# Memory -- Leader Brief

Use this mandatory final phase after the quest's substantive result has been accepted and synced when applicable. A quest in `MEMORY` is downstream-unblocking, but it is not fully complete until Memory finishes.

Memory is strict non-project-tracked durable-state closure. It owns final debrief metadata, quest-note hygiene, memory consistency checks, memory writes or explicit deferrals, stale-memory checks, cleanup, external durable-state records, and follow-up routing.

Boundary:
- Keep the board row in `MEMORY`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/memory/assignee.md`.
- Assign ownership explicitly. Use the worker or Port worker for routine closure; use an independent reviewer for policy, provenance, or memory-consistency risk; use a leader or curator for dependency, timer, notification, no-worker, dashboard/state, external-state, artifact-heavy, or cross-quest durable-state closure.
- Do not ask Memory to edit tracked project files. If tracked docs, skills, prompts, phase briefs, code, tests, templates, fixtures, changelog, notebooks, or other project repo files need changes, route back to Implement/Code Review/Port when blocking or create/propose a follow-up when non-blocking.
- If a dependent quest is waiting on this quest, it may start once the parent reaches Memory because the substantive result is accepted or ported. Keep the parent row open until Memory finishes.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: accepted refs, unusual durable-state risk, exact memory files or terms already inspected, external artifact locations, dependency/thread/notification cleanup needs, or known stale-memory concerns.
- Require phase documentation before completion. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase memory` if current-phase inference is unavailable.
- Complete the quest only after final debrief metadata, debrief TLDR metadata, and exactly one memory statement are present.

Do not dispatch Memory just to repeat the Port or review report. Dispatch it to close durable state, verify that the right record owns the durable facts, and route any remaining gaps.
