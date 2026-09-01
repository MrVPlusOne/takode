# Phase Handoff Examples

Keep actual handoffs shorter than these examples and include only genuinely useful context the worker cannot already access. Generic behavior belongs in the active phase briefs.

## Alignment

```text
Work on [q-XX](quest:q-XX). Load the quest skill first, then read and claim the quest: `quest show q-XX && quest claim q-XX`.

Read this phase brief first:
- `~/.companion/quest-journey-phases/alignment/assignee.md`

Add or refresh the Alignment phase note with the concise read-in details. In final chat, point to that feedback index and include only blockers, surprises, or Journey-revision evidence that need immediate leader routing. After you send it, stop and wait for Work authorization.

```

If the leader has genuinely useful context the worker cannot otherwise access, add it in natural prose after the phase instruction, for example: `Use [#YY msg M](session:YY:M) for the later user correction.`

## Direct Worker Errand

Use this only when the `leader-dispatch` direct worker errand checklist passes. It is not a Quest Journey phase handoff.

```text
Quick direct errand, not a Quest Journey.

Use your retained context from [q-XX](quest:q-XX) / <accepted note or source>. Please do only this bounded read-only task:
- <exact draft, explanation, lookup, translation, formatting pass, or clarification request>
- Source: <one exact message, thread, note, file, or artifact pointer>

Do not claim or reopen a quest, write phase notes, mutate code/config/data/state, post externally, run validation, or create durable artifacts. If this needs broader investigation, implementation, validation, mutation, multiple turns, external consequences, review, or a durable handoff, stop and say it should be promoted to a normal quest.
```

## Work

```text
Alignment approved. Proceed with Work for [q-XX](quest:q-XX).

Read this phase brief first:
- `~/.companion/quest-journey-phases/work/assignee.md`

```

That is sufficient when no new context exists. When a later user decision or genuinely useful external fact is not otherwise available to the worker, write it naturally and keep it narrow rather than adding a required section:

```text
The user later rejected <option>; source: [#YY msg M](session:YY:M). [q-YY](quest:q-YY) is waiting on this result.
```

## User Checkpoint

```text
Prepare a User Checkpoint packet for [q-XX](quest:q-XX) without doing more Work.

Read this phase brief first:
- `~/.companion/quest-journey-phases/user-checkpoint/assignee.md`

Return a self-contained user-facing packet with findings, named options, tradeoffs, recommendation, exact requested answer, and any shortcut labels explained in visible text. Add or refresh the checkpoint note, then stop.

Decision needed: <what is outside the approved Work envelope>.

Before checkpoint entry, ensure the remaining suffix includes a later Work occurrence before Memory. A direct optional skip whose condition is already satisfied should stay in Work and use guarded `work-to-memory --skip-optional-checkpoint <reason>` instead of creating this packet.
```

## Memory

```text
Proceed with final Memory for [q-XX](quest:q-XX).

Read this phase brief first:
- `~/.companion/quest-journey-phases/memory/assignee.md`

Use the accepted Work note and current artifacts. Perform catalog/direct-file memory triage, settle final debrief metadata, quest metadata, User review checks, cleanup/follow-ups, exactly one memory statement, and quest completion. Do not edit project-tracked implementation files; missing tracked work returns to Work.

Do not put synchronized Work SHAs in this Memory handoff merely for attachment. The guarded Work -> Memory transition must already have recorded them as structured code commit metadata; missing code evidence routes back to Work.
```

When the worker cannot otherwise access a relevant debrief decision, memory file, external artifact, cleanup need, or known residual risk, add one short natural sentence that points to it.

## Separate Review Quest

```text
Work on [q-YY](quest:q-YY), a separate review quest for [q-XX](quest:q-XX).

Read this phase brief first:
- `~/.companion/quest-journey-phases/alignment/assignee.md`

Use the accepted Work note, target diff/commit range, and evidence listed below. Alignment should confirm the review objective and constraints, then stop for Work authorization.

Review target: <session, message range, Work note, commit range, artifact, or evidence>.
```
