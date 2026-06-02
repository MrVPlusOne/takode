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

## Port Workflow

Follow this workflow **exactly** when asked to port, sync, or push commits:

### 1. Resolve and check the port target

There are two valid target modes:

- **Remote-backed target**: no "Port target worktree" is injected. Port into the **Base repo checkout** on **Base branch / port target**, then push `origin <BASE_BRANCH>`.
- **Worktree target**: "Port target worktree" is injected. Port into that exact checkout. Do not fetch, pull, push, or assume `origin/<BASE_BRANCH>` exists for this target unless the handoff explicitly says to publish it.

For a remote-backed target, first prove the base repo is on the intended branch before pulling or cherry-picking:
```bash
git -C <BASE_REPO> symbolic-ref --short HEAD
git -C <BASE_REPO> status
git -C <BASE_REPO> fetch origin <BASE_BRANCH> && git -C <BASE_REPO> pull --rebase origin <BASE_BRANCH>
```

If the current base-repo branch is not exactly `<BASE_BRANCH>`, stop and report the mismatch. Do not use `git checkout` or port into whatever branch is currently checked out.

For a worktree target, check the exact target checkout instead:
```bash
git -C <PORT_TARGET_WORKTREE> symbolic-ref --short HEAD
git -C <PORT_TARGET_WORKTREE> status
```

If the target worktree branch is not exactly `<BASE_BRANCH>`, stop and report the mismatch. If no "Port target worktree" is injected and `origin/<BASE_BRANCH>` does not exist, stop and report that the local-only target is missing operational worktree metadata.

If the selected target has uncommitted changes, **stop and tell the user** -- another agent may have work in progress. Never run `git reset --hard`, `git checkout .`, or `git clean` on the selected target without explicit user approval.

Read any new commits briefly to understand what changed since your branch diverged.

### 2. Rebase in the worktree

Rebase your worktree branch onto the port target branch. Since all worktrees share the same git object store, the target branch is directly visible as a ref -- no fetch needed after the target mode check:
```bash
git rebase <BASE_BRANCH>
```

Resolve all merge conflicts here in the worktree -- this is the safe place to do it.

### 3. Cherry-pick clean commits to the selected target

Once the worktree branch is cleanly rebased with your new commits on top, cherry-pick only your new commits into the selected target.

For a remote-backed target:
```bash
git -C <BASE_REPO> cherry-pick <commit-hash>
```

For a worktree target:
```bash
git -C <PORT_TARGET_WORKTREE> cherry-pick <commit-hash>
```

Cherry-pick one at a time in chronological order.

Track the resulting **target SHAs** in the same order as you cherry-pick them. These synced SHAs are the ones that matter for quest verification metadata. Do not reuse the worktree-only pre-port SHAs when the target now has different cherry-picked copies.

### 4. Handle unexpected conflicts

If cherry-pick still conflicts (it shouldn't after a clean rebase), tell the user the conflicting files and ask how to proceed. Do not force-resolve or abort without asking.

### 5. Run the required verification gate

Run `git -C <SELECTED_TARGET> log --oneline -5` to confirm the commits landed correctly.

For tracked code/test changes, verify the selected target before publishing or handing off with:
- focused affected tests for the accepted change
- `cd <SELECTED_TARGET>/web && bun --no-install run test`
- `cd <SELECTED_TARGET>/web && bun --no-install run typecheck`
- `cd <SELECTED_TARGET>/web && bun --no-install run format:check`

`format:check` is the current lint/format-equivalent gate in this repo; there is no separate `lint` script right now.

If the selected target is the base repo, this is the normal pre-push gate. If the selected target is a leader worktree, this is the pre-handoff gate for the leader target; do not run the full gate in the base repo unless the handoff explicitly asks for it.

If a full run is infeasible, the exception must already be explicit in the Port handoff or be reported before final acceptance. Do not silently narrow the gate to focused tests.

If the required gate fails:
- If the failure is likely related to the current quest or port, do not publish or hand off as complete. Report the failure and the target's sync state so the leader can route the worker back to fix it before the quest can be marked done.
- If the failure appears unrelated to the current port, do not hide it. Report the red-target risk explicitly; the leader should open an immediate fix quest unless there is already an active quest for that failure being worked by another leader.

### 6. Publish only remote-backed targets

For a remote-backed target, after the required pre-push gate passes or an explicit infeasibility exception is visible, push:
```bash
git -C <BASE_REPO> push origin <BASE_BRANCH>
```

For a worktree target, do not push by default. The port has landed in the leader's target worktree. Report that the target is local-only unless the handoff explicitly asked you to publish it.

### 7. Sync the worker worktree

Reset this worker worktree branch to match the target branch: `git reset --hard <BASE_BRANCH>`.

For remote-backed targets, if the base repo was the selected target and is already on `<BASE_BRANCH>`, fast-forward from origin after push with:
```bash
git -C <BASE_REPO> merge --ff-only origin/<BASE_BRANCH>
```

Do not run `git checkout <BASE_BRANCH>` in the base repo as a cleanup shortcut. If the base repo is not already on `<BASE_BRANCH>`, that should have been caught in step 1 and the port should have stopped.

### 8. Run post-sync verification

After resetting, verify that the worker worktree and selected target are synced. Run cheap consistency checks such as `git status`, `git log --oneline -5`, and `git diff --check` in both the worker worktree and selected target, plus any post-push/post-handoff reruns required by the Port handoff or by non-obvious verification risk. If post-sync verification fails, report it explicitly and route a fix before final quest closure.

## Completion Checklist

Do NOT report the sync as complete until ALL of the following are true:
- [ ] Selected target log shows the cherry-picked commits
- [ ] Required verification passed in the selected target, or an explicitly documented infeasibility exception is visible before final acceptance
- [ ] Worker worktree has been reset to match the target branch
- [ ] Required post-sync verification has been run after the reset and passed
- [ ] Remote-backed targets have been pushed to the remote, or worktree targets are explicitly reported as local-only target ports

## Quest Status Rule

If you are working on a quest from this worktree session, do **NOT** transition it to `needs_verification` until the sync workflow above is fully complete, the selected target contains the changes, and any required push for a remote-backed target has completed. If sync is still pending, leave the quest `in_progress`.

If you are also the agent performing the verification handoff, attach the ordered synced SHAs when you submit:
```bash
quest complete q-N --commits "sha1,sha2" --debrief-file /tmp/final-debrief.md --debrief-tldr-file /tmp/final-debrief-tldr.md
```
Port is not final quest closure. For every non-cancelled quest, final Memory owns final User review check settlement, structured final debrief metadata, durable-state closure, and the memory statement after accepted tracked changes are synced. Port should still preserve the context Memory will need: user-facing result, important verification, synced commits when relevant, and residual risks.

Every port handoff must report the ordered synced SHAs explicitly so the later handoff can attach them. Put them on a dedicated `Synced SHAs: sha1,sha2` line so final Memory or the leader can copy them directly into `quest complete`. Include a concise accepted-state summary, `Final debrief draft:`, or `Debrief TLDR draft:` when Port has context final Memory will need; the TLDR draft should preserve self-contained quest-journey understanding, not routine port mechanics or raw hashes already present in the dedicated line. If the port worker cannot or should not draft those from available evidence, say so and ask the leader to route final Memory with the right context. Do **not** rely on `/port-changes` logs being parsed after the fact.

Every port handoff must also identify the target used, for example `Port target used: <BASE_REPO> <BASE_BRANCH>` or `Port target used: <PORT_TARGET_WORKTREE> <BASE_BRANCH>`. This matters when the worker was spawned from a worktree-backed leader because the correct target is the leader's branch/worktree target rather than the repository's default branch.

Do not add routine `memory update not needed` statements during Port. Include memory-specific evidence only when material: a completed memory write explicitly assigned to Port, a deferral for final Memory or a curator, relevant memory files/decisions inspected, or accepted facts final Memory needs for durable-memory triage.

If Port is explicitly assigned memory writing, memory record frontmatter `source` should use the quest ID (`q-N`) as primary provenance for quest-backed updates and should not routinely add `commit:*` or `session:*` sources. Use `session:<id>` only when no corresponding quest exists or the session itself is the durable source of truth, and preserve exceptional `commit:*` or `session:*` sources for non-quest updates where that provenance is genuinely authoritative.

Documentation, skill, prompt, template, and other text-only tracked-file edits still count as commit-producing work. If they produced commits, they must be ported and attached to the quest with `quest complete ... --commit/--commits`; zero-tracked-change quests omit `port` from their explicit Journey plan when nothing was synced, but still end in `memory`.

Do not put port status, synced SHAs, or automated post-port verification results into `quest complete --items`. User review checks are only for things the user still needs to inspect or do after completion; port details and automated verification belong in the worker report and, for Quest Journey work, the Port phase documentation entry. Empty User review checks are normal when no user action remains.

For Quest Journey work, add or refresh the current Port phase documentation before reporting back: ordered synced SHAs, post-port verification, port anomalies, remaining sync risks, accepted-state context final Memory will need, and memory-specific evidence only when material. Prefer `quest feedback add q-N --text-file ... --tldr-file ... --kind phase-summary` with current-phase inference; use explicit `--phase port` or occurrence flags if inference is unavailable. Structured commit metadata should carry routine port information, so do not add a second long port-summary or commit-by-commit timeline unless the porting itself was exceptional and materially worth calling out. The later final Memory handoff should attach those SHAs with `quest complete ... --commits ...`, not leave them only in feedback comments.
Keep routine commit hashes, branch names, command lists, and verification mechanics out of debrief TLDR drafts unless the exact detail is central to understanding the quest outcome. If structured commit metadata or the dedicated `Synced SHAs:` line already carries the exact identifiers, summarize the accepted state without repeating the hashes.
