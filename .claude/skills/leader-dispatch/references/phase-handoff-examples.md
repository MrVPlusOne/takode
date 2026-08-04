# Phase Handoff Examples

Keep actual handoffs shorter than these examples and include only context-dependent deltas. Generic behavior belongs in the active phase briefs.

## Alignment

```text
Work on [q-XX](quest:q-XX). Load the quest skill first, then read and claim the quest: `quest show q-XX && quest claim q-XX`.

Read this phase brief first:
- `~/.companion/quest-journey-phases/alignment/assignee.md`

Add or refresh the Alignment phase note with the concise read-in details. In final chat, point to that feedback index and include only blockers, surprises, or Journey-revision evidence that need immediate leader routing. After you send it, stop and wait for Work authorization.

Leader-specific deltas: <exact prior messages, unusual boundary, memory files, or safety warning>.
```

## Work

```text
Proceed with Work for [q-XX](quest:q-XX) inside the approved Alignment envelope.

Read this phase brief first:
- `~/.companion/quest-journey-phases/work/assignee.md`

You own investigation, implementation, self-review, approved validation/execution, sync/push duties when authorized, and iterative fixes within the approved envelope. Keep one current Work note. If you need authority outside the envelope, stop for a User Checkpoint. When Work is complete, use `takode board work-to-memory q-XX --work-note <feedback-index>` only if the guard conditions are satisfied.

Leader-specific deltas: <accepted refs, nonstandard verification, safety warning, exact source pointers, or preset checkpoint obligation>.
```

## User Checkpoint

```text
Prepare a User Checkpoint packet for [q-XX](quest:q-XX) without doing more Work.

Read this phase brief first:
- `~/.companion/quest-journey-phases/user-checkpoint/assignee.md`

Return a self-contained user-facing packet with findings, named options, tradeoffs, recommendation, exact requested answer, and any shortcut labels explained in visible text. Add or refresh the checkpoint note, then stop.

Decision needed: <what is outside the approved Work envelope>.
```

## Memory

```text
Proceed with final Memory for [q-XX](quest:q-XX).

Read this phase brief first:
- `~/.companion/quest-journey-phases/memory/assignee.md`

Use the accepted Work note and current artifacts. Perform catalog/direct-file memory triage, settle final debrief metadata, quest metadata, User review checks, cleanup/follow-ups, exactly one memory statement, and quest completion. Do not edit project-tracked implementation files; missing tracked work returns to Work.

Leader-specific deltas: <synced SHAs, debrief draft, memory files/terms, external artifacts, cleanup needs, or known residual risk>.
```

## Separate Review Quest

```text
Work on [q-YY](quest:q-YY), a separate review quest for [q-XX](quest:q-XX).

Read this phase brief first:
- `~/.companion/quest-journey-phases/alignment/assignee.md`

Use the accepted Work note, target diff/commit range, and evidence listed below. Alignment should confirm the review objective and constraints, then stop for Work authorization.

Review target: <session, message range, Work note, commit range, artifact, or evidence>.
```
