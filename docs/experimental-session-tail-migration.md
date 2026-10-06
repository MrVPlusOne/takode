# One-use offline experimental tail conversion

This tool is specifically for sessions written by the experimental tail journal
in `MrVPlusOne/takode` commit
`acf493c51709c12b44db7a71581aa5a8e89ae2fb`. It is exceptional repository tooling,
not a supported production recovery path. Its parser helpers live beside it in
`web/scripts/`; production does not import them.

**Do not start the new server on that installation before conversion succeeds.**
The new production reader intentionally does not detect that this step was
skipped. An orphan `.tail.jsonl` filename alone does not trigger conversion; the
hot file's committed `_tailJournal` reference identifies the source bundle.

## Before running

1. Obtain the published code containing this tool in a separate clean checkout.
   Record `git rev-parse HEAD` and confirm it contains the delivery commit with
   `git merge-base --is-ancestor <published-commit> HEAD`. Use the repository's
   pinned Bun and frozen dependency policy. Build/verify the replacement code
   without starting it or replacing the currently running checkout.
2. Identify the exact session directory used by the existing server, including
   its port suffix if present. Choose a new, separate backup directory whose
   parent exists. Neither directory may contain the other. Ensure sufficient
   free space for complete physical originals, staged output and installed output.
3. Stop accepting work and use the existing safe shutdown procedure. Verify that
   saving finished successfully **and the actual server process exited**. A
   shutdown request, inactive UI or stopped acknowledgement alone is insufficient.
   If saving fails or stalls, preserve the process/state and resolve that problem
   first. Do not force-stop, kill, clear pending state or blindly restart.
4. Keep both old and new servers down and run only one converter. The acknowledgement
   flag below records your confirmation; it does not inspect or terminate processes.
   The script also checks file identities/stability. It is not a cross-process lock.

## Convert while stopped

From the replacement checkout's `web` directory:

```sh
bun --no-install scripts/migrate-experimental-session-tail.ts --help
bun --no-install scripts/migrate-experimental-session-tail.ts --self-test
bun --no-install scripts/migrate-experimental-session-tail.ts \
  --sessions-dir /absolute/path/to/offline/sessions \
  --backup-dir /absolute/path/to/new-separate-backup \
  --server-stopped
```

Run the quick `--self-test` first; it exercises a disposable synthetic bundle, resume and rollback and never opens your session directory. Replace both example paths deliberately. There is no home-directory or live-store
default. The tool inventories every hot file and converts referenced supported
tails. It validates committed extents, terminal records, strings, rows, counts,
frozen prefixes and overlaps. Unsupported or incomplete bundles cause failure.

Complete hot/frozen/journal originals, including uncommitted physical journal
suffixes, are copied and hashed under `<backup>/<session>/originals`. Source
paths and user payloads are not rewritten or sanitized. The converter indexes
byte ranges and streams selected current rows and string pieces instead of
parsing a whole giant file or JSONL line into memory. Obsolete strings stay in
the original backup, not in the converted live history.

All selected sessions are staged and verified before the first authoritative
head is replaced. Metadata and pending ownership are checked by source ranges;
history/tool-result content is checked with bounded traversal and digests. The
summary prints only status, converted-session count and the exact receipt path.
The receipt records source/output hashes and recovery locations, not conversation
payloads. **Require `status: "complete"` before starting the new code.** A count of
zero means no referenced supported tails were found; verify the directory choice
before interpreting that as the expected transition.

Publication is atomic per session, not across all sessions. On any failure, keep
both servers down and preserve the complete directories. Run the same command
with the same paths to resume from the saved receipt. A crash between publishing
a head and recording completion is recognized by output identity. Changed,
missing or conflicting files fail closed. Do not delete backups, journals,
receipts or pending work to make an error disappear.

## Rollback before additional work

Only before the new code has written additional state, the same tool can restore
the original hot heads after verifying the complete original bundles and current
output identities:

```sh
bun --no-install scripts/migrate-experimental-session-tail.ts \
  --sessions-dir /absolute/path/to/offline/sessions \
  --backup-dir /absolute/path/to/the-same-backup \
  --server-stopped --rollback
```

Require a complete `rolled-back` receipt before starting the old code. Converted
data generations and originals are retained. A partial rollback also requires
keeping servers down until successful resume. The tool refuses to roll back
changed new-code state; restoring old backups then would discard subsequent work
and needs a separate recovery decision.

After successful conversion, start the replacement through your normal procedure
and verify its displayed build identity matches the recorded checkout. Confirm
the affected conversations, recent messages, complete tool results and pending
work. Return the commit/build identity, receipt status/session count, any exact
error and the specific content or pending-state mismatch. Do not send full
conversation payloads as diagnostics unless separately needed and approved.

The focused persistence change reduces avoidable serialization/copy backlog and
obsolete saved versions. It does not eliminate giant live state or full startup
loading, prove the original incident's root cause, or promise a particular RAM
figure. This document prepares an operator-controlled transition; publishing it
does not perform or authorize a live conversion, restart or process intervention.
