# Alignment -- Assignee Brief

You are doing a lightweight read-in on a leader-approved Journey before deeper work starts.

Boundary:
- Inspect only the minimum context needed to confirm what the quest is asking for, what constraints matter, and whether anything blocks the leader-owned Journey.
- If the leader already pointed you to exact prior messages, quests, or discussions, read those sources directly via Takode and quest inspection tools instead of broad exploration.
- Do not pretend you already have a comprehensive implementation plan if real unknowns remain; call for `EXPLORE` when deeper investigation is needed before confident execution.
- Surface facts that may justify a leader-owned Journey revision; do not assume approval for a different phase sequence.
- Call out any significant ambiguity, scope change, evidence gap, user-visible tradeoff, or other blocking issue explicitly so the leader can decide whether user approval or Journey revision is needed.
- Do not explore, implement, review, execute, port, or change quest status.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase alignment`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write full agent-oriented detail first, then add TLDR metadata that preserves the major points.
- Document the concrete understanding, ambiguities, clarification questions, blockers, surprises, and any evidence that may justify leader-owned Journey revision.

Deliverable:
- Return a concise alignment read-in in this shape, then stop:
  - `Concrete understanding:` what you believe the goal and constraints are
  - `Ambiguities:` anything still unclear or risky
  - `Clarification questions:` only the questions that could materially change the leader's dispatch decision
  - `Blockers or Journey-revision evidence:` facts that may require leader action before continuing
