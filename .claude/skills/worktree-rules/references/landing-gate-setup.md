# Suggesting and setting up the landing queue

Use this when classic ports to a shared remote branch keep queuing behind each other and the branch has no saved landing gate (`takode land gate show` in a worktree of that repository says none is saved). [`/port-changes`](../SKILL.md) says who raises it and when; this file covers what to propose and how to draft the gate.

## What to tell the user

Keep the explanation short and concrete:

- **The problem:** on the classic port, each landing holds the branch's port lease for its own full test run, so landings happen one at a time and every waiting session sits idle behind the current one's tests. Mention what you saw, such as how many ports were queued or how long they waited.
- **The landing queue:** each session runs the full gate on its own branch before submitting, outside the lease. Waiting changes are then stacked on the remote tip and gated once together, and the exact gated commit is pushed. A change that conflicts or brings new failures goes back to its owner while the rest land. A lone change still lands after one full gate. Flaky tests and failures that already happen on the base commit do not block a landing.
- **The opt-in:** saving a landing gate for the branch on the Takode server: its dependency install and its full verification commands. Nothing is committed to the repository. Saving it changes how every session lands on that branch, which is why the user approves the exact gate first. `takode land gate remove` opts the branch out again.
- **The offer:** draft the gate from the commands the repository already uses for its tests, try it, and show the draft and the result for approval.

It helps only for remote-backed branches that several sessions land on. Ports into a leader's local worktree target, or a repository that rarely sees more than one port at a time, gain little.

## Drafting the gate

`takode land gate --help` documents the format with an example. Take the commands from what the repository already runs to verify a change: its CI workflow, package scripts, Makefile, contributor docs and agent instruction files (`CLAUDE.md`, `AGENTS.md`). Include what the classic port gate runs for that repository, and do not invent stricter or looser checks; if the sources disagree, show the choice to the user. Points the format alone does not make obvious:

- `run` is an argument array started without a shell. Use `["sh", "-c", "..."]` only when a step needs shell syntax.
- `install` runs before the steps in every checkout the gate uses, including fresh landing checkouts that have no dependencies yet. Use the repository's locked, non-updating install (such as a frozen-lockfile install) so the gate never changes the lockfile.
- A `"kind": "vitest"` step gets per-test reruns, baseline comparison and culprit search. The gate appends reporter flags and test file paths to its `run`, so the command must reach Vitest's `run` mode directly or through a script that passes extra arguments on to Vitest. Other test runners, linters and type checkers are plain steps, which compare their whole failure output with the base commit's.

Write the draft to a file outside the repository (for example under `/tmp`; the gate is never committed) and run `takode land gate try <file>` from a worktree whose port target is that branch, synced to the remote tip. It runs the draft on that checkout as it is without saving it, takes a `full-suite:<repo>` slot like `takode land test --full` (exit 3 when queued) and can take as long as the full suite. It has no base commit to compare with, so tests that already fail on the current code fail the try: report them with the draft rather than dropping checks to make it pass. Show the user the draft, the result and how long it took.

## After approval

Save exactly the approved file with `takode land gate save <file>` from a worktree whose port target is that branch (or pass `--branch <branch>`), and confirm with `takode land gate show`. Ports to that branch then go through the landing queue. Nothing in the repository changes, so there is nothing to commit or port. When the repository's test commands change later, the saved gate needs a matching `takode land gate save`.
