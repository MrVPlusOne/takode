# Outcome Review -- Leader Brief

Use this phase when the right evidence lives in outcomes rather than source diffs.

Leader actions:
- Keep the board row in `OUTCOME_REVIEWING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/outcome-review/assignee.md`.
- Use this as a reviewer-owned acceptance phase after the worker has usually produced the outcome evidence first.
- Tell fresh reviewers to load the essential skills/context for the target first: `quest` when reviewing quest state or feedback, and `takode-orchestration` when inspecting prior sessions or cross-session history.
- Point the reviewer to the exact logs, metrics, artifacts, behaviors, or UX evidence to judge.
- Ask for an outcome judgment tied to concrete evidence.
- Keep the reviewer scoped to judging sufficiency of the existing evidence, with only small bounded reruns or repros when needed for acceptance.
- Require reviewers to judge phase documentation quality, not just presence: phase relevance, useful full detail, TLDR completeness when appropriate, and correct phase association when the phase-scoped primitive is available.
- Require the reviewer to add or refresh documentation for the outcome-review phase before reporting back, using phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- If the evidence is insufficient, route back to `IMPLEMENTING` when behavior or code must change, to `EXECUTING` when more approved runs are needed, or to `ALIGNMENT` when the success criteria, scope, or experiment design changed.
