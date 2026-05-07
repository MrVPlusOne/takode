# Port -- Assignee Brief

You are syncing accepted git-tracked work back to the main repo.

Boundary:
- Port the accepted tracked changes and report ordered synced SHAs from the main repo.
- Run the required post-port verification after sync.
- Do not invent port commentary for zero-tracked-change quests whose Journey omitted `port`.
- If you are also performing the quest completion handoff, include structured final debrief metadata with `quest complete ... --debrief-file ... --debrief-tldr-file ...`; every completed non-cancelled quest needs both fields.
- If you are not completing the quest, include a concise final debrief draft and debrief TLDR draft in your report, or state that a focused Bookkeeping phase is needed to record final debrief metadata. A Port handoff without submitted metadata or drafts is incomplete.

File-based memory:
- Run `memory catalog show` and inspect relevant memory files directly with normal tools such as `rg`, `sed`, and `cat` when prior memory could affect final handoff, debrief accuracy, or post-port risk. Use `memory catalog diff` as a freshness check when memory matters to the Port handoff or memory-update decision and you need to know what changed since this session last saw the catalog; do not run it routinely for memory-irrelevant ports.
- Port does not normally author durable memory. If accepted work created or changed memory-worthy durable facts and the leader did not explicitly include memory writing in Port scope, report `memory update deferred: <Bookkeeping/curator/reason>`.
- Report `memory update not needed: <reason>` when catalog/direct file inspection or the ported change shows there is no durable memory update to make.
- Report `memory updated: <commit>` only when memory writing was explicitly assigned to Port and completed.
- Include exactly one memory statement in the Port report and phase documentation when memory could be relevant.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase port`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write the full body first, then add TLDR metadata. Use value-based compression instead of hard length caps: keep phase-local decisions, blockers, recovery context, review judgments, user choices, external artifact state, residual risks, and next-phase handoff facts.
- Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git or Questmaster already preserves. Include those details only when they explain non-obvious risk, recovery, verification, or external state.
- TLDR metadata should be 1-5 scan-friendly bullets or sentences that preserve conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Do not spend TLDR space on raw SHAs, branch names, command lists, routine paths, or detailed verification mechanics unless that exact detail is the point of the phase.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests. A Port note normally needs only the required memory statement unless memory writing was explicitly assigned.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.
- Optional checkpoint: after a valuable nontrivial phase outcome is ready, you may run `takode worker-stream` so the leader can start reading while you finish required paperwork. This does not replace phase documentation, final debrief ownership, or stopping at the phase boundary.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document ordered synced SHAs, post-port verification categories, port anomalies, remaining sync risks, memory statement, and whether final debrief metadata was submitted or drafted. Keep the dedicated `Synced SHAs: sha1,sha2` report line separate for leader bookkeeping; omit branch command transcripts unless recovery depended on them.

Deliverable:
- Return synced SHAs, post-port verification results, memory statement, and either final debrief metadata status or a debrief draft, then stop.
