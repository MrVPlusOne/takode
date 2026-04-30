# Mental Simulation -- Leader Brief

Use this phase when you need scenario-driven abstract end-to-end correctness validation rather than a generic diff review.

Mental Simulation usually works best after implementation exists, or after a design is concrete enough to execute mentally against historical or realistic examples. Actual `EXECUTING` plus `OUTCOME_REVIEWING` is preferred when end-to-end execution is feasible and appropriate; Mental Simulation is useful when real execution is hard, incomplete, high-stakes, or should be reviewed before running.

Leader actions:
- Keep the board row in `MENTAL_SIMULATING`.
- Include the exact assignee brief path in the instruction: `~/.companion/quest-journey-phases/mental-simulation/assignee.md`.
- Tell fresh reviewers to load the essential skills/context for the target first: `quest` when reviewing quest state or feedback, and `takode-orchestration` when inspecting prior sessions or cross-session history.
- Point the reviewer to the exact scenarios, sessions, quests, workflows, or artifacts to simulate.
- Ask for a scenario-grounded review, not a generic correctness pass.
- Require reviewers to judge relevant phase documentation quality when reviewing a quest, and to add or refresh documentation for the mental-simulation phase with full agent-oriented detail plus TLDR metadata before reporting back.
- Provide only deltas the assignee is unlikely to infer from the phase brief, quest record, current artifacts, or their own context: exact accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, or facts unavailable to that actor. Avoid restating generic closure checklists covered by the brief.
- Revise the remaining Journey if the simulation reveals missing evidence or missing phases.
