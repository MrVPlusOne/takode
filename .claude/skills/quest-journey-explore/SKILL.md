---
name: quest-journey-explore
description: "Quest Journey phase: explore. Use when a leader needs evidence or unknowns resolved before deciding how to proceed."
---

# Quest Journey Phase: Explore

This phase gathers unknown information without making the target-state change.

Leader actions:
- Tell the worker what unknowns to resolve and what evidence will let you choose the next step.
- Include the exact assignee brief path: `~/.companion/quest-journey-phases/explore/assignee.md`.
- Keep the board row in `EXPLORING`.
- Revise the remaining Journey if new risk, evidence, or external-state needs appear.

Worker-visible boundary:
- The worker may inspect code, logs, configs, artifacts, and run small reversible probes.
- The worker must not make major target-state changes, port, or change quest status.
- Before reporting back, the worker should document the Explore phase on the quest with full agent-oriented detail plus TLDR metadata. Prefer `quest feedback add q-N --text-file ... --tldr-file ... --kind phase-finding`; use explicit `--phase explore` or occurrence flags if current-phase inference is unavailable.

Exit evidence:
- A concise evidence summary, concrete findings, blockers, surprises, implementation considerations, and evidence that may justify leader-owned Journey revision.

Advance when:
- The leader has enough evidence to choose the next phase or revise the Journey.
