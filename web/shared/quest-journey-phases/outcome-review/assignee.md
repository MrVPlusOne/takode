# Outcome Review -- Assignee Brief

You are performing reviewer-owned acceptance over external or non-code results.

Setup:
- Load the essential skills and context for the outcome target before judging it.
- If reviewing a quest outcome, load the `quest` skill and inspect the quest record, feedback, status, summary, and verification evidence directly.
- If the evidence lives in prior sessions, worker reports, execution logs, or cross-session handoffs, load `takode-orchestration` and inspect the referenced messages or sessions directly.
- Prefer explicitly referenced logs, metrics, artifacts, quest records, and session messages over broad board inspection. Query board state only when current Journey state affects the outcome judgment.

Boundary:
- Judge the specified outcome evidence directly: metrics, logs, artifacts, prompt behavior, or UX notes.
- Do not substitute a source-only review when the requested evidence is external behavior.
- You may rerun only small bounded checks or repros needed to judge sufficiency; do not become the primary experiment owner, root-cause investigator, or repeated iteration loop.
- If the evidence is insufficient, report the concrete gap and what kind of follow-up is needed.
- Do not port or change quest status.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this review phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind review`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase outcome-review`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write the full body first, then add TLDR metadata. Use value-based compression instead of hard length caps: keep phase-local decisions, blockers, recovery context, review judgments, user choices, external artifact state, residual risks, and next-phase handoff facts.
- Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git or Questmaster already preserves. Include those details only when they explain non-obvious risk, recovery, verification, or external state.
- TLDR metadata should be 1-5 scan-friendly bullets or sentences that preserve conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Do not spend TLDR space on raw SHAs, branch names, command lists, routine paths, or detailed verification mechanics unless that exact detail is the point of the phase.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests. A phase note normally needs only one memory outcome line or memory commit pointer when memory matters.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.
- Optional checkpoint: after a valuable nontrivial phase outcome is ready, you may run `takode worker-stream` so the leader can start reading while you finish required paperwork. This does not replace phase documentation, final debrief ownership, or stopping at the phase boundary.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document the evidence judged, ACCEPT or insufficiency rationale, bounded reruns if any, residual risks, and follow-up routing needs. Avoid turning the note into a second Execute transcript.
- Review documentation quality, not just presence: it should be relevant to the phase, contain useful full detail, preserve major points in TLDR metadata when appropriate, and be correctly phase-associated when the phase-scoped primitive is available.
- If the leader asked for final completion support because this is a no-Port or zero-tracked-change outcome, include `Final debrief draft:` and `Debrief TLDR draft:` in the report when you can draft them reliably from accepted evidence; otherwise state that a focused Bookkeeping phase is needed before quest completion.

Deliverable:
- Return an evidence-backed acceptance judgment or concrete insufficiency report, then stop.
