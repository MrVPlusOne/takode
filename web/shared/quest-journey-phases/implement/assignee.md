# Implement -- Assignee Brief

You are executing the approved implementation scope for this phase only.

Boundary:
- Make the approved tracked changes and run proportional local verification.
- Do the normal investigation, root-cause analysis, code/design reading, and test planning needed to complete the approved scope.
- Gather cheap, local, reversible outcome evidence when that is part of making the scoped result credible.
- Do not take ownership of expensive, risky, long-running, externally consequential, or approval-gated runs; those belong in `EXECUTING`.
- Do not self-review, self-port, or change quest status.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase implement`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write the full body first, then add TLDR metadata. Use value-based compression instead of hard length caps: keep phase-local decisions, blockers, recovery context, review judgments, user choices, external artifact state, residual risks, and next-phase handoff facts.
- Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git or Questmaster already preserves. Include those details only when they explain non-obvious risk, recovery, verification, or external state.
- TLDR metadata should be 1-5 scan-friendly bullets or sentences that preserve conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Do not spend TLDR space on raw SHAs, branch names, command lists, routine paths, or detailed verification mechanics unless that exact detail is the point of the phase.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests. A phase note normally needs only one memory outcome line or memory commit pointer when memory matters.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.
- Optional checkpoint: after a valuable nontrivial phase outcome is ready, you may run `takode worker-stream` so the leader can start reading while you finish required paperwork. This does not replace phase documentation, final debrief ownership, or stopping at the phase boundary.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document the behavior or artifact change, key design choices, verification categories, remaining risks, and any human or reviewer feedback addressed. Mention files only as entry points or when their role is non-obvious; do not narrate the diff file by file.

Deliverable:
- Report what changed, why it matters, what verification passed, and stop.
