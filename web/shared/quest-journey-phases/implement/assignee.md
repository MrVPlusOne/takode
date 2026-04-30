# Implement -- Assignee Brief

You are executing the approved implementation scope for this phase only.

Boundary:
- Make the approved tracked changes and run proportional local verification.
- Gather cheap, local, reversible outcome evidence when that is part of making the scoped result credible.
- Do not take ownership of expensive, risky, long-running, externally consequential, or approval-gated runs; those belong in `EXECUTING`.
- Do not self-review, self-port, or change quest status.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase implement`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write full agent-oriented detail first, then add TLDR metadata that preserves the major points.
- Document changed files or artifacts, why the change matters, verification run, remaining risks, and any human or reviewer feedback addressed.

Deliverable:
- Report what changed, why it matters, what verification passed, and stop.
