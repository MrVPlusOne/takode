---
name: takode-agent-run-workflows
description: "Use when designing or planning a new Takode feature, workflow, setup, onboarding, migration, import, upgrade step, repair or recovery flow, or a new Settings section, wizard or dialog, and deciding between dedicated UI and programmatic logic versus written instructions an agent follows. Prefer agent-run workflows for rarely used, failure-prone tasks, with UI or code only as the entry point that hands the task to a session."
---

# Agent-Run Workflows for Rare Features

## Core Rule

For features and workflows that are used rarely, especially where many things can go wrong or the environment varies, prefer written instructions that an agent follows over dedicated UI and rigid programmatic logic. UI or code becomes the entry point: it notices the need or offers the action, then hands the task to a session that follows the instructions.

Typical candidates: one-time setup, migrations and imports after an upgrade, moving data or the coordinator between machines, adding a host, repairing broken state, and recovery from unusual failures.

## Why

- Rare paths get little real use, so dedicated UI for them stays clunky and under-tested, and each unexpected state becomes a dead end or another branch of logic.
- An agent can inspect the actual situation, handle cases nobody anticipated, explain what it found and ask the user when a decision is genuinely theirs.
- Instructions are cheap to write and to change as the feature evolves; UI and branching logic are expensive to build, test and keep working.

## Choosing

Lean toward an agent-run workflow when the task is infrequent (once per machine, upgrade or user), depends on the environment, needs judgment or a conversation with the user, and a few minutes of agent time is acceptable.

Lean toward dedicated UI and code when the action is frequent or everyday, needs instant feedback, must work when no agent is available, or is core product behavior. Read-only views of state are cheap and usually still belong in the UI.

Mix them when part of the task is deterministic, safety-critical or easy to get wrong by hand: keep that part as a tested script, command or API the agent calls, and let the agent handle everything around it. Moving the coordinator is the model: `scripts/coordinator-handoff.ts` does the data move, and `docs/moving-the-coordinator.md` guides the rest.

## Practical Application

- Write the instructions as facts and preferences: the goal, how the system works, what must not be touched, what needs the user's approval, backups and recovery, and how to tell the task succeeded. Avoid rigid step-by-step scripts that break on the first surprise.
- Put them where agents will find them: usually a repo doc the entry point names. Add a skill only when agents must discover the guidance on their own, since global skills reach every session. Either way, make it reach both Claude and Codex sessions.
- Keep the entry point thin: a notice, button or message that starts or offers a session with a short prompt naming the instructions, rather than a wizard that reimplements the workflow.
- Agent-run work keeps every existing safety rule: durable user data safety, permission gates and approval for destructive or irreversible steps still apply.
- When a plan adds substantial UI or programmatic logic for a rarely used workflow, raise this choice before building it.
