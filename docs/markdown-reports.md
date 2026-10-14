# Markdown reports in chat

An agent can publish an existing Markdown file into its own session without
copying the report into a model response:

```sh
takode report /absolute/path/daily-report.md --thread main
takode report /absolute/path/daily-report.md --thread main --worker 12
```

The thread may also be an exact quest thread. `--worker` names a worker
belonging to the publishing session (or the publishing worker itself) whose
session context resolves the report's Takode `file:` links.
The command reads the exact local file using the agent's existing filesystem
permissions. It uploads text to an authenticated API, which never opens the
supplied server path. A worker's report must already be accessible to the agent
that publishes it; this command grants no additional access.

Each published item stores the complete UTF-8 text, source path, timestamp and
SHA-256 digest. Later edits or removal of the original file do not change that
snapshot. Missing, empty, invalid UTF-8, binary and larger-than-2-MiB sources fail
without publishing partial content. HTML and scripts remain non-executable
under the shared Markdown renderer. The receipt is compact; `--json` returns
identity, destination, digest and byte count without the report body.

Select a passage and choose **Comment** as usual. Report comments work like any
other comment: they are sent with the composer to the session showing the
report, can be mixed with other comments, images and replies, and stay in the
synced composer draft until sent. Because the agent may not have written or
read the report, report comments name its source path (once for a run of
comments on the same report), so it can open the file for context; the report
ID, session and digest stay in the comment's metadata. Comments also keep
the complete quotation, exact reply and passage anchor, and sent comments
include an **Open source report** action.

Normal links retain their existing behavior. Relative Markdown file links
resolve beside the report; Takode `file:` links use the `--worker` session's
context when present. Linked resources are not copied into the snapshot.
