# Markdown reports in chat

An agent can publish an existing Markdown file into its own session without
copying the report into a model response:

```sh
takode report /absolute/path/daily-report.md --thread main
takode report /absolute/path/daily-report.md --thread main --worker 12
```

The thread may also be an exact quest thread. `--worker` records a responsible
worker belonging to the publishing session (or the publishing worker itself).
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

Select a passage and choose **Comment** as usual. After saving comments, choose
**This session** or the recorded worker in the composer, then send. The server
revalidates the worker relationship. An ineligible recipient leaves the draft
intact with an error; it never selects a replacement. Comments preserve the
complete quotation, exact reply, source session, snapshot identity and passage
anchor. Sent comments include an **Open source report** action.

Send report comments separately from images, reply attachments or comments on
ordinary chat messages. Normal links retain their existing behavior. Relative
Markdown file links resolve beside the report; Takode `file:` links use the
recorded worker's session context when present. Linked resources are not copied
into the snapshot.
