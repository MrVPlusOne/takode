---
name: leader-dispatch
description: "Dispatch workflow for leader/orchestrator sessions. Use when dispatching a quest to a worker, choosing which worker to assign, spawning new worker sessions, or deciding whether to reuse vs spawn. Triggers: 'dispatch', 'send quest', 'assign worker', 'spawn worker', 'which worker', 'reuse or spawn'."
---

# Leader Dispatch Workflow

Use this skill before choosing a worker, spawning, reusing, queueing, or sending the first worker message for a quest.

This is the hot path. Keep worker grounding in the quest record, phase-specific behavior in the phase briefs, and CLI mechanics in `takode-orchestration` / `board-usage.md`.

## Read On Demand

Read these only when the trigger applies:

- `references/edge-cases.md`: human feedback rework, stale in-flight completions, screenshots/images, worker or reviewer file links shown to the user, 413/payload recovery, memory-specific dispatch deltas, or final completion-summary details.
- `references/phase-handoff-examples.md`: you need concrete phrasing examples for phase follow-ups, rework, review, Port, or investigation/design dispatches.
- `quest-design`: creating a new quest or refining an `idea` quest.
- `takode-orchestration/quest-journey.md`: Journey revision, phase catalog, Memory/Port closure, or full phase-transition details.
- `takode-orchestration/board-usage.md`: board proposal, promotion, wait-for, wait-for-input, or detailed board command syntax.
- `~/.companion/quest-journey-phases/<phase-id>/leader.md`: always read the exact current phase leader brief before advancing or dispatching that phase.

## Non-Negotiables

- **Leaders do not implement non-trivial changes.** Leaders create quests, dispatch, steer, review, and coordinate. Investigation and research are also worker work.
- **Never run `quest claim` for worker work.** Workers claim quests when dispatched; leaders do not become owners of worker quests.
- **Use `/quest-design` before quest creation or refinement.** Before creating a quest or refining an `idea` quest, get user confirmation. When the user wants creation plus dispatch, combine that confirmation with this dispatch approval.
- **Get explicit Journey and Scheduling approval before dispatch.** The user-facing approval must include the initial phase list and the scheduling/orchestration approach, even when the plan is simply "spawn fresh and dispatch immediately if approved."
- **Write approved Journey state to the board before or with dispatch.** Do not rely on chat transcript prose as the durable Journey record.
- **Initial dispatch authorizes Alignment only.** The first worker message sends the Alignment brief and asks for a read-in; it does not authorize Implement, Explore, review, Port, or completion.
- **Fresh worker by default.** Reuse only when there is a real context advantage. A disconnected or idle worker is not automatically a good reuse target.
- **User waits are scoped.** A `needs-input` prompt blocks only its owning thread, quest, or board row unless the visible prompt explicitly concerns safety, global orchestration, worker-slot scheduling, shared resources, or cross-quest dependency.
- **New blocking prompt means new `needs-input`.** Publish the self-contained decision text in the thread first, then call `takode notify needs-input`; existing unresolved prompts do not cover a separate decision.
- **Use shell-safe payload paths.** Use `--message-file`, `--stdin`, or quest `--*-file` flags for multiline or shell-like text. Do not paste backticks, `$(...)`, quotes, braces, logs, or copied commands into inline shell strings.
- **Follow the board-approved Journey.** If risk or scope changes, revise the board explicitly instead of silently skipping phases.

## Approval Packet

For creation plus dispatch, one confirmation can approve the quest text, Journey, and scheduling plan. Keep chat concise and decision-oriented; put detailed evidence and worker grounding into the quest record.

Use this shape as a menu, not a form:

- **Proposed Quest**: title, tags when useful, and true follow-up relationship when relevant.
- **Goal / Acceptance**: the single source of truth for the requested work and acceptance checks.
- **Context / Evidence**: only details the user needs to approve, correct, or choose. Otherwise put them in the quest.
- **Out Of Scope**: only likely misunderstanding boundaries.
- **Open Questions**: only questions that materially change the quest or dispatch.
- **Journey**: phase list, with short notes only for non-standard phases or unusual handling.
- **Scheduling**: worker choice or fresh-spawn intent; immediate dispatch vs explicit queueing.

Do not repeat the same scope as a separate quest description, `Scope`, `The worker should`, or default expected-output section. `quest-design` owns the full confirmation shape; this skill adds the dispatch pieces: Journey, Scheduling, board recording, and Alignment-only first dispatch.

Before the first worker message:

1. The quest exists and is refined or otherwise approved for dispatch.
2. The user approved the Journey and Scheduling plan.
3. The approved Journey is on the board with `takode board set ... --phases ...` or by promoting an approved proposed row.
4. The selected worker/reviewer state matches the board row.

## Worker Selection

Start by reading current state:

```bash
takode board show
takode list
```

Then decide:

| Situation | Action |
|-----------|--------|
| No clear context advantage exists | Spawn fresh |
| Needed context is recoverable from repo, quest, or Takode history | Spawn fresh and point to sources |
| True follow-up or critical context lives mainly in one worker | Reuse that worker |
| Fresh worker is better but old context matters | Spawn fresh and provide source links or ask old worker for a short handoff |
| You intentionally need one busy worker later | Queue with explicit `--wait-for` |

Rules:

- **Disconnected does not mean dead.** Disconnected workers can auto-reconnect when sent a message, but disconnected availability alone is not a reuse reason.
- **Prefer source links over paraphrase.** Link exact sessions, messages, quests, artifacts, or phase notes rather than rewriting their content.
- **Do not reuse just because a worker is idle or available.** Reuse needs a concrete context advantage.
- **Queue only with explicit blockers.** Use `--wait-for #N`, `--wait-for q-N`, `--wait-for free-worker`, or one comma-separated value such as `--wait-for q-1143,#12,free-worker`.
- **Do not leave a queued row without `--wait-for`.** Do not ask workers to queue themselves.

### Capacity

Worker slots are limited to five. Reviewer sessions do not use worker slots, and archiving reviewers does not free worker capacity.

When all worker slots are used, compare active board work to your herd. If ready work is blocked only by completed/off-board workers waiting in review, do not treat that as a real capacity blocker:

- Prefer `takode spawn --replace-worktree-worker <session> ...` for an owned completed worktree worker when the new worker belongs in the same repo/base-branch worktree.
- If replacement is ineligible, archive the completed worker least likely to be reused.
- Never archive proactively. Archiving a worktree worker deletes unsynced worktree state, so reclaim capacity only after anything worth keeping has been committed, ported, or otherwise preserved.

For Execute phases blocked only by a shared lease, dispatch the worker into Execute and let the worker run the phase-brief lease acquire flow. Do not externally queue an already-approved Execute phase merely because a lease is currently held.

## Shell-Safe Commands

Use file/stdin paths for dispatches and corrections:

```bash
takode spawn --message-file - <<'EOF'
<dispatch message>
EOF

takode send <session> --stdin <<'EOF'
<phase instruction>
EOF
```

Use `--message` only for short literal text. Use quest file flags for shell-sensitive quest text or feedback:

```bash
quest create --title-file /tmp/title.txt --desc-file /tmp/description.md --tldr-file /tmp/tldr.md
quest feedback add q-123 --text-file /tmp/phase.md --tldr-file /tmp/phase-tldr.md
```

Never use `--no-worktree` unless the user explicitly asks for it or repo instructions require it. Normal workers, including investigation/debugging workers, get worktrees by default because investigation often leads to tracked changes.

Default to your own backend type unless the user specifies otherwise.

## Alignment Dispatch

Send this only after approval and board recording:

```text
Work on [q-XX](quest:q-XX). Load the quest skill first, then read the quest and claim it: `quest show q-XX && quest claim q-XX`.

Read this phase brief first:
- `~/.companion/quest-journey-phases/alignment/assignee.md`

Return an alignment read-in for approval covering your concrete understanding, ambiguities, clarification questions, blockers, surprises, and any evidence that may justify leader-owned Journey revision. After you send it, stop and wait for approval.
```

If the quest has unaddressed human feedback, add one sentence after the claim instruction:

```text
The quest has unaddressed human feedback -- read it carefully and factor it into your alignment read-in.
```

Worker context belongs in the quest record or in exact source pointers. If relevant prior messages, quests, artifacts, or memory files are known, put those pointers in the quest or dispatch delta so Alignment can inspect targeted sources instead of rediscovering broadly.

If prior memory may matter, use visible memory reads. Either inspect the relevant memory files yourself for leader routing, or tell the worker the exact catalog/direct-file workflow and likely files or terms to inspect.

## Phase Handoffs

After Alignment, leaders own advancement. Escalate to the user only for significant ambiguity, scope change, Journey revision, user-visible tradeoff, or another real blocker. Otherwise advance to the next approved phase yourself.

Every phase instruction must be phase-explicit:

- Read the exact current phase leader brief yourself.
- Include `Read this phase brief first:` and the exact assignee brief path from `takode phases`.
- Authorize only the current phase.
- Provide only deltas the assignee cannot infer from the phase brief, quest record, current artifacts, or its own context: accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, exact prior messages, files or memory decisions already inspected, or explicit memory-writing assignment.
- Require phase documentation before reporting back.
- Tell the assignee to stop after reporting back.

Do not imply the worker can self-review, run `/self-groom`, self-port, change quest status, complete the quest, or continue into later phases. Review, Port, Execute, Outcome Review, Mental Simulation, User Checkpoint, and final Memory each need explicit leader routing.

## Board Commands

Routine dispatch usually needs only:

```bash
takode board show
takode board set <quest-id> --worker <session> --phases alignment,implement,code-review,port,memory
takode board promote <quest-id> --worker <session>
takode board advance <quest-id>
takode board detail <quest-id>
```

Use `takode-orchestration/board-usage.md` for proposal rows, `--wait-for`, `--wait-for-input`, optional checkpoint skips, full Journey details, or uncommon board syntax.

## Task Delegation Style

- Describe what and why; avoid specifying files or functions unless you have recent direct evidence.
- Provide source references the worker cannot infer: user decisions, rejected approaches, related quests, session/message links, screenshots, logs, artifact paths, and reproduction steps.
- Let workers choose implementation approach when you lack enough context.
- If a plan is needed for the current phase, ask for it explicitly as a phase-specific delta. Do not make every non-trivial implementation invent a separate planning ceremony.
