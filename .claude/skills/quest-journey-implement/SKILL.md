---
name: quest-journey-implement
description: "Quest Journey phase: implement. Use when a leader is advancing an approved plan into code, docs, prompts, config, or artifact changes."
---

# Quest Journey Phase: Implement

This phase authorizes the worker to make the approved low-risk changes and gather cheap, local, reversible evidence when that evidence stays inside the approved scope. It includes the normal investigation, root-cause analysis, code/design reading, and test planning needed to complete the approved fix, docs change, config change, prompt change, or artifact change.

Leader actions:
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Send an explicit implementation instruction.
- Include the exact assignee brief path: `~/.companion/quest-journey-phases/implement/assignee.md`.
- Require the worker to add or refresh Implement phase documentation on the quest.
- Tell the worker to stop and report back after implementation.
- Keep the board row in `IMPLEMENTING`.
- Do not add a separate `explore` phase merely for routine pre-implementation reading; ask what that extra phase contributes over doing the work inside `implement`.

Worker-visible boundary:
- The worker may inspect code/design, diagnose root causes, plan tests, edit, test, run low-risk local actions, gather cheap local evidence, and update Implement phase documentation.
- Expensive, risky, long-running, externally consequential, or approval-gated runs belong in `execute`, not `implement`.
- The worker must not run review workflows, port, or change quest status.
- Before reporting back, the worker should document changed files or artifacts, rationale, verification, remaining risks, and addressed feedback with full agent-oriented detail plus TLDR metadata. Prefer `quest feedback add q-N --text-file ... --tldr-file ... --kind phase-summary`; use explicit `--phase implement` or occurrence flags if current-phase inference is unavailable.
- The TLDR should be 1-5 scan-friendly bullets or sentences preserving conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Keep raw SHAs, branch names, exhaustive command lists, routine paths, and detailed verification mechanics out of TLDR space unless central to understanding.
- Use value-based compression instead of hard length caps. Keep phase-local decisions, blockers, recovery context, review judgments, user choices, external artifact state, residual risks, and next-phase handoff facts. Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git or Questmaster already preserves.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.

Exit evidence:
- Worker report, changed files or artifact summary, verification results, and refreshed Implement phase documentation.

Advance when:
- The implementation turn ends and the leader is ready to choose the next review, execute, bookkeeping, or port phase.
