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
- **Base branch**: the branch to sync to (usually the parent branch)

## Port Workflow

Follow this workflow **exactly** when asked to port, sync, or push commits:

### 1. Check the main repo

Pull remote changes first:
```bash
git -C <BASE_REPO> fetch origin <BASE_BRANCH> && git -C <BASE_REPO> pull --rebase origin <BASE_BRANCH>
```

Then run `git -C <BASE_REPO> status`. If there are uncommitted changes, **stop and tell the user** -- another agent may have work in progress. Never run `git reset --hard`, `git checkout .`, or `git clean` on the main repo without explicit user approval.

Read any new commits briefly to understand what changed since your branch diverged.

### 2. Rebase in the worktree

Rebase your worktree branch onto the main repo's local base branch. Since all worktrees share the same git object store, the base branch is directly visible as a ref -- no fetch needed:
```bash
git rebase <BASE_BRANCH>
```

Resolve all merge conflicts here in the worktree -- this is the safe place to do it.

### 3. Cherry-pick clean commits to main

Once the worktree branch is cleanly rebased with your new commits on top, cherry-pick only your new commits into the main repo:
```bash
git -C <BASE_REPO> cherry-pick <commit-hash>
```

Cherry-pick one at a time in chronological order.

Track the resulting **main-repo SHAs** in the same order as you cherry-pick them. These synced SHAs are the ones that matter for quest verification metadata. Do not reuse the worktree-only pre-port SHAs when the main repo now has different cherry-picked copies.

### 4. Handle unexpected conflicts

If cherry-pick still conflicts (it shouldn't after a clean rebase), tell the user the conflicting files and ask how to proceed. Do not force-resolve or abort without asking.

### 5. Run the required pre-push gate

Run `git -C <BASE_REPO> log --oneline -5` to confirm the commits landed correctly.

For tracked code/test changes, verify the main repo before pushing with:
- focused affected tests for the accepted change
- `cd <BASE_REPO>/web && bun run test`
- `cd <BASE_REPO>/web && bun run typecheck`
- `cd <BASE_REPO>/web && bun run format:check`

`format:check` is the current lint/format-equivalent gate in this repo; there is no separate `lint` script right now.

If a full run is infeasible, the exception must already be explicit in the Port handoff or be reported before final acceptance. Do not silently narrow the gate to focused tests.

If the required pre-push gate fails:
- If the failure is likely related to the current quest or port, do not push. Report the failure and the main repo's unpushed sync state so the leader can route the worker back to fix it before the quest can be marked done.
- If the failure appears unrelated to the current port, do not hide it. Report the red-main risk explicitly; the leader should open an immediate fix quest unless there is already an active quest for that failure being worked by another leader.

### 6. Push

After the required pre-push gate passes or an explicit infeasibility exception is visible, push:
```bash
git -C <BASE_REPO> push origin <BASE_BRANCH>
```

### 7. Sync both worktree and local main branch

- Reset this worktree branch to match the base branch: `git reset --hard <BASE_BRANCH>`
- Fast-forward the local base branch in the main repo:
  ```bash
  git -C <BASE_REPO> checkout <BASE_BRANCH> && git -C <BASE_REPO> merge --ff-only origin/<BASE_BRANCH>
  ```

### 8. Run post-push sync verification

After resetting, verify that the worktree and main repo are synced to the pushed branch. Run cheap consistency checks such as `git status`, `git log --oneline -5`, and `git diff --check`, plus any post-push reruns required by the Port handoff or by non-obvious pre-push risk. If post-push verification fails, report it explicitly and route a fix before final quest closure.

## Completion Checklist

Do NOT report the sync as complete until ALL of the following are true:
- [ ] Main repo log shows the cherry-picked commits
- [ ] Required pre-push verification passed in the main repo, or an explicitly documented infeasibility exception is visible before final acceptance
- [ ] Worktree has been reset to match the main repo branch
- [ ] Required post-push sync verification has been run after the reset and passed
- [ ] Changes have been pushed to the remote

## Quest Status Rule

If you are working on a quest from this worktree session, do **NOT** transition it to `needs_verification` until the sync workflow above is fully complete, the main repo contains the changes, and the branch has been pushed. If sync is still pending, leave the quest `in_progress`.

If you are also the agent performing the verification handoff, attach the ordered synced SHAs when you submit:
```bash
quest complete q-N --items "..." --commits "sha1,sha2" --debrief-file /tmp/final-debrief.md --debrief-tldr-file /tmp/final-debrief-tldr.md
```
Port is not final quest closure. For every non-cancelled quest, final Memory owns structured final debrief metadata, durable-state closure, and the memory statement after accepted tracked changes are synced. Port should still preserve the context Memory will need: user-facing result, important verification, synced commits when relevant, and residual risks.

Every port handoff must report the ordered synced SHAs explicitly so the later handoff can attach them. Put them on a dedicated `Synced SHAs: sha1,sha2` line so final Memory or the leader can copy them directly into `quest complete`. Include a concise accepted-state summary, `Final debrief draft:`, or `Debrief TLDR draft:` when Port has context final Memory will need; the TLDR draft should preserve self-contained quest-journey understanding, not routine port mechanics. If the port worker cannot or should not draft those from available evidence, say so and ask the leader to route final Memory with the right context. Do **not** rely on `/port-changes` logs being parsed after the fact.

Documentation, skill, prompt, template, and other text-only tracked-file edits still count as commit-producing work. If they produced commits, they must be ported and attached to the quest with `quest complete ... --commit/--commits`; zero-tracked-change quests omit `port` from their explicit Journey plan when nothing was synced, but still end in `memory`.

Do not put port status, synced SHAs, or automated post-port verification results into `quest complete --items`. Verification items are for human-checkable acceptance checks only; port details and automated verification belong in the worker report and, for Quest Journey work, the Port phase documentation entry.

For Quest Journey work, add or refresh the current Port phase documentation before reporting back: ordered synced SHAs, post-port verification, port anomalies, remaining sync risks, and accepted-state context final Memory will need. Prefer `quest feedback add q-N --text-file ... --tldr-file ... --kind phase-summary` with current-phase inference; use explicit `--phase port` or occurrence flags if inference is unavailable. Structured commit metadata should carry routine port information, so do not add a second long port-summary or commit-by-commit timeline unless the porting itself was exceptional and materially worth calling out. The later final Memory handoff should attach those SHAs with `quest complete ... --commits ...`, not leave them only in feedback comments.
Keep routine commit hashes, branch names, command lists, and verification mechanics out of debrief TLDR drafts unless the exact detail is central to understanding the quest outcome.
