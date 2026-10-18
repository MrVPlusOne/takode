# Phase Handoff Examples

Each example is the whole message when there is no new context. The named assignee brief supplies the phase's duties (phase notes, compact chat handoff, stop boundary, transition mechanics), so do not repeat them; add only genuinely useful context the worker cannot already access.

## Initial Work

```text
Work on [q-XX](quest:q-XX). Load the quest skill first, then read and claim the quest: `quest show q-XX && quest claim q-XX`.

Read this phase brief first:
- `~/.companion/quest-journey-phases/work/assignee.md`
```

If the leader has genuinely useful context the worker cannot otherwise access, add it in natural prose after the phase instruction, for example: `Use [#YY msg M](session:YY:M) for the later user correction.`

## Direct Worker Errand

Use this only when the `leader-dispatch` direct worker errand checklist passes. It is not a Quest Journey phase handoff. Workers' own instructions already define the errand limits and the stop-and-promote rule, so naming it a direct errand is enough.

```text
Quick direct errand, not a Quest Journey.

Use your retained context from [q-XX](quest:q-XX) / <accepted note or source>:
- <exact draft, explanation, lookup, translation, formatting pass, or clarification request>
- Source: <one exact message, thread, note, file, or artifact pointer>
```

## Work

```text
Resume the authorized Work for [q-XX](quest:q-XX).

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

Decision needed: <what is outside the approved Work envelope>.
```

Before sending it, check the leader-side conditions in the User Checkpoint leader brief yourself: the remaining Journey has a later Work occurrence before Memory, and no direct optional skip applies.

## Memory

```text
Proceed with final Memory for [q-XX](quest:q-XX).

Read this phase brief first:
- `~/.companion/quest-journey-phases/memory/assignee.md`
```

When the worker cannot otherwise access a relevant debrief decision, memory file, external artifact, cleanup need, or known residual risk, add one short natural sentence that points to it.

## Separate Review Quest

```text
Work on [q-YY](quest:q-YY), a separate review quest for [q-XX](quest:q-XX).

Read this phase brief first:
- `~/.companion/quest-journey-phases/work/assignee.md`

Review target: <session, message range, Work note, commit range, artifact, or evidence>.
```
