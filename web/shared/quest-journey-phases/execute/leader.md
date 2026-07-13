# Execute -- Leader Brief

Use this phase for expensive, risky, long-running, externally consequential, or approval-gated runs.

Leader actions:
- Keep the board row in `EXECUTING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/execute/assignee.md`.
- Use `EXECUTING` instead of `IMPLEMENTING` when the worker needs more than cheap, local, reversible evidence gathering.
- Make the monitor conditions, stop conditions, and escalation triggers explicit.
- Ensure required approvals are in place before execution starts.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase execute` if current-phase inference is unavailable.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Wait for the execution report before advancing.
- When the execution report arrives, choose the lightest acceptance path that preserves risk:
  - Accept the Execute evidence directly when the run was authorized, bounded, completed within monitor and stop conditions, the phase note is self-contained, outcome criteria are clear, consequences are low-risk or reversible, and independent reviewer judgment would not materially reduce risk.
  - Do a lightweight leader inspection when the evidence is mostly clear and the needed check is small and bounded over existing evidence, such as inspecting cited logs, screenshots, or artifacts; confirming pass/fail output; or verifying simple local cleanup or retention facts. If that inspection exposes ambiguity or broader risk, route deliberately instead of stretching leader inspection.
  - Route to `OUTCOME_REVIEWING` when dedicated independent judgment is materially risk-reducing: high-risk, externally consequential, hard-to-reverse, security/privacy-sensitive, meaningfully user-visible, complex, noisy, subjective, low-context, missing-artifact, contradictory, or insufficient outcomes still need Outcome Review.
- If more approved runs are needed, stay in or return to `EXECUTING`; if the success criteria, scope, or experiment design changed, route back to `ALIGNMENT`.
