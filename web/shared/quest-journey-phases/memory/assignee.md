# Memory -- Assignee Brief

You are performing final non-project-tracked durable-state closure for a substantively accepted quest.

Boundary:
- Confirm the accepted result is already substantively complete and synced when tracked project work required Port.
- Settle final debrief metadata and debrief TLDR metadata, or provide concise drafts if the leader will complete the quest.
- Check quest-note hygiene: phase documentation should be useful, major human/reviewer feedback should be addressed or deliberately left open, and final handoff facts should be easy for future sessions to trust.
- Triage durable memory: consistency with existing file-based memory, memory writes or explicit deferrals, stale-memory checks, and one memory statement.
- Clean up or record non-project-tracked durable state: external artifact records, thread/timer/notification cleanup, dependency notes, current-state handoffs, and follow-up proposals when needed.
- Do not edit tracked project files. If tracked docs, skills, prompts, phase briefs, code, tests, templates, fixtures, changelog, notebooks, or other project repo files need changes, stop and route the gap back to the leader for Implement/Code Review/Port or a follow-up quest.
- Do not port, self-review, run expensive Execute work, or change quest status unless explicitly assigned.

File-based memory:
- Run `memory catalog show` first. Use `memory catalog diff` as a freshness check when you need to know what changed since this session last saw the catalog.
- Inspect plausible catalog-listed Markdown files directly with normal tools such as `rg`, `sed`, and `cat`. Use targeted `rg` under `$(memory repo path)` only when the catalog or known context makes a match plausible. Do not use blind repo-wide search as a substitute for catalog triage.
- Choose the file responsibility by information type: `current/` for live working state, `knowledge/` for durable understanding, `procedures/` for repeatable action, `decisions/` for accepted choices or stable preferences, `references/` for source digests or external pointers, and `artifacts/` for produced external outputs.
- Before editing memory files, acquire the repo-level write lock with `memory lock acquire`. While holding the lock, edit files directly with normal file tools, run `memory lint`, inspect `memory diff`, commit with source trailers via `memory commit`, then release the lock.
- Report exactly one memory statement: `memory updated: <commit>`, `memory update deferred: <reason or curator>`, or `memory update not needed: <reason>`.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase memory`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write the full body first, then add TLDR metadata. Use value-based compression instead of hard length caps: keep final debrief status, quest hygiene decisions, memory files checked, memory commit or deferral, external durable-state changes, cleanup, follow-up routing, residual risks, and completion readiness.
- Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git, Questmaster, or memory already preserves. Include those details only when they explain non-obvious risk, recovery, verification, or external state.
- TLDR metadata should be 1-5 scan-friendly bullets or sentences that preserve conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Do not spend TLDR space on raw SHAs, branch names, command lists, routine paths, or detailed verification mechanics unless that exact detail is the point of the phase.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests.
- If context was compacted during this phase, or if memory confidence is low, reconstruct relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.
- Optional checkpoint: after a valuable nontrivial phase outcome is ready, you may run `takode worker-stream` so the leader can start reading while you finish required paperwork. This does not replace phase documentation, final debrief ownership, or stopping at the phase boundary.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document final debrief metadata status, quest hygiene changes, memory files inspected, memory update or deferral, external durable-state records, cleanup, follow-up routing, and residual risks.

Deliverable:
- Return final durable-state closure, memory statement, final debrief metadata status or drafts, any follow-up routing, and stop.
