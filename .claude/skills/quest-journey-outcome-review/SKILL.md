---
name: quest-journey-outcome-review
description: "Quest Journey phase: outcome-review. Use when the result must be judged by external behavior, metrics, logs, runs, or UX evidence."
---

# Quest Journey Phase: Outcome Review

This phase reviews external or non-code outcomes.

Leader actions:
- Define the evidence to inspect: metrics, logs, datasets, run artifacts, prompt behavior, UX notes, or operational state.
- Keep the board row in `OUTCOME_REVIEWING`.
- Decide whether the result is good enough, needs rework, or requires a Journey revision.

Reviewer-visible boundary:
- Judge whether the observed outcome satisfies the goal.
- Do not collapse this into code quality review when the real question is outcome quality.

Exit evidence:
- A conclusion grounded in external evidence, with concrete pass/fail rationale.

Advance when:
- The leader accepts the outcome or routes findings back into a new phase.
