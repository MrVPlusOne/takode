# Alignment -- Assignee Brief

You are doing a concise read-in on a leader-authorized Journey before deeper work starts. The output is a leader-verification packet, not a planning report.

Boundary:
- Inspect only the minimum context needed to confirm what the quest is asking for, what constraints matter, and whether anything blocks the leader-owned Journey.
- If the leader already pointed you to exact prior messages, quests, or discussions, read those sources directly via Takode and quest inspection tools instead of broad exploration.
- If the assignment, quest, or post-compaction recovery context points to relevant file-based memory, run `memory catalog show` visibly for orientation, inspect relevant memory files directly with normal tools such as `rg`, `sed`, and `cat`, and mention any memory files that materially affected the read-in.
- Do not pretend you already have a comprehensive implementation plan if real unknowns remain; call for `EXPLORE` when deeper investigation is needed before confident execution.
- Surface facts that may justify a leader-owned Journey revision; do not assume approval for a different phase sequence.
- Call out any significant ambiguity, scope change, evidence gap, user-visible tradeoff, or other blocking issue explicitly so the leader can decide whether user approval or Journey revision is needed.
- Do not include broad implementation plans, exhaustive evidence inventories, routine file lists, long command or test details, or repeated quest history unless that detail explains a blocker, misunderstanding risk, or Journey-revision need.
- Do not explore, implement, review, execute, port, or change quest status.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase alignment`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write the phase note in the same concise shape as the read-in. Keep concrete understanding, key constraints, real ambiguities or questions, blockers or surprises, and Journey-revision evidence; omit generic investigation narration.
- TLDR metadata should be 1-5 scan-friendly bullets or sentences that preserve the major Alignment conclusions and risks. Do not spend TLDR space on command lists, routine paths, repeated quest history, or detailed verification mechanics unless that exact detail is the point of the phase.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests. Non-Memory phases should not add routine `memory update not needed` statements. Include memory-specific evidence only when material, such as `memory updated`, `memory update deferred`, durable user decisions/preferences, memory files inspected for a reason, artifact manifests, or other facts final Memory needs.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.
- Final chat handoff should be much shorter than the phase note. Treat the Questmaster phase feedback as the source of truth for detailed results, recommended next action, blockers, evidence, findings, and handoff facts. In chat, name the phase feedback index and include only the concise outcome/verdict plus urgent blockers, safety facts, or deltas the leader must see immediately.
- Optional checkpoint: after a valuable nontrivial phase outcome is ready, you may run `takode worker-stream` so the leader can start reading while you finish required paperwork. This does not replace phase documentation, final debrief ownership, or stopping at the phase boundary.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document the concrete understanding, key constraints, real ambiguities or questions, blockers or surprises, and any evidence that may justify leader-owned Journey revision. Avoid prewriting an implementation plan unless that plan is the blocker or Journey-revision evidence.

Deliverable:
- Add or refresh the Alignment note, then return only a compact pointer to that feedback index plus any blocker or Journey-revision fact that needs immediate leader routing. If the leader explicitly asks for the read-in in chat, keep it concise and avoid duplicating the phase note:
  - `Concrete understanding:` what you believe the goal and constraints are
  - `Ambiguities:` anything still unclear or risky, including key constraints you may have missed
  - `Clarification questions:` only the questions that could materially change the leader's dispatch decision
  - `Blockers or Journey-revision evidence:` facts that may require leader action before continuing
