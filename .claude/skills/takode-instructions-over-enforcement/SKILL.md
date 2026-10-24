---
name: takode-instructions-over-enforcement
description: "Use when designing or changing how Takode steers agent behavior: server, CLI or API checks, refusals, rejections, 403s, guards, validations, limits, quotas, forced restarts or replacements on agent actions, nudges and reminders, or a new agent role or agent-facing system (workers, leaders, reviewers, Scribes), and when deciding whether to tell agents what to do or make code enforce it. Prefer clear instructions; use detection only for mistakes agents find hard to avoid or would not notice, and report it as a warning; refuse only for real safety needs."
---

# Instructions Over Enforcement

## Core Rule

Steer agents with clear instructions: what to do, when, and why. Add programmatic detection only for things agents find very hard to get right or would get wrong without noticing, and report what it finds to the agent as a warning it can act on, not a refusal. Refuse an agent's action only for a real safety need, and say in the design which one.

## Why

- Agents follow clear instructions well and use judgment in cases nobody foresaw. A refusal has no judgment: it blocks the unforeseen correct case as firmly as the mistake it was written for.
- A check that is too strict or simply wrong is worse than none. The agent does the right thing, is refused, and then retries in a loop, works around the rule or quietly settles for worse output, and nobody notices.
- A warning keeps what detection is good for: the agent learns about a likely mistake and still decides whether it really is one.
- Every rule in code must be built, tested and kept in step with the instructions. Instructions are cheap to change as the design evolves.

## Worked Example: The Scribe

The first Scribe (the agent that keeps a leader's topic pages) shipped with server refusals: it could not save lasting requirements to its grouping instructions, claim a quest, take quest ownership or be put on a board row; a page write was refused when a quote did not match the conversation; and the server replaced the Scribe once its context passed 100K tokens. The user's review asked to drop most of them:

- The quote check was wrong in a case nobody foresaw: it could not read quotes from comment-only user messages, so it refused a correct quote, and the Scribe fell back to a paraphrase. Only a live check caught it.
- The other refusals guarded against things one sentence in the brief covers: tell the Scribe when it should save notes and that it never takes quest work, and tell leaders not to give it any.
- The forced replacement redid what the backend's normal compaction already does, and added problems of its own: a replacement started fresh and had to be retold the user's instructions.
- Where detection does help (the Scribe ends a turn without doing what it was asked), the user wanted one nudge, then a note to the leader, instead of a refusal or a loop.

## Practical Application

- **Start with the instructions.** For each behavior you want, first write where the agent will read it: its brief, phase brief, skill, command help or injected message. Add code only for what instructions demonstrably can't carry.
- **Detect only hard or invisible mistakes.** Good candidates: facts the agent can't easily see (a stale page, a missing commit, unaddressed feedback), and slips that cost a lot when unnoticed. Not candidates: anything the agent knows when told, or style and policy preferences.
- **Report detection as a warning.** Put it where the agent will see it when it matters, usually the output of the command it just ran or a message at turn end. Say what looks wrong and what to do about it, and let the action go through. The `quest` CLI's "Warning: unaddressed human feedback ... mark resolved with quest address" is the shape.
- **Cap repeated nudges.** Nudge once; if the agent still doesn't act, tell its leader or the user. Never build a loop that repeats until the agent complies.
- **Reserve refusals for real safety needs:** durable user data, security and access boundaries, irreversible or external side effects, shared resources and data integrity (such as refusing a write based on a stale read), or an explicit user or repository rule. The personal to-do approval rule is one: the user asked for it so nothing they track gets lost.
- **Make a needed refusal actionable.** Say what was refused, why, and how to proceed (the to-do refusal names `--authorized-by`). An agent that can't tell how to satisfy a refusal retries or works around it. Where possible, design so the wrong action never comes up (a session that never shows up as a worker needs no claim refusal).
- **Prefer the agent's normal mechanisms** (compaction, idle detection, herd events, ordinary reading tools) over special limits, forced restarts or replacements built for one role.
- **Recheck existing guards when you touch them.** Keep one that serves a safety need; otherwise propose turning it into a warning or an instruction. Never drop a safety rule without knowing why it was added.

This is the system-side counterpart of the requirements-versus-precautions instruction every session gets: agents should not invent gates for their own work, and Takode should not invent refusals for agents. Mandatory safety rules (the CLAUDE.md "Durable User Data Safety" section, permission gates, resource leases, browser login) stay as they are.
