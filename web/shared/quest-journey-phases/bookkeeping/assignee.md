# Bookkeeping -- Assignee Brief

You are updating durable shared external state.

Boundary:
- Refresh the specified quest records, stream updates, artifact locations, handoff facts, or superseded facts.
- Use Bookkeeping for cross-phase or external durable state beyond normal phase notes: consolidated summaries, final debrief metadata after port when the port worker could not reliably create it, verification checklist reconciliation, external docs or links, superseded facts, notification cleanup, thread cleanup, file-based memory updates, or shared-state updates.
- When Bookkeeping is assigned to finish completion metadata, produce or apply both the final debrief and debrief TLDR. Completion remains incomplete until both are present on the completed non-cancelled quest.
- Keep the update precise and durable.
- Do not duplicate normal phase documentation from the phase that produced the facts.
- Do not expand this phase into unrelated implementation or review.

File-based memory:
- When the assigned durable state belongs in memory, use the session-space memory repo rather than adding another quest-only summary. Normal `memory` commands auto-create the repo for the current server/session space, so do not run a separate init step. Choose the file responsibility by information type: `current/` for live working state, `knowledge/` for durable understanding, `procedures/` for repeatable action, `decisions/` for accepted choices or stable preferences, `references/` for source digests or external pointers, and `artifacts/` for produced external outputs.
- Run `memory catalog show` first, and use `memory catalog diff` as a freshness check when you need to know what changed since this session last saw the catalog. Then inspect relevant existing memory files directly with normal tools such as `rg`, `sed`, and `cat` so the update works with existing memory instead of duplicating it. Catalog diff does not replace direct file inspection and is not a reason for blind repo-wide search.
- Before editing memory files, acquire the repo-level write lock with `memory lock acquire`. While holding the lock, edit files directly with normal file tools, run `memory lint`, inspect `memory diff`, commit with source trailers via `memory commit`, then release the lock.
- Report exactly one memory statement when memory was in scope: `memory updated: <commit>`, `memory update deferred: <reason or curator>`, or `memory update not needed: <reason>`.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase bookkeeping`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write the full body first, then add TLDR metadata. Use value-based compression instead of hard length caps: keep phase-local decisions, blockers, recovery context, review judgments, user choices, external artifact state, residual risks, and next-phase handoff facts.
- Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git or Questmaster already preserves. Include those details only when they explain non-obvious risk, recovery, verification, or external state.
- TLDR metadata should be 1-5 scan-friendly bullets or sentences that preserve conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Do not spend TLDR space on raw SHAs, branch names, command lists, routine paths, or detailed verification mechanics unless that exact detail is the point of the phase.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests. A phase note normally needs only one memory outcome line or memory commit pointer when memory matters.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.
- Optional checkpoint: after a valuable nontrivial phase outcome is ready, you may run `takode worker-stream` so the leader can start reading while you finish required paperwork. This does not replace phase documentation, final debrief ownership, or stopping at the phase boundary.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document shared records updated, superseded facts, external locations, durable handoff facts, and any state that future sessions should trust. Avoid replaying the whole quest when a targeted consolidation or memory pointer is enough.

Deliverable:
- Report the shared-state updates you made and stop.
