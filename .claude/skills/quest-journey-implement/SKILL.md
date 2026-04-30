---
name: quest-journey-implement
description: "Quest Journey phase: implement. Use when a leader is advancing an approved plan into code, docs, prompts, config, or artifact changes."
---

# Quest Journey Phase: Implement

This phase authorizes the worker to make the approved low-risk changes and gather cheap, local, reversible evidence when that evidence stays inside the approved scope.

Leader actions:
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Send an explicit implementation instruction.
- Include the exact assignee brief path: `~/.companion/quest-journey-phases/implement/assignee.md`.
- Require the worker to add or refresh Implement phase documentation on the quest.
- Tell the worker to stop and report back after implementation.
- Keep the board row in `IMPLEMENTING`.

Worker-visible boundary:
- The worker may edit, test, run low-risk local actions, gather cheap local evidence, and update Implement phase documentation.
- Expensive, risky, long-running, externally consequential, or approval-gated runs belong in `execute`, not `implement`.
- The worker must not run review workflows, port, or change quest status.
- Before reporting back, the worker should document changed files or artifacts, rationale, verification, remaining risks, and addressed feedback with full agent-oriented detail plus TLDR metadata. Prefer `quest feedback add q-N --text-file ... --tldr-file ... --kind phase-summary`; use explicit `--phase implement` or occurrence flags if current-phase inference is unavailable.
- Apply a value filter: include facts future readers or sessions would actually need; avoid boilerplate, facts obvious from the final artifact, and substantial duplication across phases.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.

Exit evidence:
- Worker report, changed files or artifact summary, verification results, and refreshed Implement phase documentation.

Advance when:
- The implementation turn ends and the leader is ready to choose the next review, execute, bookkeeping, or port phase.
