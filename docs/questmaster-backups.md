# Questmaster local backups

Takode keeps local-only Questmaster backups under:

    ~/.companion/questmaster-backups/

The backup root is intentionally scoped to Questmaster quest and Quest Journey data. It does not back up sessions, settings, environment profiles, secrets, recordings, logs, memory, worktrees, or other Companion/Takode state.

## Where quests live

The quest store keeps one file per quest:

    ~/.companion/questmaster-live/quests/q-N.json
    ~/.companion/questmaster-live/quests/_meta.json

Each `q-N.json` is the quest as pretty-printed JSON. `_meta.json` holds the next quest number (deleted quests keep theirs) and, for stores that began before July 2026, where the older per-version quest files were kept. Only the Takode server writes these files; it replaces a quest's file through a temporary file and a rename, so a quest change costs that quest's size. Images stay in `questmaster-live/images/`.

Until November 2026 the whole store was one file, `questmaster-live/store.json`. The first start of a newer server moves it:

1. it copies `store.json` byte for byte to `questmaster-backups/migrations/store-before-per-quest-files-<time>.json` and checks the copy;
2. it writes every quest, exactly as stored, into a staging folder `questmaster-live/quests.migrating-<time>/`, reads them back and requires each to be identical;
3. it renames the staging folder to `quests/` and renames `store.json` to `store.json.before-per-quest-files` (kept, not deleted).

If any step before the switch fails, `store.json` stays as it was and readable, quest changes are refused with the reason, and the next start tries again.

To go back to a build from before November 2026, stop the server and run `bun web/scripts/quest-store-roll-back.ts`: it writes `store.json` from the quest files and moves `quests/` aside. Starting a current build later moves `store.json` into one file per quest again.

## Discovery

Start with:

    ~/.companion/questmaster-backups/manifest.json

The manifest lists:

- retained snapshots of the whole store in text.snapshots;
- compact mutation journals in text.journals;
- deduplicated quest image blobs in images.blobs;
- the generated README.md path with restore safety notes.

Text snapshots are the primary recovery source. A snapshot is taken on the first quest change and then every 25 changes. Since November 2026 a snapshot (`format: "quest_index"` in the manifest) is a small index naming the version of every quest, and each quest version is kept once in `text/quest-blobs/<sha256>.json`, the exact bytes of its quest file. A snapshot therefore writes only the quests that changed since earlier ones, and retained snapshots share the rest; when a snapshot rotates out, blobs no retained snapshot names are deleted. Older snapshots hold the whole store in one file and stay readable until they rotate out. Journals preserve recent per-quest textual mutations between snapshots. Image blobs are secondary, content-addressed by SHA-256, and optimized for space over exhaustive image history.

Each journal line is one store write (`kind: "quest_text_mutation"`). Version 2 lines (from November 2026) record only what changed in each quest: `set` holds fields with their new values, `appended` holds items added to the end of array fields (such as a new note in `feedback`), and `removed` names deleted fields; a created quest appears whole as `quest`, a deleted one as `quest: null`. To rebuild a quest, take it from the newest snapshot older than the lines you need and apply the following lines for that quest in order. Version 1 lines (earlier days) hold whole `before` and `after` copies of each changed quest instead.

## Restore safety

Do not overwrite live Questmaster data directly from a backup. First copy the candidate backup to a temporary location and inspect it.

For Questmaster text recovery:

1. Find the newest relevant entry in manifest.json under text.snapshots.
2. Write it to a temporary quest folder, which checks every quest blob against its hash and works for both snapshot kinds:

       bun -e 'await (await import("./web/server/quest-backup-store.ts")).restoreQuestSnapshotToFolder("<snapshot path>", "/tmp/quests-restored")'

3. Confirm quest count, timestamps, and the expected latest quest records in that folder.
4. Stop the Takode server, move the current `~/.companion/questmaster-live/quests` aside (keep it), and move the restored folder into its place.

Quest image blobs may require manual relinking from quest image metadata. Text recovery should be prioritized over image recovery.
