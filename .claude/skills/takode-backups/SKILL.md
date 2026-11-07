---
name: takode-backups
description: "Use when the user asks to set up, check, fix or restore Takode backups: creating a private backup repository and connecting it in Settings > Backups or with takode backup set-repo, keeping a copy on their laptop or another machine (takode backup set-machine), protecting branches, failed backup alerts, restore tests, or restoring quests, memory, settings and to-dos after data loss. Also read before changing what Takode backs up (web/server/backup/, coordinator-state.ts)."
---

# Takode backups

Takode backs up the coordinator's durable data about once an hour to the destinations the user picked (a private Git repository, a Git repository on one of their machines, or both) and tests a restore once a week. [docs/backups.md](../../../docs/backups.md) explains what is kept, the branch layout and the restore steps; read it first. The `takode backup` commands act through the server (`takode backup --help`).

## Setting up a repository with the user

The user decides the account and the repository; nothing leaves the machine until the setting points at a repository they chose.

1. Ask which GitHub account (or other Git host) should hold it. Say plainly that the backup holds the content of their quests, memory, settings (without secrets), to-dos, Library and instructions, and that anyone with access to the repository can read it. If those hold work material, a work account fits.
2. With their OK, create an empty private repository, for example `gh repo create <owner>/takode-backup --private`, or let them pick an existing empty one.
3. Protect the backup branches against force-pushes and deletion, so a mistake on the machine cannot rewrite the backups: a ruleset on `takode/**` with "Restrict deletions" and "Block force pushes", for example
   `gh api repos/<owner>/<repo>/rulesets -X POST --input -` with `{"name":"Protect Takode backups","target":"branch","enforcement":"active","conditions":{"ref_name":{"include":["refs/heads/takode/**"],"exclude":[]}},"rules":[{"type":"deletion"},{"type":"non_fast_forward"}]}`.
   If rulesets are not available for the repository, use classic branch protection for `takode/**`, or tell the user that this protection is missing.
4. On the coordinator, as the user the Takode server runs as, check `git ls-remote <url>` works without a prompt. Use a URL without credentials in it (Settings refuses those).
5. Set it with `takode backup set-repo <url>` (or the user does in Settings > Backups). The first backup sends everything and takes a few minutes; follow it with `takode backup status`.
6. When it succeeded, run `takode backup test` and confirm the restore test passes. Report both to the user.

## Setting up a copy on one of the user's machines

1. Ask which registered machine (`takode host list`) and which folder. The folder must be new or empty; suggest `~/Backups/takode.git`. Point out that the copy is only as safe as that machine's disk.
2. Set it with `takode backup set-machine <machine> <folder>` (or the user does in Settings > Backups). The machine fetches through its node while online; an offline machine waits and catches up later.
3. Check `takode backup status` until the machine copy shows as updated, and report it.

## When backups fail

`takode backup status` shows the error. Typical causes:
- credentials expired on the coordinator (fix the machine's Git login);
- the repository was renamed or access changed (set the new URL);
- the machine copy's fetch failed: read the error in status; a copy that "does not match" or refused history usually means the coordinator's clone was rewritten, which the copy rightly refuses;
- a memory repo was rewound or rewritten on the coordinator. The backup keeps the earlier history and refuses the change. Find out what happened to the memory repo before anything else; never force-push a backup branch to make the error go away.

## Restoring

Follow "Restore" in docs/backups.md. `takode backup restore --repo <url> --to <empty folder>` only builds a folder and touches nothing live. Moving it into `~/.companion` replaces durable user data: the server must be stopped, the current folder moved aside (never deleted), and the user must approve that step.

## Changing what is backed up

- Shared coordinator state is listed once in `web/server/coordinator-state.ts`, for both backups and coordinator moves.
- Secrets stay out (`isSecretState` and `withoutSecrets` in `backup-snapshot.ts`).
- A new store holding secrets must be excluded there too.
- Tests use temporary folders and local bare repositories only (`backup-job.test.ts`).
