# Alignment -- Leader Brief

Use this phase after the user has already approved the initial Journey and scheduling plan.

Leader actions:
- Keep the board row in `PLANNING`.
- Send the standard alignment-only dispatch and include the exact assignee brief path: `~/.companion/quest-journey-phases/alignment/assignee.md`.
- Require the worker to load the quest skill, read and claim the quest, do only the minimal read-in needed to avoid misunderstanding, then stop.
- When the relevant context is already known, point the worker to the exact prior messages, quests, or discussions that matter instead of asking for broad rediscovery.
- When prior memory may matter, tell the worker to run `memory catalog show` for orientation and which memory areas or terms to inspect with direct file tools; memory reads should be visible, not silent injection into the prompt.
- Ask for a lightweight alignment read-in: concrete understanding, ambiguities, clarification questions, blockers, surprises, and evidence that may justify leader-owned Journey revision.
- Require the worker to add or refresh phase documentation before the phase handoff. It should use phase-scoped quest feedback with full agent-oriented detail plus TLDR metadata when working on a quest, falling back to explicit `--phase alignment` if current-phase inference is unavailable.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Do not demand a supposedly comprehensive implementation plan here; if real unknowns emerge, route to `EXPLORE` instead of pretending implementation is already fully planned.
- Review the returned alignment read-in yourself first. If it stays within the approved Journey and introduces no significant ambiguity, scope change, Journey revision, user-visible tradeoff, or other blocking issue, approve the next phase yourself.
- Escalate back to the user only when the read-in surfaces one of those issues or otherwise genuinely needs user approval.
- If the worker surfaces Journey-revision evidence, decide whether to revise the board before advancing and whether that revision needs fresh user approval.
