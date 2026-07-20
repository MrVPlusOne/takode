# Questmaster local backups

Takode keeps local-only Questmaster backups under:

    ~/.companion/questmaster-backups/

The backup root is intentionally scoped to Questmaster quest and Quest Journey data. It does not back up sessions, settings, environment profiles, secrets, recordings, logs, memory, worktrees, or other Companion/Takode state.

## Discovery

Start with:

    ~/.companion/questmaster-backups/manifest.json

The manifest lists:

- retained full text snapshots in text.snapshots;
- compact mutation journals in text.journals;
- deduplicated quest image blobs in images.blobs;
- the generated README.md path with restore safety notes.

Text snapshots are the primary recovery source. Journals preserve recent per-quest textual mutations between snapshots. Image blobs are secondary, content-addressed by SHA-256, and optimized for space over exhaustive image history.

## Restore safety

Do not overwrite live Questmaster data directly from a backup. First copy the candidate backup to a temporary location and inspect it.

For Questmaster text recovery:

1. Find the newest relevant entry in manifest.json under text.snapshots.
2. Read the snapshot JSON and confirm quest count, timestamps, and the expected latest quest records.
3. Take a fresh manual copy of the current live store before applying any restore.
4. Only then replace the live Questmaster store as part of an explicit restore procedure.

Quest image blobs may require manual relinking from quest image metadata. Text recovery should be prioritized over image recovery.
