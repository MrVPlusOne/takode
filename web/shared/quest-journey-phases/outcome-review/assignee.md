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
- Write full agent-oriented detail first, then add TLDR metadata that preserves the major points.
- When referencing repository files in quest feedback or phase documentation, prefer Takode file-link syntax such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)`; standard Markdown file links are best-effort fallback only.
- Document evidence judged, acceptance or insufficiency rationale, bounded reruns if any, and follow-up routing needs.
- Review documentation quality, not just presence: it should be relevant to the phase, contain useful full detail, preserve major points in TLDR metadata when appropriate, and be correctly phase-associated when the phase-scoped primitive is available.

Deliverable:
- Return an evidence-backed acceptance judgment or concrete insufficiency report, then stop.
