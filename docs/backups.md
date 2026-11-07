# Backups

Takode keeps its important data on one machine, the coordinator: quests, memory notes, settings, to-dos, the Library and your instructions and skills. If that machine's disk is lost, or something on it deletes or overwrites those files, they are gone. Backups copy the data about once an hour to destinations you pick, and check once a week that the copy can be restored. There are two kinds of destination, and you can use either or both:

- **A private Git repository**, such as one on GitHub, which every backup pushes to.
- **A Git repository on one of your machines** running `takode node`, such as your laptop. While the machine is online, it pulls each new backup. While it is offline, its copy waits and catches up when it is back.

The whole backup was about 0.7 GB in November 2026, memory history and every image included. After the first copy, a run takes seconds and adds only what changed, mostly new images and Library files.

## What is backed up

| Data | In the backup |
|---|---|
| Quests and their images | yes; one file per quest |
| Memory (every session space with notes) | yes; each space's full Git history |
| Settings | yes, without secrets |
| To-dos, cron jobs, streams, landing gates and queue, work tracks, session groups, new-session defaults | yes |
| Library (topics, posts, artifacts and their files) | yes |
| Your instructions and skills (the store's content) | yes |
| Machines (hosts and their Claude and Codex programs) | yes; only token hashes, no tokens |
| Sessions | the list of sessions with their numbers and names only |

Left out on purpose:

- **Secrets:** API keys, Pushover keys, env profiles, the browser login password, web-push keys, host and session tokens. You re-enter them after a restore.
- **Session histories and agent transcripts:** they are large, and resuming a session also needs its Claude or Codex state.
- **Machine-local state:** logs, leases, worktree checkouts, recordings, and agent working files under `~/.companion/artifacts`.
- **Questmaster's own local snapshots** (`~/.companion/questmaster-backups`): they are copies of data that is already backed up.

The same list of coordinator data drives moving the coordinator ([moving-the-coordinator.md](moving-the-coordinator.md)); `web/server/coordinator-state.ts` holds it.

## How it works

- **Who runs it:** the Takode server (production only) runs a backup once an hour, and right away when a destination is set or changed.
  - Each run is a child process, `web/server/backup/backup-job.ts`, so the server never waits on it.
  - A run writes a snapshot into a local clone, `~/.companion/backup/repo`, commits it if anything changed, and pushes it to the repository, if one is set.
- **The machine copy:** after each run, and at the next check after the machine comes back online, the server has the machine fetch the new commits (`backup-host-sync.ts`).
  - The fetch runs on the machine through its node, like `takode exec`, and reaches the coordinator through the node's API proxy.
  - The coordinator serves the clone to it read-only, with Git's own `http-backend` (`backup-git-server.ts`), at `/api/backup/git/`.
  - Each sync makes a fresh token that opens only that path, only until the sync ends. Nothing else about the machine's access changes.
  - The machine's folder becomes a bare repository on the first sync if it is new or empty; a folder holding anything else is refused.
- **What it holds:** each destination holds everything, on branches named by the server's slug (`prod` below):
  - `takode/prod/data`: the snapshot. Paths mirror `~/.companion`; quests are one file each in `questmaster-live/quests/`, as the quest store keeps them (a store a server has not moved there yet is split the same way). Migration leftovers such as `store.json.before-per-quest-files` stay out. `manifest.json` lists every file with its SHA-256 hash, the quest count and the memory commit each memory branch had.
  - `takode/prod/memory/<space>`: each memory repo's own history, so the memory commits that quests cite stay valid. Pushing them with the data makes separate memory pushes unnecessary. Branches were chosen over submodules: a submodule records only a commit, and the memory repo would still need a remote of its own.
- **History is never rewritten:** Takode never force-pushes or force-fetches.
  - If a memory repo on the coordinator is rewound or rewritten, the backup refuses the change, keeps the history it had and reports the run as failed.
  - With the repository rule below, a mistake on the coordinator cannot rewrite what is already backed up. The machine copy needs no rule: it fetches without forcing, so it refuses rewritten history even if the coordinator's clone was changed.
- **Restore test:** once a week the server clones the latest snapshot into a scratch folder, checks every file against the manifest, restores it and reads the quest store back with the store's own loader, and checks the memory branches.
  - It tests the repository when one is set, and otherwise the coordinator's clone.
  - Each machine sync checks that the copy then holds exactly the clone's commits.
- **Alerts:** your phone is alerted once three runs (or three machine syncs) in a row have failed, and whenever a restore test fails. A machine that is offline is waiting, not failing.
- **Status:** Settings > Backups and `takode backup status` show the last backup, the machine copy, the last restore test and any failures.

A development or validation server never backs up on its own, because it may run on a copy of the live settings. Its "Back up now" still works.

## Setting up a backup repository

An agent working in the Takode repository can do this, or the machine copy below, with the user; the `takode-backups` skill has the steps.

1. **Create an empty private repository** on an account the coordinator machine can push to, for example `gh repo create <owner>/takode-backup --private`.
   - The data includes the content of your quests and memory, so choose the account accordingly: a work account if they hold work material.
   - Anyone with access to that repository can read it.
2. **Protect the backup branches** so nothing can force-push over them or delete them. On GitHub, add a ruleset for branches matching `takode/**` with "Restrict deletions" and "Block force pushes".
   - Rulesets on private repositories need a paid or organization plan. Without one, classic branch protection rules for `takode/**` do the same.
3. **Check that the coordinator can push** with its own Git credentials, and without a password prompt, which nothing can answer: `git ls-remote <url>` on the coordinator, as the user the server runs as. Use the HTTPS or SSH URL that works there, with no credentials in the URL.
4. **Set it in Settings > Backups**, or with `takode backup set-repo <url>`. The first backup starts at once. It sends every image and Library file, so it takes a few minutes; later runs take seconds.
5. **Check:** `takode backup status` should show a successful backup. Then run `takode backup test` and check that it passes.

## Setting up a copy on one of your machines

1. **Pick the machine and a folder** on it. The machine must be registered with the coordinator (`takode host list`), and the folder must be new or empty, for example `~/Backups/takode.git`. The copy holds the same data as a repository would, so choose a machine whose disk is safe enough for it, such as one with its own backups or disk encryption.
2. **Set it:** in Settings > Backups, choose the machine, enter the folder and save; or run `takode backup set-machine <machine> <folder>`. A backup starts, and the machine fetches it right away if it is online. The first copy carries everything through the machine's tunnel, so it can take a while.
3. **Check:** `takode backup status` shows when the copy was last updated, or why it waits.

To stop backing up to one destination, clear it in Settings, or run `takode backup off --repo` or `takode backup off --machine`. `takode backup off` stops both. Existing copies and the local clone stay as they are.

## Restore

`takode backup restore` rebuilds a `~/.companion` folder from a backup copy into an empty folder. It needs no running server and touches nothing live. The copy can be the repository's URL, or the folder of a machine copy, given on that machine or reached over SSH:

```bash
takode backup restore --repo <url or folder> --to ~/takode-restore/.companion
```

It checks every file against the manifest first, copies the files (a snapshot written before quests were one file each has its quests joined back into `store.json`, which the server moves at its next start), and clones each memory branch into `memory/<slug>/<space>` on `main`. If the repository backs up more than one server, name one with `--slug <slug>`.

To use the restored data:

1. **Stop the Takode server** on the machine.
2. **Move the current `~/.companion` aside** if there is one; never delete it. Then move the restored folder into its place.
3. **On a rebuilt machine, give it its old name before the first start:** `{"name": "devbox"}` in `~/.companion/machine.json`, using the name in the snapshot's `manifest.json` (`machine`). Notes are stamped with the machine they were written on, and a different name would make old notes look as if they came from elsewhere.
4. **Restore the instructions and skills checkout:** if your store links into a Git checkout, clone it at the same path. The backup holds the store's files as plain folders, which also work.
5. **Start the server and re-enter the secrets:**
   - API keys in Settings > Voice Input and the session namer;
   - Pushover keys;
   - env profiles;
   - the login password.

   Hosts reconnect with their existing tokens. Sessions appear in the list, stopped; their histories were not backed up.
6. **Set the backup destinations again** if you want the restored server to keep backing up. Both continue the same history.

Restore only into an empty folder, and keep the old data until the restored server works. To try a restore without touching anything, run `takode backup test`, which does all of the above in a scratch folder except starting a server.
