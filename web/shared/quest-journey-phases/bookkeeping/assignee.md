# Bookkeeping -- Assignee Brief

You are updating durable shared external state.

Boundary:
- Refresh the specified quest records, stream updates, artifact locations, handoff facts, or superseded facts.
- Keep the update precise and durable.
- Do not expand this phase into unrelated implementation or review.

Phase documentation:
- Before reporting back, add or refresh a quest feedback entry documenting this phase when working on a quest. Prefer the phase-scoped primitive with current-phase inference: `quest feedback add q-N --text-file <body> --tldr-file <tldr> --kind phase-summary`.
- If inference is unavailable or ambiguous, use explicit phase flags such as `--phase bookkeeping`, `--phase-position`, `--phase-occurrence`, or `--phase-occurrence-id`; use `--no-phase` only when a flat comment is intentional.
- Write full agent-oriented detail first, then add TLDR metadata that preserves the major points.
- Document shared records updated, superseded facts, external locations, durable handoff facts, and any state that future sessions should trust.

Deliverable:
- Report the shared-state updates you made and stop.
