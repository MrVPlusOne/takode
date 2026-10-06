# Session history persistence

SessionStore keeps small sessions in hot JSON plus the existing completed-history
JSONL file. An estimated history/tool-result size of 1 MiB selects the incremental
format without first serializing the history to measure it. A session stays in
the incremental format after its first conversion, including after completion.

The hot JSON carries a `_historyRef` identifying a version, generation, exact
committed byte extent, revision, message/tool-result counts and logical freeze
boundaries. The corresponding `<session>.history-<generation>.data` file stores
bounded typed frames. User objects, property names and strings remain literal
payloads; framing does not reserve magic strings inside user data. Strings are
encoded in pieces of at most 16,384 UTF-16 code units, preserving NUL, Unicode,
surrogate-pair boundaries and lone surrogates.

Promotion writes a self-contained generation. An existing legacy frozen file is
left intact but is no longer authoritative. Changes to earlier records, reverts,
and metadata repairs therefore do not depend on modifying a legacy base.

The store still admits two session operations at once and serializes each
session's reads and writes. Ordinary pending saves coalesce before snapshot
capture. At admission, the writer captures nested container structure while
retaining immutable string values. Immediate ownership saves remain ordered
barriers. Later nested edits cannot change an admitted revision.

Within a generation, saves append only changed rows and new string values plus a
commit record. Content hashes detect nested record changes. Writer caches retain
only values referenced by the last committed state and the current candidate.
Reads do not populate those caches. The first write after restoring a session
can create a fresh self-contained generation; it does not keep decoded obsolete
strings from an earlier journal. Successful archiving releases the writer cache.

Data and its commit record are synced before atomic hot-head replacement. Failed
publication preserves the prior head and restores its committed byte extent.
The failed snapshot remains owned, flush reports the failure, and the existing
shutdown policy continues to retain the inactive process when saving fails or
stalls. Physical suffix bytes past the committed extent are not authoritative.

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

This format is **not readable by older builds**. Downgrade requires preserved
pre-change backups and must not discard later work written by the new code. The
exceptional external-tail transition is documented separately in
[the one-use migration instructions](experimental-session-tail-migration.md).
Production code does not recognize or convert that external format.

This reduces repeated encoded copies and obsolete cached values. It does not cap
live conversation size, implement lazy history or eviction, or bound unrelated
large hot metadata. All active history still materializes at startup. Traversing
record structure and hashing current strings still takes CPU time. No particular
RAM reduction, cross-process writer fencing or stronger physical-power-loss /
directory-metadata durability guarantee is implied.
