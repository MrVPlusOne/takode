# Session history persistence

SessionStore keeps small sessions in hot JSON plus the existing completed-history
JSONL file. An estimated history/tool-result size of 1 MiB selects the incremental
format without first serializing the history to measure it. A session stays in
the incremental format after its first conversion, including after completion.

The hot JSON carries a `_historyRef` identifying a version, generation, exact
committed byte extent, revision, message/tool-result counts and logical freeze
boundaries. The corresponding `<session>.history-<generation>.data` file stores
bounded frames, one JSON array per line of at most 128 KiB. User objects,
property names and strings remain literal payloads; framing does not reserve
magic strings inside user data.

Version 2, which every save writes, stores each row as its own JSON text: one
`["value", row]` line when it fits in a frame, otherwise `["text", piece]` lines
of at most 16,384 UTF-16 code units whose pieces join back into the text
(JSON escapes a lone surrogate a cut leaves, so pieces may cut anywhere). A row's
digest is the SHA-256 of its JSON text, which a reader checks against the bytes
it already holds. Version 1 spelled every value out as a typed token, with
strings stored once and referenced by id; it is still read, and a session's file
turns into version 2 at the first save after a server start, which writes a
fresh generation anyway. On real histories version 2 reads about four times
faster at about the same size (one token per JSON value, each hashed, made
version 1 slow to read).

Promotion writes a self-contained generation. An existing legacy frozen file is
left intact but is no longer authoritative. Changes to earlier records, reverts,
and metadata repairs therefore do not depend on modifying a legacy base.

The store still admits two session operations at once and serializes each
session's reads and writes. Ordinary pending saves coalesce before snapshot
capture. At admission, the writer captures nested container structure while
retaining immutable string values. Immediate ownership saves remain ordered
barriers. Later nested edits cannot change an admitted revision.

Within a generation, saves append only changed rows plus a commit record.
Content hashes detect nested record changes. Writer caches retain only row
positions and digests, never row contents. Reads do not populate those caches.
The first write after restoring a session creates a fresh self-contained
generation. Successful archiving releases the writer cache.

An ordinary save does not read, copy or hash rows inside the committed frozen
prefix: like the legacy frozen log, those rows change only through
`saveHistoryEdits` (or a revert or failure retry), which captures and verifies
every row. Hashing a large leader's whole history on every save blocked the
server's event loop for over a second. Saves that do read every row, such as the
first save after a restart or a reclamation rewrite, yield to the event loop
about every 20 ms.

Data and its commit record are synced before atomic hot-head replacement. Failed
publication preserves the prior head and restores its committed byte extent.
The failed snapshot remains owned, flush reports the failure, and the existing
shutdown policy continues to retain the inactive process when saving fails or
stalls. Physical suffix bytes past the committed extent are not authoritative.

A read decodes the committed extent in one sequential pass, materializing rows
(and, in version 1, strings) as their records end. Startup reads every active session this way, so
reads must not open a separate stream per string or row: that once made restart
take about a minute with several hundred MiB of history.

When obsolete saved bytes outweigh live referenced bytes, the writer commits a
replacement generation. Old generations are retired only after successful head
publication and after earlier reads have finished. This removes unreachable
saved revisions, not conversation messages. Legacy frozen originals and offline
conversion backups are outside reclamation. A rewrite temporarily needs disk
space for both generations. Interrupted unpublished generations may remain on
disk; they do not become authoritative merely by existing.

An encountered invalid or incomplete committed incremental history fails its
load. During active-session startup restoration, that failure stops startup
instead of silently skipping the session. Archived search-only startup still
defers history loading; corruption in an unread archived payload can be discovered
later when its full history is requested.

This format is **not readable by older builds**, and version 2 files are not
readable by builds from before version 2. Downgrade requires preserved
pre-change backups and must not discard later work written by the new code. The
exceptional external-tail transition is documented separately in
[the one-use migration instructions](experimental-session-tail-migration.md).
Production code does not recognize or convert that external format.

This reduces repeated encoded copies and obsolete cached values. It does not cap
live conversation size, implement lazy history or eviction, or bound unrelated
large hot metadata. All active history still materializes at startup, so restart
time and memory still grow with the total active history. No particular
RAM reduction, cross-process writer fencing or stronger physical-power-loss /
directory-metadata durability guarantee is implied.

## Save cost rule

An ordinary save must cost in proportion to what changed, not to the size of the
history. Twice a save that touched the whole history froze the server as
histories grew: in February 2026 every save re-serialized it, and in October 2026
the large-session format re-hashed it. The October change was correct and
tested; only its cost on a real large session was never measured. Therefore:

- `session-store-save-cost.test.ts` and `session-history-journal.test.ts` check
  that an ordinary save never reads saved rows (in both formats), and the former
  that adding one row to a 10,000-row history
  hashes and writes only a handful of rows. Keep these passing; they count work
  instead of timing it.
- A turn can stay unfinished for days: Codex steers new input into the running
  turn, so a busy session may not see a `result` for tens of thousands of rows.
  In the large-session format an ordinary save therefore also reuses unfinished-turn
  rows that are still the very objects the previous save was given. A replaced row
  is a new object and is read. An in-place edit is reported through
  `saveHistoryEdits` (the same rule as for finished turns) or, if nobody reports
  it, caught by a 512-row recheck window that moves on every save; the whole
  unfinished turn is read once more when it finishes and in `flushAll` at
  shutdown. Turns of up to 512 rows are read whole on every save, as before. The
  save-cost tests cover a 10,000-row unfinished turn and these edit paths.
- A save right after a tool result checks the history's trailing previews for
  replayed duplicates. The replay key of each preview row is remembered by row
  object, so the check does not hash every earlier preview again.
- A save step that holds the event loop for more than 200 ms (the level of the
  server's own "Event loop blocked" warnings) logs
  `Slow save blocked the event loop for <ms>ms: session=<id>, messages=<n>, toolResults=<n>`.
  Seeing it in the server log means a save path regressed.
- Any change to the save path or the saved format is timed on a copy of a real
  large session (one of the biggest leaders) before it lands, comparing the
  longest event-loop stall per save with the previous code.
