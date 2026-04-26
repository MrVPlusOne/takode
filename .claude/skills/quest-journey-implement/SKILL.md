---
name: quest-journey-implement
description: "Quest Journey phase: implement. Use when a leader is advancing an approved plan into code, docs, prompts, config, or artifact changes."
---

# Quest Journey Phase: Implement

This phase authorizes the worker to make the approved low-risk changes.

Leader actions:
- Send an explicit implementation instruction.
- Require the worker to add or refresh the consolidated human-readable quest summary comment.
- Tell the worker to stop and report back after implementation.
- Keep the board row in `IMPLEMENTING`.

Worker-visible boundary:
- The worker may edit, test, run low-risk local actions, and update the quest summary.
- The worker must not run review workflows, port, or change quest status.

Exit evidence:
- Worker report, changed files or artifact summary, verification results, and refreshed quest summary.

Advance when:
- The implementation turn ends and the leader is ready to choose the next review, bookkeeping, or execution phase.
