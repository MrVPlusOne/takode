# Code Review -- Leader Brief

Use this phase when tracked changes need landing-risk review.

Leader actions:
- Keep the board row in `CODE_REVIEWING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/code-review/assignee.md`.
- Tell fresh reviewers to load the essential skills/context for the target first: `quest` when reviewing quest state or feedback, and `takode-orchestration` when inspecting prior sessions or cross-session history.
- Assign a reviewer and define the concrete review scope.
- Expect a comprehensive landing-risk review of correctness, regressions, tests, maintainability, quest hygiene, implementation completeness, and meaningful evidence, while keeping reviewers out of implementation and porting.
- Send findings back through the rework loop when needed. If the worker must change code after review, require the worker to commit the current worktree state, make the fixes in a separate follow-up commit, and send the changed worktree back to Code Review only after that checkpoint exists. This lets the reviewer inspect a clean incremental diff and does not apply to purely read-only follow-up review discussion.
- Advance only after the reviewer accepts or the rework loop is complete.
