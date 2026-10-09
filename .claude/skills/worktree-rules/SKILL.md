---
name: worktree-rules
description: "Port changes from a git worktree to the main repository. This is the skill behind `/port-changes`; `worktree-rules` remains the underlying skill slug/directory. Use when asked to 'port changes', 'sync to main', 'push to main repo', '/port-changes', or when porting worktree commits."
---

# Worktree Rules (`/port-changes`) -- Worktree Porting Workflow

This skill's runtime slug/directory is `worktree-rules`. When a leader or worker is told to use `/port-changes`, this is the skill they should load.

The `/port-changes` command ports commits from the current worktree session to the main repository. Only use this in worktree sessions.

## Context

Every worktree session has these variables injected via system prompt:
- **Worktree branch**: the `-wt-N` branch you're working on
- **Base repo checkout**: the main repository path
- **Base branch / port target**: the branch to sync to. For workers spawned by a worktree-backed leader, this is the leader's target branch/worktree branch, not the leader worktree's parent/default branch.
- **Port target worktree**: optional. When present, this is the exact checkout that should receive the cherry-picked commits. This is how workers port to a leader's current local worktree branch when that branch is not remote-backed.

If approved delivery work requires an additional checkout, follow the shared **Additional Worktrees** launch guidance and register it with `takode worktree register` immediately after creation. Use `retained` for publication/shared/long-running targets or uncertain ownership; a temporary registration needs an explicit cleanup base. Registration does not authorize adopting old paths. Checkout removal and branch deletion are separate decisions. Original-worker archive keeps force-removal and may retire only proven disposable, exclusively owned branch names with committed-tip recovery; shared/user-owned/retained branches stay. Follow the shared launch guidance for an explicit branch-retention flag; inspect registration and cleanup outcomes with `takode worktree list`.

## Choose the landing path

- **Remote-backed target with a saved landing gate**: land through the **landing queue** below. It replaces the classic remote-backed port for these branches. The gate (the branch's full verification commands) is saved per repository branch on the Takode server, not in the repository; `takode land gate show` in your worktree tells you whether your target has one.
- **Worktree target**, a remote-backed target **without** a saved gate, or a server that answers that it has no landing queue or does not store landing gates yet (it needs a restart onto a newer build): use the **classic port workflow** further down. Opting a branch in or out (`takode land gate try` / `save` / `remove`) changes how everyone lands on it, so do it only when your leader or the user asked for it.
- **Approved independent publication** outside the inherited target: the "Independent published targets" section of [port-tracking.md](references/port-tracking.md).

## Landing queue (remote-backed targets with a saved landing gate)

Ready changes wait in a queue per remote branch. One landing run at a time, started by whoever holds the branch's port lease `port:<REPO>:<BASE_BRANCH>`, stacks every waiting change on the remote tip, runs the gate once on the combined tree and pushes exactly the commit it gated. A change that conflicts or brings new gate failures bounces back to its owner; the rest land after a fresh gate without it. `<REPO>` is the repository name from the base checkout's `origin` URL (`port:takode:jiayi` for Takode on `jiayi`, on every machine). Run `takode land --help` for the commands.

1. **Rebase onto the remote branch.** `git fetch origin <BASE_BRANCH>`, then rebase only your verified private suffix in your worktree: `git rebase --onto origin/<BASE_BRANCH> <VERIFIED_PRIVATE_BASE_SHA>`. Resolve conflicts here. If you use port tracking, first bring the base checkout to the same commit with `git -C <BASE_REPO> pull --ff-only origin <BASE_BRANCH>` (only when it is on `<BASE_BRANCH>` and clean; otherwise stop and report), then prepare, squash and seal as described in [port-tracking.md](references/port-tracking.md). No lease is needed for any of this.
2. **Run the pre-submit gate:** `takode land test`. It runs the branch's saved gate on your branch, reruns failing test files once (tests that then pass are flaky) and checks still-failing tests on your base commit (failures that also happen there are pre-existing, such as a machine's environment-only failures). Only new failures fail it; fix them. It takes a slot of the per-machine `full-suite:<REPO>` lease pool, which caps concurrent full runs on that machine; if it exits 3 (queued), end your turn and rerun it when the Resource Lease message arrives. The run can take 10+ minutes, so run it as a background or long-running command. If a full run is infeasible, `takode land submit --skip-test "<reason>"` records the exception.
3. **Submit:** `takode land submit q-N [--preparation <id>]`, then end your turn. Your commits travel to the queue as a bundle, so this works the same from any machine; a worker on another machine than its port target submits directly instead of using `takode bundle send`.
4. **If a Resource Lease message for `port:<REPO>:<BASE_BRANCH>` arrives,** your change is still waiting and you are next: run `takode land run` (it starts the background landing run for every waiting change and returns), then end your turn. The run renews and releases the lease itself. Never hold the port lease while testing or editing.
5. **On "landed"** (a Landing Queue message with your target SHAs): run `takode land finish q-N` in your worktree. It fast-forwards the base checkout, records port-tracking receipts (including changes integrated with others in the same batch), resets your worktree to the branch and prints the `Synced SHAs:` line and the `work-to-memory` command. Then write the Work note and run the guarded transition below.
6. **On "bounced":** read the reason and failing output, fix or rebase onto `origin/<BASE_BRANCH>`, rerun `takode land test`, re-prepare with `--previous <id>` if you use port tracking (allowed after a bounce), squash, seal and submit again.

`takode land status` shows the queue, the running batch and its phase. An owner or its leader can `takode land withdraw <entry-id>` a waiting change. If a landing run dies, its lease expires (or a leader force-releases it) and the next run checks whether its push reached the remote before landing anything else. Do not cherry-pick into or push the shared base checkout yourself on this path.

## Classic port workflow

Follow this workflow **exactly** when the landing queue does not apply (see "Choose the landing path"):

### 1. Resolve and check the port target

For an explicitly approved independent publication outside the inherited target, use the "Independent published targets" section in [port-tracking.md](references/port-tracking.md). Record its approved delivery target instead of moving unrelated branches. The following port workflow applies when code actually needs to land in the inherited target.

There are two valid target modes:

- **Remote-backed target**: no "Port target worktree" is injected. Port into the **Base repo checkout** on **Base branch / port target**, one port at a time under the port lease, then push your own commits to `origin <BASE_BRANCH>`.
- **Worktree target**: "Port target worktree" is injected. Port into that exact checkout. Do not fetch, pull, push, or assume `origin/<BASE_BRANCH>` exists for this target unless the handoff explicitly says to publish it.

For a remote-backed target, first inspect the base repo branch and compare the output to `<BASE_BRANCH>`:
```bash
git -C <BASE_REPO> symbolic-ref --short HEAD
```

If the current base-repo branch is not exactly `<BASE_BRANCH>`, stop and report the mismatch. Do not use `git checkout` or port into whatever branch is currently checked out.

The target branch is shared by every worker that ports to it, from any machine, and a push publishes everything on the checkout's branch. So remote-backed ports land one at a time: acquire the target's port lease before checking status and pulling, and hold it until your push in step 7 completes. The key is `port:<REPO>:<BASE_BRANCH>`, where `<REPO>` is the repository name in the base repo's `origin` URL (`basename -s .git "$(git -C <BASE_REPO> remote get-url origin)"`), not a local path, so a port of the Takode repo to `jiayi` uses `port:takode:jiayi` on every machine (the base checkout directory is `companion`, but the repository is `takode`). Takode never adds `@<host>` to a `port:` key, so ports from any machine queue in the same pool. Use only this key; other names for the same target, such as `git:<REPO>` or `port:<REPO>` without the branch, do not coordinate with it.
```bash
takode lease acquire port:<REPO>:<BASE_BRANCH> --purpose "Port <quest or change> to <BASE_BRANCH>" --ttl 30m --wait
```

Run this command on its own; never chain fetch, pull or any other port step after it. Exit 0 means you hold the lease. Exit 3 with `QUEUED` means you do not: run nothing against the target, end your turn, and continue from the status check below only after the Resource Lease message says you hold `port:<REPO>:<BASE_BRANCH>`. A long wait here is the signal described in "Suggest the landing queue when ports are slow" below.

While you hold the lease, nothing else lands on the target, so the gate you run in your worktree (step 3) covers exactly what you will push. Renew the lease if the gate runs long. If you stop before landing anything (gate failure, rebase conflict, a question for the user), release the lease, and start again from this step when ready because the target may have moved. If you stop after landing commits but before pushing, keep the lease and report.

Only after the current branch is proven to match `<BASE_BRANCH>`, check status and pull remote changes:
```bash
git -C <BASE_REPO> status
git -C <BASE_REPO> fetch origin <BASE_BRANCH> && git -C <BASE_REPO> pull --ff-only origin <BASE_BRANCH>
```

If the remote and local target diverge, stop and reconcile without rewriting landed history. Do not rebase, reset, or force-push the shared target.

For a worktree target, check the exact target checkout instead:
```bash
git -C <PORT_TARGET_WORKTREE> symbolic-ref --short HEAD
git -C <PORT_TARGET_WORKTREE> status
```

If the target worktree branch is not exactly `<BASE_BRANCH>`, stop and report the mismatch. If no "Port target worktree" is injected and `origin/<BASE_BRANCH>` does not exist, stop and report that the local-only target is missing operational worktree metadata.

If the selected target has uncommitted changes, **stop and tell the user** -- another agent may have work in progress. Never run `git reset --hard`, `git checkout .`, or `git clean` on the selected target without explicit user approval.

Read any new commits briefly to understand what changed since your branch diverged.

Before rewriting new private Work, read [port-tracking.md](references/port-tracking.md). Prepare and seal only after taking the lease and rebasing (step 2), so the target cannot move under a sealed preparation. Use `takode port prepare` to retain reviewed increments and verify the private boundary; the helper records exact source/squashed/target relationships and flags partial or uncertain ports. Keep already-landed history and independent meaningful changes intact.

### 2. Rebase in the worktree

Rebase your worktree branch onto the port target branch. Since all worktrees share the same git object store, the target branch is directly visible as a ref -- no fetch needed after the target mode check:
```bash
git rebase --onto <BASE_BRANCH> <VERIFIED_PRIVATE_BASE_SHA>
```

Resolve all merge conflicts here in the worktree -- this is the safe place to do it. Review integration changes, refresh retained review when the base/SHAs changed, then squash cohesive private groups and run `takode port seal` as described in the tracking reference. The helper verifies resulting trees and parents; it does not replace review or run Git rewriting commands for you.

### 3. Run the required gate

For tracked code/test changes, run the full gate:
- focused affected tests for the accepted change
- `cd <GATE_CHECKOUT>/web && bun --no-install run test`
- `cd <GATE_CHECKOUT>/web && bun --no-install run typecheck`
- `cd <GATE_CHECKOUT>/web && bun --no-install run format:check`

`format:check` is the current lint/format-equivalent gate in this repo; there is no separate `lint` script right now.

On this classic path this gate is the delivery's full test-suite run. Use focused tests while iterating in Work rather than also running the full suite there.

For a remote-backed target, run it now in your worker worktree (`<GATE_CHECKOUT>` is the worktree), after the rebase and seal and while holding the port lease. Your worktree then has exactly the tree the target will have after the cherry-picks, so this is the pre-push gate, and nothing unverified ever sits on the shared checkout.

For a worktree target, skip this step and run the same gate against the target in step 6. Do not run the full gate in the base repo unless the handoff explicitly asks for it.

If a full run is infeasible, the exception must already be explicit in the Work handoff or be reported before final acceptance. Do not silently narrow the gate to focused tests.

If the required gate fails:
- If the failure is likely related to the current quest or port, do not land, publish, or hand off as complete. Report the failure and the target's sync state so the leader can route the worker back to fix it before the quest can be marked done. For a remote-backed target nothing has landed yet: release the port lease.
- If the failure appears unrelated to the current port, do not hide it. Report the red-target risk explicitly; the leader should open an immediate fix quest unless there is already an active quest for that failure being worked by another leader.

### 4. Cherry-pick clean commits to the selected target

Once the worktree branch is cleanly rebased with your new commits on top, cherry-pick only your new commits into the selected target.

For a remote-backed target:
```bash
git -C <BASE_REPO> cherry-pick <commit-hash>
```

For a worktree target:
```bash
git -C <PORT_TARGET_WORKTREE> cherry-pick <commit-hash>
```

Cherry-pick one at a time in chronological order. Immediately run `takode port landed` for each exact worker/target SHA pair, including partial ports. Do not infer a private range from missing quest metadata or rewrite an already-landed prefix.

Track the resulting **target SHAs** in the same order as you cherry-pick them. These synced SHAs are the ones that matter for quest verification metadata. Do not reuse the worktree-only pre-port SHAs when the target now has different cherry-picked copies.

Run `git -C <SELECTED_TARGET> log --oneline -5` to confirm the commits landed correctly. For a remote-backed target, also confirm from your worktree that the target now has exactly the tree your gate ran on:
```bash
test "$(git -C <BASE_REPO> rev-parse 'HEAD^{tree}')" = "$(git rev-parse 'HEAD^{tree}')"
```

If the trees differ, something landed on the target that your gate did not cover. Do not push; keep the lease and report.

### 5. Handle unexpected conflicts

If cherry-pick still conflicts (it shouldn't after a clean rebase), tell the user the conflicting files and ask how to proceed. Do not force-resolve or abort without asking.

### 6. Run the pre-handoff gate on a worktree target

For a worktree target, run the step 3 gate against the target before handing off (`<GATE_CHECKOUT>` is `<PORT_TARGET_WORKTREE>`). The same infeasibility and failure rules apply. Remote-backed targets were already gated in step 3.

### 7. Publish only remote-backed targets

For a remote-backed target, after the step 3 gate passes or an explicit infeasibility exception is visible, list what the push will publish, push your last landed target SHA rather than the branch, and release the port lease:
```bash
git -C <BASE_REPO> log --oneline origin/<BASE_BRANCH>..<LAST_TARGET_SHA>
git -C <BASE_REPO> push origin <LAST_TARGET_SHA>:refs/heads/<BASE_BRANCH>
takode lease release port:<REPO>:<BASE_BRANCH>
```

The log must list only your own landed target SHAs. If it lists anything else, do not push; keep the lease and report. Pushing the explicit SHA means a commit that someone lands without the lease is never published with yours. If the push is rejected because the remote moved, do not force-push; keep the lease and reconcile as in step 1.

For a worktree target, do not push by default. The port has landed in the leader's target worktree. Report that the target is local-only unless the handoff explicitly asked you to publish it.

### 8. Sync the worker worktree

Confirm `takode port status` reports the preparation landed and that no additional worker changes would be discarded. Preserve/reconcile any uncertain or partial state before cleanup. Reset this worker worktree branch to match the target branch: `git reset --hard <BASE_BRANCH>`.

For remote-backed targets, if the base repo was the selected target and is already on `<BASE_BRANCH>`, fast-forward from origin after push with:
```bash
git -C <BASE_REPO> merge --ff-only origin/<BASE_BRANCH>
```

Do not run `git checkout <BASE_BRANCH>` in the base repo as a cleanup shortcut. If the base repo is not already on `<BASE_BRANCH>`, that should have been caught in step 1 and the port should have stopped.

### 9. Run post-sync verification

After resetting, verify that the worker worktree and selected target are synced. Run cheap consistency checks such as `git status`, `git log --oneline -5`, and `git diff --check` in both the worker worktree and selected target, plus any post-push/post-handoff reruns required by the Port handoff or by non-obvious verification risk. If post-sync verification fails, report it explicitly and route a fix before final quest closure.

## Suggest the landing queue when ports are slow

When a classic port to a remote-backed target waits a long time for its port lease, for example queued behind several other ports or for longer than a full gate run, and the branch has no saved landing gate (`takode land gate show` says none is saved), the repository may be ready for the landing queue. Do not stop or change your port; finish it on the classic path. Then mention the wait and the possible fix once in your next report to your leader, who decides whether to bring it to the user. Without a leader, suggest it to the user at the end of your turn, unless they already declined it for that repository. If the user takes it up, [landing-gate-setup.md](references/landing-gate-setup.md) has what to explain and how to draft and try the gate for their approval; never save a gate the user has not approved.

## Completion Checklist

On the landing queue, the sync is complete once the Landing Queue message says your change landed and `takode land finish` has run cleanly: the landing run already gated the pushed tree, pushed it and fast-forwarded the base checkout, and `finish` reset your worktree and printed the `Synced SHAs:` line.

On the classic workflow, do NOT report the sync as complete until ALL of the following are true:
- [ ] Selected target log shows the cherry-picked commits
- [ ] Required verification passed (in the worker worktree before landing for a remote-backed target, in the target for a worktree target), or an explicitly documented infeasibility exception is visible before final acceptance
- [ ] Worker worktree has been reset to match the target branch
- [ ] Required post-sync verification has been run after the reset and passed
- [ ] Remote-backed targets have been pushed to the remote up to your last landed target SHA and the port lease is released, or worktree targets are explicitly reported as local-only target ports

## Quest Work-to-Memory Rule

If you are working on a Quest Journey from this worktree session, do **not** enter Memory until the sync workflow above is fully complete, the selected target contains the changes, and any required push for a remote-backed target has completed. If sync is still pending, leave the quest in Work.

The worker-owned Work -> Memory transition is also the structured code-evidence boundary. For tracked changes, attach the ordered synchronized **target SHAs** in the transition itself:

```bash
takode board work-to-memory q-N --work-note <feedback-index> --commits "sha1,sha2"
```

For a quest that produced genuinely zero git-tracked changes, use the explicit zero-code mode instead:

```bash
takode board work-to-memory q-N --work-note <feedback-index> --no-code
```

For tracked preparations, pass `--preparation <id>` to attach retained review provenance. The guarded response includes the exact delivery ID for leader-authored `quest commit-links` chips. Supply exactly one mode. Documentation, skill, prompt, template, and other tracked text edits are commit-producing Work and must use `--commit` / `--commits`, not `--no-code`. Use merged/cherry-picked selected-target SHAs rather than worktree-only pre-port SHAs. On rework, pass the current Work occurrence's new synchronized target SHAs even when older commits are already attached; old metadata does not replace fresh transition evidence.

The guarded transition persists code commit metadata before the board enters `MEMORY`, so commit counts and diff controls are available immediately while final Memory runs. Final Memory must not be the first phase to attach accepted Work code SHAs. If code evidence is missing or only present in prose, route back to Work. Memory may later attach only separate file-based memory-repository commits with `--memory-commit` / `--memory-commits`.

Sync/push is not final quest closure. Final Memory still owns final User review check settlement, structured final debrief metadata, durable-state closure, quest metadata reconciliation, and the memory statement after accepted tracked changes and their code metadata are settled.

Every sync handoff must report the ordered target SHAs explicitly on a dedicated `Synced SHAs: sha1,sha2` line and identify the target used, for example `Port target used: <BASE_REPO> <BASE_BRANCH>` or `Port target used: <PORT_TARGET_WORKTREE> <BASE_BRANCH>`. The Work note and compact chat handoff preserve audit and routing context, while the transition carries the authoritative structured code metadata. Do **not** rely on `/port-changes` logs being parsed after the fact.

Include a concise accepted-state summary, `Final debrief draft:`, or `Debrief TLDR draft:` when Work has context final Memory will need. The TLDR draft should preserve self-contained quest-journey understanding, not routine sync mechanics or raw hashes already present in structured metadata and the dedicated line.

Do not put sync status, synced SHAs, or automated verification results into `quest complete --items`. User review checks are only for things the user still needs to inspect or do after completion; sync details and automated verification belong in the Work note and final debrief metadata. Empty User review checks are normal when no user action remains.

For Quest Journey work, add or refresh the current Work phase documentation before reporting back: ordered synced SHAs, verification, sync anomalies, remaining sync risks, accepted-state context final Memory will need, and memory-specific evidence only when material. Prefer `quest feedback add q-N --text-file ... --tldr-file ... --kind phase-summary` with current-phase inference; use explicit `--phase work` or occurrence flags if inference is unavailable. Structured commit metadata should carry routine sync information, so do not add a second long sync-summary or commit-by-commit timeline unless the syncing itself was exceptional and materially worth calling out.

Do not add routine `memory update not needed` statements during Work-owned sync. Include memory-specific evidence only when material: a completed memory write explicitly assigned to Work, a deferral for final Memory or a curator, relevant memory files/decisions inspected, or accepted facts final Memory needs for durable-memory triage.

If Work is explicitly assigned memory writing, memory record frontmatter `source` should use the quest ID (`q-N`) as primary provenance for quest-backed updates and should not routinely add `commit:*` or `session:*` sources. Use `session:<id>` only when no corresponding quest exists or the session itself is the durable source of truth, and preserve exceptional `commit:*` or `session:*` sources for non-quest updates where that provenance is genuinely authoritative.

Keep routine commit hashes, branch names, command lists, and verification mechanics out of debrief TLDR drafts unless the exact detail is central to understanding the quest outcome. If structured commit metadata or the dedicated `Synced SHAs:` line already carries the exact identifiers, summarize the accepted state without repeating the hashes.
