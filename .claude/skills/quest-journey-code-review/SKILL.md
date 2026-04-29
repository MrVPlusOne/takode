---
name: quest-journey-code-review
description: "Quest Journey phase: code-review. Use when tracked code or tracked artifacts need quality, correctness, and regression review."
---

# Quest Journey Phase: Code Review

This phase reviews tracked code or tracked artifacts for landing risk.

Leader actions:
- Assign a reviewer and define the concrete review scope.
- Include the exact assignee brief path: `~/.companion/quest-journey-phases/code-review/assignee.md`.
- Tell fresh reviewers to load the essential skills/context for the target first: `quest` when reviewing quest state or feedback, and `takode-orchestration` when inspecting prior sessions or cross-session history.
- Expect a comprehensive landing-risk review of correctness, regressions, tests, maintainability, quest hygiene, implementation completeness, and meaningful evidence, while keeping reviewers out of implementation and porting.
- Send findings back to the worker when rework is needed. If the worker must change code after review, require the worker to commit the current worktree state, make the fixes in a separate follow-up commit, and send the changed worktree back to Code Review only after that checkpoint exists. This lets the reviewer inspect a clean incremental diff and does not apply to purely read-only follow-up review discussion.
- Keep the board row in `CODE_REVIEWING`.

Reviewer-visible boundary:
- Load essential target context before judging: `quest` for quest context, and `takode-orchestration` for prior messages, sessions, or cross-session history.
- Start from the tracked diff, quest record, worker report, and verification evidence. Inspect untracked files when status shows they are part of the worker's change.
- Before judging the result, write down the review aspects that are relevant for this change. Cover correctness, regression risk, tests, maintainability, quest hygiene, implementation completeness, and meaningful evidence review unless a category is genuinely irrelevant; say why skipped categories are irrelevant.
- Report substantive bugs, missing coverage, unsupported verification, design/maintainability risks, incomplete implementation, and quest-hygiene gaps that matter for landing.
- Do not become the implementer, porter, or redesign owner. You may directly fix only small quest-hygiene issues already supported by the workflow, such as stale addressed flags, refreshable summaries, or verification checks backed by evidence.

Exit evidence:
- Reviewer acceptance or concrete findings that the worker must address.

Advance when:
- The reviewer accepts, or the leader has routed the findings back through the rework loop and re-run the review.
