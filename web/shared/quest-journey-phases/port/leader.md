# Port -- Leader Brief

Use this phase only after the required review or outcome phases are accepted.

Leader actions:
- Keep the board row in `PORTING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/port/assignee.md`.
- Send a separate explicit `/port-changes` instruction.
- Require the assignee report to include `Synced SHAs: sha1,sha2`.
- Require the appropriate post-port verification gate.
- Require `memory catalog show` plus direct inspection of relevant memory files with normal tools such as `rg`, `sed`, and `cat` when prior memory could affect final handoff or debrief accuracy. Require `memory catalog diff` as a freshness check only when memory matters to the Port handoff or memory-update decision and the assignee needs to know what changed since this session last saw the catalog.
- Keep durable memory writing out of normal Port unless you explicitly assign it. If accepted work created or changed memory-worthy durable facts and memory writing is not explicitly in Port scope, require `memory update deferred: <Bookkeeping/curator/reason>` and route focused Bookkeeping or a curator as needed.
- Require a memory statement when memory could be relevant: `memory update deferred: <Bookkeeping/curator/reason>`, `memory update not needed: <reason>`, or `memory updated: <commit>` only when memory writing was explicitly assigned to Port.
- Require final debrief ownership without adding generic leader bookkeeping: every completed non-cancelled quest needs final debrief metadata and debrief TLDR metadata. If the port worker will complete the quest, completion must use `--debrief-file` and `--debrief-tldr-file`; otherwise require a concise final debrief draft plus TLDR draft, or route a focused Bookkeeping phase when the worker cannot produce reliable final debrief metadata.
- Require the assignee to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase port` if current-phase inference is unavailable.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
