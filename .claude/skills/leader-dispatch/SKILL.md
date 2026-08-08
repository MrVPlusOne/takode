---
name: leader-dispatch
description: "Dispatch workflow for leader/orchestrator sessions. Use when dispatching a quest to a worker, choosing which worker to assign, spawning new worker sessions, deciding whether to reuse vs spawn, or deciding whether a tiny follow-up qualifies as a direct worker errand. Triggers: 'dispatch', 'send quest', 'assign worker', 'spawn worker', 'which worker', 'reuse or spawn', 'direct worker errand', 'quick follow-up'."
---

# Leader Dispatch Workflow

Use this skill before choosing a worker, spawning, reusing, queueing, or sending the first worker message for a quest. Also use it before deciding that a tiny context-rich follow-up can bypass quest lifecycle as a direct worker errand.

This is the hot path. Keep worker grounding in the quest record, phase-specific behavior in the phase briefs, and CLI mechanics in `takode-orchestration` / `board-usage.md`.

## Read On Demand

This section is the visible reference catalog. Decide whether to open these files from this list; ordinary Markdown reference headings are not loaded until you read the file.

| Source | Read when | Skip when |
|--------|-----------|-----------|
| `references/edge-cases.md` | The dispatch involves human feedback rework, a stale worker/reviewer completion, user screenshots or generated image evidence, 413/payload-size recovery, user-facing links into unported worker/reviewer worktrees, or memory-specific handoff/completion deltas. | Routine quest creation, worker choice, initial Alignment dispatch, or ordinary phase advancement. |
| `references/phase-handoff-examples.md` | You need concrete wording for a v2 phase handoff, direct worker errand, Work rework instruction, User Checkpoint packet, Memory handoff, or separate review-quest dispatch. | You can write a short phase-explicit handoff or errand request from the current guidance and quest-specific deltas. |
| `quest-design` | You are creating a quest, refining an `idea` quest, materially changing quest title/description/tags, or checking whether a true follow-up relationship needs approval and persistence. | The quest already exists/refined and you are only choosing a worker, advancing phases, or adding routine phase feedback. |
| `takode-orchestration/quest-journey.md` | You need full v2 Journey transition rules, phase catalog semantics, Work autonomy, User Checkpoint pause/resume, worker-owned Work -> Memory, final Memory, or legacy-row compatibility behavior. | The current phase leader brief and board row are enough. |
| `takode-orchestration/board-usage.md` | You need uncommon board syntax: proposed rows, promotion, `--wait-for`, `--wait-for-input`, optional checkpoint skip commands, full row detail, or direct board troubleshooting. | Routine `board show`, `board set`, `board advance`, or `board detail` is sufficient. |
| `~/.companion/quest-journey-phases/<phase-id>/leader.md` | Always before advancing, dispatching, or revising a specific phase. Use `takode phases` if you need the exact path. | Never skip for phase transitions. |

Keep the top-level checklist open for routine dispatch. Load references only when their trigger applies.

## Non-Negotiables

- **Leaders do not implement non-trivial changes.** Leaders create quests, dispatch, steer, review, and coordinate. Investigation and research are also worker work.
- **Direct worker errands are narrow non-quest exceptions.** Use them only for one-turn, context-rich, read-only follow-ups that match the checklist below. They create no quest, board row, phase note, Memory closure, or new lifecycle state.
- **Never run `quest claim` for worker work.** Workers claim quests when dispatched; leaders do not become owners of worker quests.
- **Use `/quest-design` before quest creation or refinement.** Before creating a quest or refining an `idea` quest, use that skill to decide whether the quest text needs user confirmation or qualifies for the direct-dispatch path below.
- **Use the three-path dispatch rubric.** Direct create/dispatch is allowed only for clear, low-risk, reversible repo-local work. Pre-dispatch approval is mandatory for risky, ambiguous, externally consequential, shared-resource, security/privacy, product/policy, or user-visible tradeoff work. Use a planned User Checkpoint when early phases are safe but a later decision or Execute phase needs user confirmation.
- **Write authorized Journey state to the board before or with dispatch.** Do not rely on chat transcript prose as the durable Journey record.
- **Verify promised durable actions before Ready.** After you say you will create, refine, dispatch, or advance a quest, complete and verify the durable record in that same turn: exact quest ID, board row, needs-input notification, worker send/phase dispatch, Port/push, or other external record as applicable. If the durable action is not complete, mark the thread Waiting or incomplete with what remains instead of Ready.
- **Keep setup context targeted.** Avoid broad mixed context dumps as the final step before quest setup or dispatch. Prefer compact targeted checks and perform the durable action once the user request is clear.
- **Initial dispatch authorizes Alignment only.** The first worker message sends the Alignment brief and asks for a read-in; it does not authorize Work or Memory yet.
- **Fresh worker by default.** Reuse only when there is a real context advantage. A disconnected or idle worker is not automatically a good reuse target.
- **User waits are scoped.** A `needs-input` prompt blocks only its owning thread, quest, or board row unless the visible prompt explicitly concerns safety, global orchestration, worker-slot scheduling, shared resources, or cross-quest dependency.
- **New blocking prompt means new `needs-input`.** Publish the self-contained decision text in the thread first, then call `takode notify needs-input`; existing unresolved prompts do not cover a separate decision.
- **Externally consequential User Checkpoints need fresh explicit approval.** A material edit alone is not approval. One fresh reply may make one exact substitution and explicitly approve the resulting packet only when its referent, every unchanged term, dependent parameters, monitor/stop conditions, safety implications, consequences, and tradeoffs remain unchanged and unambiguous, with no question or user choice left. Otherwise fail closed: publish a revised exact packet, keep the board in `USER_CHECKPOINTING`, and obtain fresh explicit approval before external consequences. Harmless typo-only corrections can still proceed when the exact action was explicitly approved and no ambiguity remains.
- **Use shell-safe payload paths.** Use `--message-file`, `--stdin`, or quest `--*-file` flags for multiline or shell-like text. Do not paste backticks, `$(...)`, quotes, braces, logs, or copied commands into inline shell strings.
- **Follow the board-approved Journey.** If risk or scope changes, revise the board explicitly instead of silently skipping phases.

## Direct Worker Errands

Before creating or reopening a quest, a leader may send a direct worker errand only when all of these are true:

- An active or recently completed worker has a concrete context advantage over a fresh worker or the leader.
- The request is read-only, bounded, reversible, and expected to complete in one worker turn.
- The deliverable is a draft, explanation, narrow source lookup, translation, formatting pass, or clarification.
- The leader can send the exact request and source pointer directly to the responsible worker.
- The errand will not interrupt unrelated in-progress work or violate one-task-at-a-time discipline.
- No code, config, data, durable state, Slack/external system, credential/security/privacy decision, shared resource, CI/validation run, durable artifact, user checkpoint, independent review, design/policy choice, broad or multi-source investigation, or cross-session handoff is needed.

When the checklist passes, send the exact request/source to the context-rich worker with `takode send` and then translate or forward the result to the user. Do not create or reopen a quest, claim, board row, phase occurrence, Alignment note, Work note, Memory note, completion metadata, or new status. The audit trail is the ordinary session/thread history.

Fail closed. If the worker discovers the request needs broader investigation, implementation, validation, mutation, durable state, ambiguity resolution, multiple turns, external consequences, review, or a durable handoff, it must stop and recommend promotion to a normal quest/Journey instead of silently expanding the errand.

Positive examples:

- After a completed parser-analysis quest, reuse its worker to read one linked Slack thread and draft a reply without posting it.
- Ask a context-rich worker to explain one accepted implementation detail or retrieve one exact source pointer.

Negative examples:

- Any code change, plugin/config edit, CI validation, broad research, multi-source investigation, Slack posting, state mutation, product/design choice, security/credential decision, or deliverable that should survive in durable records.

## Approval Packet

For creation plus dispatch that needs approval, one confirmation can approve the quest text, Journey, and scheduling plan. Keep chat concise and decision-oriented; put detailed evidence and worker grounding into the quest record.

The quest record must still stand alone after the concise approval packet. When the work depends on a prior quest, log, screenshot, or discussion, include enough local background for a new worker or future user to understand the problem, desired outcome, non-obvious terms, important constraints, and how a true follow-up differs from or builds on its predecessor without opening every link.

Use this shape as a menu, not a form:

- **Proposed Quest**: title, tags when useful, and true follow-up relationship when relevant.
- **Goal / Acceptance**: the single source of truth for the requested work and acceptance checks.
- **Context / Evidence**: only details the user needs to approve, correct, or choose. Otherwise put them in the quest.
- **Out Of Scope**: only likely misunderstanding boundaries.
- **Open Questions**: only questions that materially change the quest or dispatch.
- **Journey**: phase list, with short notes only for non-standard phases or unusual handling.
- **Scheduling**: worker choice or fresh-spawn intent; immediate dispatch vs explicit queueing.

Do not repeat the same scope as a separate quest description, `Scope`, `The worker should`, or default expected-output section. `quest-design` owns quest text discipline; this skill owns the dispatch decision: direct dispatch, pre-dispatch approval, or delayed approval via User Checkpoint.

## Dispatch Approval Rubric

Direct create/dispatch is allowed only when all of these are true:

- The user's intent is clear enough to write a narrow quest without a material assumption or product-choice guess.
- The work is reversible and confined to tracked repo/code/docs/prompt/config/test changes or local investigation artifacts.
- There is no destructive operation, irreversible data mutation, external side effect, deployment, expensive run, credential/security/privacy decision, global/shared-resource contention, cross-quest scheduling tradeoff, or user-visible product/policy choice.
- Validation can stay inside Work and Memory under the approved authorization envelope; any authority outside that envelope is gated by User Checkpoint.
- Worker selection is routine: fresh worker or clearly safe reuse with no user-level worker-slot, capacity, archive/replacement, or queueing tradeoff.

Even on direct dispatch:

- Quests remain the unit of work; create/refine the quest with enough worker context.
- Initial new-worker dispatch remains Alignment-only.
- Write the Journey to the board before or with dispatch.
- Work owns implementation, self-review, validation, sync/push duties when authorized, and phase documentation; final Memory still applies.
- Add a compact rationale only when the direct choice is non-obvious, for example: `direct dispatch: low-risk reversible docs/tests change; no external side effects`.

Pre-dispatch approval is mandatory when any of these apply:

- The scope is ambiguous, underspecified, or requires a material assumption the user has not already accepted.
- The work is destructive, irreversible, hard to roll back, externally consequential, deployment-like, expensive/long-running, or likely to mutate external/shared state.
- The work touches security, privacy, credentials, permissions, user data, billing, production operations, global/shared resources, cluster/browser/server leases beyond normal worker-owned acquisition, or broad orchestration policy.
- The leader must choose among user-visible product/policy directions, UI/UX behavior changes with meaningful tradeoffs, compatibility commitments, or acceptance criteria not implied by the request.
- Scheduling is a user-level tradeoff: reclaiming/archiving a risky worktree worker, queueing behind a specific busy worker for context, delaying another active quest, or using scarce shared resources in a way that may affect other work.
- The proposed path would skip final Memory, phase docs, required User Checkpoints, strong verification, or another safety requirement.

Use delayed approval via User Checkpoint when Work can proceed safely but a later product choice, expensive/external run, security/privacy decision, or policy choice needs user confirmation. Pause the same Work occurrence at `USER_CHECKPOINTING`, publish the self-contained checkpoint packet, call `takode notify needs-input`, link the board row with `--wait-for-input`, then resume the same worker's Work only after the user explicitly approves the exact packet. If the checkpoint offers shortcuts, the visible decision section must name every shortcut and explain its meaning plus relevant tradeoff before notify runs; phase notes, private packets, labels/buttons, summaries, and "see feedback" references do not substitute. "Change the batch limit to 120" is edit-only and requires a revised packet plus fresh approval. "Approve the bounded operation with batch limit 120" may approve that exact substitution when the packet referent and every other term and consequence remain unchanged and unambiguous. Questions; vague, conditional, or conflicting approval; ambiguous referents; dependent changes; changed monitor/stop conditions, safety implications, consequences, or tradeoffs; and any remaining user choice all require republishing and reapproval. Harmless typo-only corrections can be recorded and allowed to proceed when the exact action was explicitly approved and no ambiguity remains.

Before the first worker message:

1. The quest exists and is refined, approved, or qualifies for direct low-risk creation/dispatch under the rubric above.
2. The Journey and Scheduling plan are either directly authorized by the rubric or explicitly approved by the user.
3. The authorized Journey is on the board with `takode board set ... --phases ...` or by promoting an approved proposed row.
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

- Prefer `takode spawn --replace-worktree-worker <session> ...` for an owned completed worktree worker when the new worker belongs in the same repo/base-branch worktree. A clean worktree that is only behind the current target/base branch is safe to reclaim when normal capacity rules allow.
- If replacement is ineligible, archive the completed worker least likely to be reused.
- Never archive proactively. Archiving a worktree worker deletes unsynced worktree state, so reclaim capacity only after uncommitted changes and commits genuinely ahead of the current target have been committed, ported, or otherwise preserved.
- Do not infer dirty state from the worktree badge or treat every displayed ahead count as proof of unported work. `takode info` and sidebar counts may use a session diff base that differs from the live replacement preflight base. If counts are surprising, use replacement preflight or explicit current target-ref verification as the safety authority; never discard uncertain state.

For approved Work that needs a shared lease, dispatch the worker into Work and let the worker run the documented lease acquire flow. Do not externally queue already-approved Work merely because a lease is currently held.

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

Send this only after authorization and board recording:

```text
Work on [q-XX](quest:q-XX). Load the quest skill first, then read the quest and claim it: `quest show q-XX && quest claim q-XX`.

Read this phase brief first:
- `~/.companion/quest-journey-phases/alignment/assignee.md`

Add or refresh the Alignment phase note with the concise read-in details. In final chat, point to that feedback index and include only blockers, surprises, or Journey-revision evidence that need immediate leader routing. Avoid broad implementation plans, exhaustive evidence inventories, routine file lists, long command/test details, and repeated quest history unless needed to explain a blocker or misunderstanding risk. After you send it, stop and wait for approval.
```

If the quest has unaddressed human feedback, add one sentence after the claim instruction:

```text
The quest has unaddressed human feedback -- read it carefully and factor it into your alignment read-in.
```

Worker context belongs in the quest record or in exact source pointers. If relevant prior messages, quests, artifacts, or memory files are known, put those pointers in the quest or dispatch delta so Alignment can inspect targeted sources instead of rediscovering broadly.

If prior memory may matter, use visible memory reads. Either inspect the relevant memory files yourself for leader routing, or tell the worker the exact catalog/direct-file workflow and likely files or terms to inspect.

## Phase Handoffs

After Alignment, leaders own advancement. Treat the worker response as a compact leader-verification packet, not a planning document. Escalate to the user only for significant ambiguity, scope change, Journey revision, user-visible tradeoff, or another real blocker. Otherwise advance to the next approved phase yourself.

Do not convert the worker-authored Alignment note into a Work prompt. The worker already has the quest, source pointers, phase briefs, project guidance, and its own findings. After a clean Alignment, the default Work authorization is short: identify the Work phase brief and write `Leader-only deltas: none`. When real deltas exist, list only information that originates outside the worker's available context or changes user intent, authorization, dependencies, scheduling, safety, or external state.

For read-only implementation follow-ups on active or recently completed quests, route to the context-rich source before re-deriving technical details. Prefer a short Takode follow-up to the responsible worker, or inspect the accepted Work/Memory note, before reopening source yourself. Summarize the answer for the user. Answer directly when accepted durable evidence already states the fact, the worker is unavailable or no longer has relevant context, the question is about leader-owned intent/coordination/authority, urgency makes consultation impractical, or consultation would add latency without a context advantage. If the follow-up is a bounded draft, lookup, formatting pass, translation, explanation, or clarification that satisfies the direct worker errand checklist, use that non-quest path. Do not create a new quest or authorize code changes for a clarification unless the user asks for investigation, implementation, validation, or external action.

Every phase instruction must be phase-explicit:

- Read the exact current phase leader brief yourself.
- Include `Read this phase brief first:` and the exact assignee brief path from `takode phases`.
- Authorize only the current v2 phase or checkpoint pause.
- Provide only deltas the assignee cannot infer from the phase brief, quest record, current artifacts, or its own context: accepted refs, unusual scope boundaries, nonstandard verification, safety warnings, exact prior messages, files or memory decisions already inspected, explicit memory-writing assignment, later user decisions, cross-quest dependencies, external-state changes, scheduling constraints, or authority boundaries.
- Require phase documentation before reporting back.
- Tell the assignee to keep the final chat handoff compact: point to the phase feedback index and include only the concise outcome/verdict plus urgent blockers, safety facts, or narrow phase-required exceptions.
- Tell Alignment assignees to stop after the compact read-in.

After Alignment approval, Work is intentionally broader: the assigned worker may investigate, implement, self-review, run approved operations, sync/push when authorized, iterate, maintain the Work note, and use the worker-owned Work -> Memory transition when its guard conditions are satisfied. Do not reintroduce embedded v1 review/Port/Execute handoffs. Independent review, when needed, is a separate quest.

## Board Commands

Routine dispatch usually needs only:

```bash
takode board show
takode board set <quest-id> --worker <session> --phases alignment,work,memory
takode board promote <quest-id> --worker <session>
takode board advance <quest-id>
takode board work-to-memory <quest-id> --work-note <feedback-index>
takode board detail <quest-id>
```

Use `takode-orchestration/board-usage.md` for proposal rows, `--wait-for`, `--wait-for-input`, optional checkpoint skips, full Journey details, or uncommon board syntax.

## Task Delegation Style

- Describe what and why; avoid specifying files or functions unless you have recent direct evidence.
- Provide source references the worker cannot infer: user decisions, rejected approaches, related quests, session/message links, screenshots, logs, artifact paths, and reproduction steps.
- Let workers choose implementation approach when you lack enough context.
- If a plan is needed for the current phase, ask for it explicitly as a phase-specific delta. Do not make every non-trivial implementation invent a separate planning ceremony.
