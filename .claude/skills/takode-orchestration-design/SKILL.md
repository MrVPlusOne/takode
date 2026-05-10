---
name: takode-orchestration-design
description: "Use when designing, reviewing, or changing Takode leader/worker/reviewer orchestration instructions, Quest Journey phase briefs, leader dispatch templates, or related project agent workflow docs. Do not use for ordinary quest execution, normal code review, or phase work that only follows existing instructions."
---

# Takode Orchestration Design

Use this skill to decide where orchestration guidance belongs. Keep it as a placement rubric, not a phase manual. Operational details stay in the Quest Journey phase briefs and the `takode-orchestration` skill.

## Core Rule

Reusable workflow behavior belongs in reusable instructions. Leader handoffs should contain only context-dependent deltas that benefit from leader-specific knowledge.

## Placement Rubric

| Guidance type | Put it here |
|---------------|-------------|
| Behavior every assignee or reviewer in a phase should follow | The relevant assignee or leader phase brief |
| Cross-cutting orchestration design principle | A focused skill or shared orchestration doc |
| CLI command syntax, board flow, herd events, or phase transition mechanics | `takode-orchestration` docs or the relevant operational skill |
| Context-dependent facts, accepted refs, unusual risks, user decisions, stop conditions, artifact paths, or constraints | Quest description, quest feedback, or the leader's phase handoff |
| Temporary instruction for one quest or one phase occurrence | Quest feedback or the dispatch message only |

## Examples

Reusable guidance:
- Code reviewers should inspect the quest record, define relevant review aspects, cover landing risk, and judge phase documentation quality.
- Execute assignees should follow approved scope, monitor and stop conditions, resource leases, cleanup, artifact retention, and phase documentation requirements.
- Port assignees should use the approved port workflow, report synced SHAs, run post-port verification, and preserve accepted-state context for final Memory.
- Memory-focused phase instructions can standardize catalog-first reading, direct file inspection, and `memory catalog diff` as a freshness check when relevant.

Leader-specific deltas:
- The exact accepted commit range or artifact set to review.
- A known stale live server, blocked resource lease, safety warning, or nonstandard validation plan.
- The memory files or prior decisions the leader already inspected and found relevant.
- Whether the assignee should complete the quest, draft final debrief metadata, route final Memory, or use compatibility Bookkeeping for targeted intermediate durable state.

## Source-Of-Truth Check

Before landing orchestration guidance:

1. Identify the surface future agents actually load: project skill source, phase brief source, live installed phase brief, generated prompt, or shared doc.
2. Update that surface, not only a leader handoff or a tracked doc that is not loaded.
3. Avoid new project skills under legacy `.codex/skills`. Use `.claude/skills` for canonical Claude-facing project skills and `.agents/skills` only when a distinct non-Claude source is needed.
4. Add or update a focused test or smoke check when discovery, symlinking, generated prompts, or live phase-brief sync could drift.

If a proposed change only rephrases existing phase guidance without reducing handoff burden, fixing discoverability, or clarifying responsibility, leave it out.
