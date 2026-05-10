# Quest Journey Lifecycle

Every dispatched task follows a **Quest Journey** assembled from built-in phases. The work board (`takode board show`) tracks proposed pre-dispatch Journeys, active current phases, remaining phases, and next required leader action in compact routine output. Use `takode board show --full` for full-board Journey paths and indexed phase notes, or `takode board detail q-N` for one quest's full Journey, notes, timing history, and revision metadata.

The planned Journey is board-owned state associated with the quest while that quest is on the board. Quest creation or refinement defines the quest text; it does not freeze either the proposed draft or the active Journey.

When assembling a Journey, ask what each extra phase contributes over merging that work into a later phase. The normal tracked-code path intentionally keeps common work small: `implement` includes the normal investigation, root-cause analysis, code/design reading, and test planning needed to complete approved fixes, docs changes, config changes, prompt changes, and artifact changes. Do not add `explore` before `implement` merely so a worker can look around.

Board-side Journey modes:

- `proposed`: pre-dispatch draft, no worker required yet, no active/current phase semantics yet
- `active`: approved execution Journey, with progress tracked by phase position/index

`PROPOSED` and `QUEUED` are board states, not phases. Once active, leaders choose the phase sequence that matches the risk boundary and evidence needed next. Repeated phases are allowed, so progress is tracked by active phase occurrence rather than assuming each phase name appears only once.

Before the first dispatch, leaders should use `/leader-dispatch` to propose the planned initial Journey and scheduling approach, then get approval. When the user clearly wants quest creation plus dispatch and the scope is understood, combine this with `/quest-design`: use the compact proposal shape from those skills so one confirmation can approve both. `Goal / Acceptance` should be the source of truth for scope and acceptance; avoid duplicating the same work in a separate quest description, `Scope` paragraph, `The worker should` list, or default `Expected Output / Acceptance` section. After approval, write the approved Journey to the board before or with dispatch using `takode board set --worker ... --phases ...` or by promoting an existing proposed row. If clarification is needed, ask it with quest framing; after the user clarifies and no major ambiguity remains, the next response should include both drafts together. Avoid a separate restated-understanding-only round. The worker alignment phase then returns a lightweight read-in inside that approved Journey and may surface facts that justify a leader-owned Journey revision; it is not the first time phases are proposed. After the worker returns that read-in, the leader normally approves the next phase and advances without a routine second user-approval round. Escalate back to the user only for significant ambiguity, scope change, Journey revision, user-visible tradeoff, or another real blocking issue.

## Built-In Phase Library

Built-in phase directories are seeded into `~/.companion/quest-journey-phases/<phase-id>/` with:
- `phase.json`: semantic/runtime metadata such as board state, aliases, role, contract, and next leader action
- `leader.md`: the leader-facing brief for that phase
- `assignee.md`: the brief the leader should point the worker or reviewer to for that phase

Use `takode phases` to list available phase metadata and exact brief paths. Leaders should read the exact `leader.md` path themselves and point the target session to the matching exact `assignee.md` path. Do not rely on globally installed phase skills as the primary mechanism.

| Phase | Board state | Leader brief | Assignee brief | Contract | Next leader action |
|-------|-------------|--------------|----------------|----------|--------------------|
| Alignment | `PLANNING` | `~/.companion/quest-journey-phases/alignment/leader.md` | `~/.companion/quest-journey-phases/alignment/assignee.md` | Do a lightweight read-in to confirm concrete understanding, ambiguities, clarification questions, and whether deeper exploration is needed before implementation or execution | read the alignment leader brief, send the alignment-only instruction, then review the worker read-in for leader approval, routing, or necessary user escalation |
| Explore | `EXPLORING` | `~/.companion/quest-journey-phases/explore/leader.md` | `~/.companion/quest-journey-phases/explore/assignee.md` | Investigate when the investigation is the deliverable or when routing is genuinely unknown; do not use Explore as routine pre-implementation looking around for normal bug-fix, docs, or config work | read the explore leader brief, then wait for the findings summary and decide whether to revise the Journey, advance, add a user-checkpoint, or stop |
| Implement | `IMPLEMENTING` | `~/.companion/quest-journey-phases/implement/leader.md` | `~/.companion/quest-journey-phases/implement/assignee.md` | Make approved code, docs, prompts, config, or artifact changes; this includes normal investigation, root-cause analysis, code/design reading, test planning, and cheap local evidence within the approved scope | read the implement leader brief, then wait for the worker report and choose the next review, execute, port, or memory phase |
| Code Review | `CODE_REVIEWING` | `~/.companion/quest-journey-phases/code-review/leader.md` | `~/.companion/quest-journey-phases/code-review/assignee.md` | Review tracked code or tracked artifacts for comprehensive landing risk: correctness, regressions, tests, maintainability, quest hygiene, implementation completeness, meaningful evidence, and security when relevant | read the code-review leader brief, then wait for the reviewer result and either send rework or advance |
| Mental Simulation | `MENTAL_SIMULATING` | `~/.companion/quest-journey-phases/mental-simulation/leader.md` | `~/.companion/quest-journey-phases/mental-simulation/assignee.md` | Replay a design, workflow, or implementation against concrete scenarios | read the mental-simulation leader brief, then wait for the scenario review and decide whether the Journey needs revision |
| Execute | `EXECUTING` | `~/.companion/quest-journey-phases/execute/leader.md` | `~/.companion/quest-journey-phases/execute/assignee.md` | Run approved expensive, risky, long-running, externally consequential, or approval-gated operations | read the execute leader brief, track monitor and stop conditions, then wait for the execution report and decide whether outcome review, more execute work, or a Journey revision is needed |
| Outcome Review | `OUTCOME_REVIEWING` | `~/.companion/quest-journey-phases/outcome-review/leader.md` | `~/.companion/quest-journey-phases/outcome-review/assignee.md` | Reviewer-owned acceptance judgment over external or non-code outcomes such as metrics, logs, artifacts, prompt behavior, or UX trial notes | read the outcome-review leader brief, then wait for the reviewer judgment and route to implement, execute, alignment, or conclusion |
| User Checkpoint | `USER_CHECKPOINTING` | `~/.companion/quest-journey-phases/user-checkpoint/leader.md` | `~/.companion/quest-journey-phases/user-checkpoint/assignee.md` | Present findings, options, tradeoffs, and a recommendation for a required user decision before the Journey continues; do not treat this as a terminal phase or a generic TBD bucket | read the user-checkpoint leader brief, publish the decision prompt, notify the user, wait for the answer, then revise the remaining Journey |
| Port | `PORTING` | `~/.companion/quest-journey-phases/port/leader.md` | `~/.companion/quest-journey-phases/port/assignee.md` | Sync accepted tracked changes back to the main repo, verify the main repo after sync, and report synced SHAs and port risks | read the port leader brief, then wait for sync confirmation and post-port verification before advancing to final Memory |
| Memory | `MEMORY` | `~/.companion/quest-journey-phases/memory/leader.md` | `~/.companion/quest-journey-phases/memory/assignee.md` | Finish non-project-tracked durable-state closure for a substantively accepted quest; do not edit tracked project files | read the memory leader brief, assign the final Memory owner, then complete the quest only after durable state, final debrief metadata, and the memory statement are settled |
| Bookkeeping | `BOOKKEEPING` | `~/.companion/quest-journey-phases/bookkeeping/leader.md` | `~/.companion/quest-journey-phases/bookkeeping/assignee.md` | Compatibility phase for targeted durable shared external state that does not fit normal phase documentation or final Memory closure | read the bookkeeping leader brief, record the targeted durable shared-state update, then advance when the facts and handoff state are current |

## Phase Documentation Contract

Each active phase should leave durable quest documentation before the leader treats the phase as complete. The actor for the phase writes the full entry for future agents first, then derives TLDR metadata for human scanning. Phase-note TLDRs should usually be 1-5 scan-friendly bullets or sentences that preserve conclusions, decisions, evidence, blockers, risks, handoff facts, and phase-specific outcomes. Keep raw SHAs, branch names, exhaustive command lists, routine file paths, and detailed verification mechanics in the full body or port metadata unless the exact detail is central to understanding that phase.

When documenting repository files, use Takode custom file links such as `[QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42)` instead of plain paths. Standard Markdown file links to repo files are a best-effort clickable fallback in Questmaster, but custom `file:` links remain preferred because they carry richer location metadata.

Prefer the q-991 phase-scoped feedback primitive with current-phase inference:

```bash
quest feedback add q-N --text-file /tmp/phase.md --tldr-file /tmp/phase-tldr.md --kind phase-summary
```

Use `--kind phase-finding` for exploration findings, `--kind review` for review phases, or `--kind artifact` for execution artifacts when that better describes the entry. If inference is unavailable or ambiguous, use explicit flags such as `--phase`, `--phase-position`, `--phase-occurrence`, `--phase-occurrence-id`, or `--journey-run`. Use `--no-phase` only when a flat unscoped quest comment is intentional, such as non-Journey bookkeeping or legacy quest compatibility.

Use value-based compression for phase documentation instead of hard length caps. Keep phase-local decisions, blockers, recovery context, review judgments, user choices, external artifact state, residual risks, and next-phase handoff facts. Cut or compress file-by-file diff narration, exhaustive command transcripts, routine green test lists, branch hygiene narration, copied tool output, generic review checklists, and repeated commit metadata that Git or Questmaster already preserves. Include low-level detail only when it explains non-obvious risk, recovery, verification, or external state. If the actor's context was compacted during the phase, or if memory confidence is low, they should reconstruct relevant facts with `takode scan`, `takode peek`, `takode read`, quest feedback, and local artifacts before documenting. If context is intact, they should use working memory and current artifacts instead of unnecessary session archaeology.

Keep the memory boundary explicit: quest phase notes say what happened in this phase and what the next phase needs; file-based memory stores durable cross-quest knowledge, procedures, decisions, references, and artifact manifests. A phase note usually needs only one memory outcome line or memory commit pointer when memory matters.

For valuable nontrivial phase outcomes, the assignee may run `takode worker-stream` once the substantive result is ready so the leader can start reading while required paperwork finishes. Treat worker-stream output as an early internal checkpoint only: it is optional, not mandatory ceremony, and it does not replace phase documentation, final debrief metadata, or leader-owned phase transitions.

Phase documentation should stay specific to the phase:
- Alignment: concrete understanding, constraints, ambiguities, clarification questions, blockers, surprises, and Journey-revision evidence. Avoid prewriting implementation plans unless that is the blocker.
- Explore: evidence sources, findings, confidence limits, ambiguities or blockers, options or implementation considerations, and Journey-revision evidence. Summarize log-heavy evidence and link artifacts instead of pasting transcripts.
- Implement: behavior or artifact change, key design choices, verification categories, remaining risks, and addressed feedback. Mention files only as entry points or when their role is non-obvious; do not narrate the diff file by file.
- Code Review: verdict first; if there are findings, lead with them. Include decisive evidence, meaningful review aspects, risk reasoning, and documentation hygiene judgment. Do not restate the entire diff or every green command.
- Mental Simulation: scenarios replayed, outcomes, concrete examples, risks, recommendations, and confidence limits. Avoid generic evidence inventories unless an evidence source changed a scenario judgment.
- Execute: approved action, monitors, stop conditions, outcome, deviations, artifact or log locations, cleanup or retention decisions, residual risks, and follow-up needs. Keep raw logs out unless the excerpt is the evidence.
- Outcome Review: evidence judged, ACCEPT or insufficiency rationale, bounded reruns, residual risks, and follow-up routing. Avoid turning it into a second Execute transcript.
- User Checkpoint: findings, options, tradeoffs, recommendation, required user answer, actual user decision when known, and Journey-revision implications.
- Port: ordered synced SHAs, post-port verification categories, port anomalies, remaining sync risks, memory statement, and accepted-state context final Memory will need. Omit branch command transcripts unless recovery depended on them.
- Memory: final debrief metadata status or drafts, quest hygiene changes, memory files inspected, memory update or deferral, external durable-state records, cleanup, follow-up routing, and residual risks.
- Bookkeeping: records updated, superseded facts, external locations, durable handoff facts, and targeted memory updates or deferrals for legacy/intermediate flows. Avoid replaying the whole quest when a targeted consolidation or memory pointer is enough.

Review phases must judge documentation quality, not just presence. Check phase relevance, useful full detail, TLDR completeness where appropriate, and correct phase association when the phase-scoped primitive is available.

## File-Based Memory In Journey Work

Takode memory is a Git-tracked Markdown repo scoped to the current server/session space. Normal `memory` commands auto-create the repo at `~/.companion/memory/<serverSlug>/<sessionSpace>` when needed, such as `~/.companion/memory/prod/Takode`, so agents do not need a separate init step. It is a shared aid for durable state, not a hidden instruction channel. After compaction or low-confidence recovery, recover session and quest context first. If durable memory may affect the work, leaders and workers should use visible reads: run `memory catalog show`, treat the catalog as the triage map, inspect plausible catalog-listed Markdown files directly, and use targeted `rg` under `$(memory repo path)` only when catalog or known context makes a match plausible. Use `memory catalog diff` as a freshness check for final Memory, and for Port or Outcome Review when memory matters for final handoff, debrief accuracy, durable decisions, or memory-writing choices; do not run it constantly, and do not treat it as a replacement for direct file inspection. If the catalog shows no plausible relevant topic, type, or source, skip blind repo-wide memory search and continue from session, quest, code, or artifact evidence. Use `memory repo path` and `memory --help` to rediscover the repo and command surface.

Memory writes are explicit Journey responsibility. A phase actor may update memory when they learned durable shared facts, changed live coordination state, produced external artifacts, or accepted a decision/preference that should survive the quest. Final Memory is the normal owner for end-of-quest memory closure; if the update is useful but not synchronous, route it through Memory or an approved curator instead of blocking the current phase.

Memory authoring uses one repo-level lock and direct file edits:

```bash
memory lock acquire --owner <session-or-role>
# search/read/edit files directly under current/, knowledge/, procedures/, decisions/, references/, artifacts/
memory lint
memory diff
memory commit --message "..." --source "quest:q-N" --memory-id "<id>"
memory lock release
```

Every relevant phase report, Port handoff, or final debrief should include exactly one memory statement:
- `memory updated: <commit>`
- `memory update deferred: <reason or curator>`
- `memory update not needed: <reason>`

## Recommended Default

The recommended built-in tracked-code Journey is:

`alignment -> implement -> code-review -> port -> memory`

This preserves a small normal path for common repo work while allowing leaders to choose richer review or operations paths when the quest needs them. It is a default, not a mandate: user overrides win. If the user asks to skip `code-review`, `port`, or another standard phase, follow that instruction or briefly confirm the tradeoff instead of refusing because the phase is standard.

Omit notes for standard phases by default: `alignment`, `implement`, `code-review`, `port`, and final `memory` are self-explanatory unless the user or quest adds unusual phase-specific work. Add concise notes for non-standard phases such as `explore`, `user-checkpoint`, `execute`, `outcome-review`, `mental-simulation`, or compatibility `bookkeeping`; state why the phase is needed and what evidence, user decision, scenario, outcome, or durable state it covers. For every extra phase, ask what it contributes over merging the same work into a later phase.

## Approval and Board Workflow

Use natural prose as the normal approval surface. Once the user approves, make the Journey durable on the board before or with dispatch:

```bash
takode board set q-12 --worker 5 --phases alignment,implement,code-review,port,memory --preset full-code
```

- `takode board set --worker ... --phases ...` creates the active board row in one step after prose approval
- `takode board propose` remains available to create or revise a board-owned draft when the quest already exists and a draft row helps coordination
- prefer `takode board propose --spec-file` for complete proposal drafts with phases, concise non-standard notes, and scheduling metadata
- `takode board note` remains available for targeted note edits, but each draft mutation makes any previous presentation stale
- `takode board present` creates an optional user-facing approval artifact from the current draft
- `takode board promote` reuses a proposed Journey object for execution after approval; a separate presentation step is no longer required
- approval-hold rows should use `PROPOSED` plus `--wait-for-input`, not a fake generic queue dependency

Examples:

- Straight tracked-code work: `alignment -> implement -> code-review -> port -> memory`
- Expensive or approval-gated run: `alignment -> explore -> execute -> outcome-review -> memory`
- Findings that require user steering: `alignment -> explore -> user-checkpoint -> implement -> code-review -> port -> memory`
- Design or workflow validation: `alignment -> implement -> mental-simulation -> code-review -> port -> memory`
- Cheap local evidence followed by acceptance review: `alignment -> implement -> outcome-review -> code-review -> port -> memory`

## Journey Revision

Leaders may revise the remaining Journey when risk, evidence needs, external-state impact, user steering, or the next action changes.

Use:

```bash
takode board set q-12 --phases implement,outcome-review,code-review,port \
  --preset cli-rollout
```

Rules:

- Already completed phase occurrences are historical and cannot be revised in place.
- Keep completed prefix positions unchanged; append a later repeated phase when requirements change after a phase has run.
- Proposed rows with no executed phases can be revised freely.
- When revising an active row without changing `--status`, include the current phase in `--phases`.
- Repeated phases are first-class. Insert or append them directly instead of pretending the Journey reset to an earlier abstract state.
- Indexed phase notes rebase by phase occurrence, not raw index. If the same occurrence still exists after a phase-list revision, the note follows it even when its position shifts.
- If a revision removes the intended occurrence, `takode board set` / `takode board propose` warns about the dropped note so the leader can reattach or rewrite it deliberately.
- Repeated active phases are tracked by occurrence index, not just by `currentPhaseId`. When a repeated phase is active and `--status` alone would be ambiguous, set `--active-phase-position` so the board row and UI point at the correct occurrence.
- If the active boundary itself changes, set an explicit `--status` that matches the revised phase plan.
- `takode board advance` always follows the row's planned phases, not a hard-coded global order.

## Phase-Explicit Worker Steering

- **Authorize one phase at a time.**
- **Initial Journey approval happens before dispatch.** Use `/leader-dispatch` to get approval for the proposed Journey and scheduling plan, then put the approved Journey on the board before or with dispatch.
- **Read the exact leader brief; point assignees to the exact assignee brief.** Use `takode phases` when you need the paths. Do not treat globally installed phase skills as the primary phase mechanism.
- **Initial dispatch = alignment only.**
- **Promote the same board-drafted Journey after approval when a proposed row exists.** Otherwise, create the active row directly with the approved phase list. Do not let recovery depend only on transcript prose.
- **Quest ownership stays with the worker.**
- **Worker alignment returns a lightweight read-in inside a leader-approved Journey.** It may surface blockers, surprises, and evidence that justify leader-owned Journey revision, but the board-owned Journey remains authoritative until the leader changes it.
- **Point alignment at exact sources when you already know them.** When the relevant prior messages, quests, or discussions are known, point the worker to those specific sources so alignment can use targeted Takode or quest inspection instead of broad exploration.
- **Alignment approval is leader-owned by default.** Once the user has approved the initial Journey plus scheduling plan, the leader normally approves the returned worker read-in and dispatches the next phase.
- **Escalate alignment back to the user only for real blockers.** Significant ambiguity, scope change, Journey revision, user-visible tradeoff, or another blocking issue can require fresh user approval.
- **Alignment approval authorizes exactly one next phase.** For example: explore now, then stop and report back.
- **Use `user-checkpoint` for explicit user participation.** Present findings, options, tradeoffs, and a recommendation; notify the user and wait; then revise the remaining Journey after the user answers. Do not use it as terminal closure, generic TBD, or optional leader-only indecision.
- **Workers and reviewers document, report, then stop at phase boundaries.** They do not self-review, self-port, self-transition, or self-complete unless explicitly instructed.
- **Porting requires an explicit instruction.** Port syncs accepted tracked changes, verifies the main repo, reports synced SHAs and risks, then stops. After Port, advance to final Memory instead of completing the quest from Port.
- **Every completed non-cancelled quest needs final Memory.** Completion without Memory closure, final debrief metadata, debrief TLDR metadata, and one memory statement is incomplete. A quest in `MEMORY` is downstream-unblocking because substantive work has been accepted and synced when applicable, but the row stays open until Memory finishes.

## Review Phases

Use the review phase that matches the evidence you need:

- **`code-review`** for tracked code/artifact quality and landing risk.
- **`mental-simulation`** for scenario-driven workflow, design, or responsibility-split replay.
- **`outcome-review`** for reviewer-owned acceptance over external behavior, metrics, artifacts, prompt behavior, or operational outcomes that already exist.
- **`execute`** when more evidence requires expensive, risky, long-running, externally consequential, or approval-gated runs rather than a reviewer acceptance pass.

Guidance:

- Use **`mental-simulation`** when the question is whether a design or workflow makes sense under replayed scenarios. This is about plausibility and failure modes, not externally executed sufficiency.
- Use **`outcome-review`** when the worker has usually already produced the evidence and a reviewer should decide whether that evidence is sufficient. The reviewer may do only small bounded reruns or repros needed for acceptance.
- Use **`execute`** when the worker needs more than cheap local evidence gathering and the next step is an approved run with monitors, stop conditions, risk controls, or external consequences.
- If outcome evidence is insufficient, route back deliberately: **`implement`** when behavior or code must change, **`execute`** when more approved runs are needed, and **`alignment`** when success criteria, scope, or experiment design changed.

Do not default to a generic skeptic-review framing for new work. Legacy board rows or saved phrases may still mention `skeptic-review`, `reviewer-groom`, or `stream-update`; treat those as compatibility aliases rather than the preferred vocabulary.

## Zero-Tracked-Change Journeys

Zero-tracked-change quests use the same phase-based Journey model as any other quest. Do not use a separate board flag or shortcut command.

Choose explicit phases that match the evidence you need, omitting `port` only when nothing will be synced and still ending in `memory`. Examples:

- `alignment -> explore -> outcome-review -> memory`
- `alignment -> explore -> memory`
- `alignment -> mental-simulation -> memory`

Advancing from the final planned phase removes the row from the board. Git-tracked docs, skills, prompts, templates, and other text-only edits still count as tracked-change work and should include `port`.

Omitting `port` does not omit final Memory. The leader must ensure the completed non-cancelled quest receives final debrief metadata, debrief TLDR metadata, and one memory statement through final Memory or leader-authored completion metadata.

## Feedback Rework Loop

When new human feedback lands:

0. First check whether the feedback likely belongs to the current quest. Same-thread feedback usually does, but users may occasionally post new-quest or unrelated feature feedback in the wrong thread. If the message appears separate or cross-cutting, ask or propose the split before changing the current quest; after the new quest exists, attach the relevant messages/images there.
1. Record the feedback on the quest.
2. Re-open the quest if it was already in `needs_verification` or `done`.
3. Reset the board row to the earliest valid phase for the new scope.
4. Treat the new feedback as the source of truth.
5. Run a fresh Journey from that reset point.

Fresh human feedback outranks stale old-scope review or port completions.
