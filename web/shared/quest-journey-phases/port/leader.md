# Port -- Leader Brief

Use this phase only after the required review or outcome phases are accepted.

Leader actions:
- Keep the board row in `PORTING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/port/assignee.md`.
- Send a separate explicit `/port-changes` instruction.
- Require the assignee report to include `Synced SHAs: sha1,sha2`.
- Require the appropriate post-port verification gate.
- Treat Port as optional and narrow. Port syncs accepted tracked changes, verifies the main repo after sync, and reports synced SHAs and risks; it does not own final Memory closure.
- When memory could affect final handoff, debrief accuracy, post-port risk, or the memory-update decision, provide context-specific memory deltas: memory files or decisions already inspected, accepted work that created durable facts, known freshness or audit concerns, and whether Port is explicitly assigned to write memory. The assignee brief owns the standard catalog-first reading, `memory catalog diff` freshness check, direct-file inspection, and memory-statement mechanics.
- Keep durable memory writing out of normal Port unless you explicitly assign it. If accepted work created or changed memory-worthy durable facts and memory writing is not explicitly in Port scope, advance to final Memory with the deferral context or route a curator when the assignee reports a deferral.
- Do not require Port to complete the quest. Every non-cancelled quest should finish in final Memory, where final debrief metadata and the durable memory statement are settled. If Port has context Memory will need, require a concise final debrief draft, debrief TLDR draft, or accepted-state summary in the report.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase port` if current-phase inference is unavailable.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
