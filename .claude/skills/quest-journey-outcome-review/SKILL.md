---
name: quest-journey-outcome-review
description: "Quest Journey phase: outcome-review. Use when a reviewer should make an acceptance judgment on external behavior, metrics, logs, runs, or UX evidence."
---

# Quest Journey Phase: Outcome Review

This phase is a reviewer-owned acceptance pass over external or non-code outcomes.

Leader actions:
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Define the evidence to inspect: metrics, logs, datasets, run artifacts, prompt behavior, UX notes, or operational state.
- Include the exact assignee brief path: `~/.companion/quest-journey-phases/outcome-review/assignee.md`.
- Tell fresh reviewers to load the essential skills/context for the target first: `quest` when reviewing quest state or feedback, and `takode-orchestration` when inspecting prior sessions or cross-session history.
- Keep the board row in `OUTCOME_REVIEWING`.
- Treat this as an acceptance phase after the worker has usually produced the evidence first.
- Require reviewers to judge phase documentation quality, not just presence: phase relevance, useful full detail, TLDR completeness where appropriate, and correct phase association when the primitive is available.
- If Outcome Review is the final planned phase before a no-Port or zero-tracked-change completion, final debrief metadata is leader-owned: draft the final debrief plus debrief TLDR from accepted evidence, ask the reviewer for `Final debrief draft:` and `Debrief TLDR draft:`, or route focused Bookkeeping. Do not complete a non-cancelled quest without both fields.
- Decide whether the result is sufficient, needs more approved runs, needs behavior/code changes, or requires a Journey revision.

Reviewer-visible boundary:
- Load essential target context before judging: `quest` for quest context, and `takode-orchestration` for prior messages, sessions, or cross-session history.
- Judge whether the observed outcome satisfies the goal.
- Do not collapse this into code quality review when the real question is outcome quality.
- You may rerun only small bounded checks or repros needed for acceptance; do not become the primary experiment owner or repeated iteration loop.
- If the leader asks for final completion support, include `Final debrief draft:` and `Debrief TLDR draft:` when they can be drafted reliably from accepted evidence; otherwise say a focused Bookkeeping phase is needed before completion.
- Before reporting back, the reviewer should document the Outcome Review phase on the quest with evidence judged, acceptance or insufficiency rationale, bounded reruns, follow-up routing, and TLDR metadata. Prefer `quest feedback add q-N --text-file ... --tldr-file ... --kind review`; use explicit `--phase outcome-review` or occurrence flags if current-phase inference is unavailable.
- The TLDR should be 1-5 scan-friendly bullets or sentences preserving conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Keep raw SHAs, branch names, exhaustive command lists, routine paths, and detailed verification mechanics out of TLDR space unless central to understanding.
- Use value-based compression instead of hard length caps. Keep phase-local decisions, blockers, recovery context, review judgments, user choices, external artifact state, residual risks, and next-phase handoff facts. Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git or Questmaster already preserves.
- Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests.
- If context was compacted during this phase, or if memory confidence is low, reconstruct the relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, use working memory and current artifacts instead of unnecessary session archaeology.

Exit evidence:
- A conclusion grounded in external evidence, with concrete pass/fail rationale and any specific gap to route back.

Advance when:
- The leader accepts the outcome or routes findings back to `implement`, `execute`, or `alignment`.
