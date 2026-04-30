# Port -- Leader Brief

Use this phase only after the required review or outcome phases are accepted.

Leader actions:
- Keep the board row in `PORTING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/port/assignee.md`.
- Send a separate explicit `/port-changes` instruction.
- Require the assignee report to include `Synced SHAs: sha1,sha2`.
- Require the appropriate post-port verification gate.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase port` if current-phase inference is unavailable.
