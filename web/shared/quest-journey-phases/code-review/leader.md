# Code Review -- Leader Brief

Use this phase when tracked changes need landing-risk review.

Leader actions:
- Keep the board row in `CODE_REVIEWING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/code-review/assignee.md`.
- Tell fresh reviewers to load the essential skills/context for the target first: `quest` when reviewing quest state or feedback, and `takode-orchestration` when inspecting prior sessions or cross-session history.
- Assign a reviewer and define the concrete review scope.
- Expect a comprehensive landing-risk review of correctness, regressions, tests, maintainability, quest hygiene, implementation completeness, and meaningful evidence, while keeping reviewers out of implementation and porting.
- Require reviewers to judge phase documentation quality, not just presence: phase relevance, useful full detail, TLDR completeness when appropriate, and correct phase association when the phase-scoped primitive is available.
- Require the reviewer to add or refresh documentation for the review phase before reporting back, using phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Send findings back through the rework loop when needed. If the worker must change code after review, require the worker to commit the current worktree state, make the fixes in a separate follow-up commit, and send the changed worktree back to Code Review only after that checkpoint exists. This lets the reviewer inspect a clean incremental diff and does not apply to purely read-only follow-up review discussion.
- Advance only after the reviewer accepts or the rework loop is complete.
