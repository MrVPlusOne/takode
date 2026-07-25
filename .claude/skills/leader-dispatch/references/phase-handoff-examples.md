# Phase Handoff Examples

Keep actual handoffs shorter than these examples and include only context-dependent deltas. The assignee's final chat should point to the phase feedback index and avoid duplicating the phase note, except for narrow phase-required fields such as User Checkpoint packets, Port synced SHAs/target sync status, final Memory memory statements, urgent blockers/safety facts, and concise routing verdicts.

## Implement

```text
Continue [q-XX](quest:q-XX) with the Implement phase only.

Read this phase brief first:
- `~/.companion/quest-journey-phases/implement/assignee.md`

Implement the approved scope, add or refresh the current Implement phase documentation with full agent-oriented detail plus TLDR metadata, then stop with a compact handoff that points to the feedback index. Do not run review workflows, self-port, or change quest status.

Leader-specific deltas: <accepted refs, unusual boundary, verification expectation, safety warning, or exact source pointers>.
```

## Implement Rework After Review

```text
Continue [q-XX](quest:q-XX) with the Implement rework phase only.

Read this phase brief first:
- `~/.companion/quest-journey-phases/implement/assignee.md`

Address the reviewer findings. If more tracked changes are needed, commit the current worktree state first, make the fixes in a separate follow-up commit, and send the changed worktree back to Code Review only after that checkpoint exists. Refresh the current Implement phase documentation, then stop with a compact handoff that points to the feedback index. Do not port yet.

Findings to address: <specific findings or review note link>.
```

## Code Review

```text
Review [q-XX](quest:q-XX) Code Review phase for worker [#N](session:N).

Read this phase brief first:
- `~/.companion/quest-journey-phases/code-review/assignee.md`

Load the quest context and inspect the worker diff. Review for correctness, regression risk, tests, maintainability, implementation completeness, phase documentation quality, and whether the work matches the approved scope. Add or refresh Code Review phase documentation, then report only ACCEPT or blocking findings plus the feedback index. Do not implement or port.

Review focus: <exact files, commits, findings, or risk areas>.
```

## Mental Simulation

```text
Continue [q-XX](quest:q-XX) with Mental Simulation only.

Read this phase brief first:
- `~/.companion/quest-journey-phases/mental-simulation/assignee.md`

Replay the accepted design/change against these scenarios: <scenario list>. Document outcomes, gaps, risks, and confidence limits in the Mental Simulation phase note, then stop with a compact handoff that points to the feedback index. Do not edit files.
```

## Execute

```text
Continue [q-XX](quest:q-XX) with Execute only.

Read this phase brief first:
- `~/.companion/quest-journey-phases/execute/assignee.md`

Run only the approved validation. Follow resource leases and stop conditions. Document the Execute outcome, artifacts, deviations, cleanup, and residual risks, then stop with a compact handoff that points to the feedback index and names any urgent deviation.

Approved run: <command/browser flow/external action>.
Stop conditions: <conditions>.
```

## Outcome Review

```text
Review [q-XX](quest:q-XX) Outcome Review phase.

Read this phase brief first:
- `~/.companion/quest-journey-phases/outcome-review/assignee.md`

Judge whether the existing evidence is sufficient. Keep reruns bounded and only when needed for acceptance. Document ACCEPT or insufficiency with evidence, residual risks, and routing recommendation, then stop with a compact handoff that points to the feedback index.

Evidence to judge: <phase note, artifact path, logs, screenshot, scenario>.
```

## Port

```text
Continue [q-XX](quest:q-XX) with Port now.

/port-changes

Read this phase brief first:
- `~/.companion/quest-journey-phases/port/assignee.md`

Port the accepted tracked changes, run the required post-port verification, add or refresh Port phase documentation, and report back compactly. Include the selected target, target sync status, feedback index, and a dedicated `Synced SHAs: sha1,sha2` line with ordered synced SHAs from the target repo so final Memory can attach structured commit metadata; keep detailed verification in the phase note.

Leader-specific deltas: <accepted refs, target branch/worktree, extra verification, port risks, memory-specific accepted-state context>.
```

## Investigation Or Design With No Tracked Changes

```text
Continue [q-XX](quest:q-XX) with <phase> only.

Read this phase brief first:
- `~/.companion/quest-journey-phases/<phase>/assignee.md`

Produce <artifact/evidence/recommendation>, document the phase with full detail plus TLDR metadata, then stop with a compact handoff that points to the feedback index. Do not edit tracked files or complete the quest.
```
