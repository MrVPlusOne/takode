---
name: guided-review
description: Use only when the user asks for a code review they will read themselves (a guided review of a commit range, branch or pull request in Takode). Do not use it for reviews agents do for each other or any other review the user won't read. Explains how to write the map for `takode review` and which changes need the user's decision, a careful look, evidence or only a summary.
---

# Guided review

A guided review lets the user review a large change in minutes without giving up the parts only they can judge. You review every line yourself, then publish a **map** with `takode review`. Takode shows the user a walkthrough, one stop at a time: your overview, then each stop with your explanation and an answer field beside the exact code drawn from git, then what you checked and what you summarized. The full change opens from git with one tap. The user's answers come back to your session as one message.

It is a user-facing feature only: use it when the user asks for a review they will read, not for agent-to-agent reviews such as a reviewer checking a worker's change.

## Workflow

1. Settle the range: `base` and `head` revisions in one repository, usually the commits of the change under review. Line numbers in the map are **new-file line numbers at `head`**. `takode review --outline <base>..<head> [--repo <dir>]` lists each changed file's changed line ranges; read files at `head` (`git show <head>:<path>`) for the code around them.
2. Review the whole change properly before writing anything. Run the tests when you can. The map is a summary of a real review, never a substitute for one.
3. Write the map as a JSON file outside the repository, such as a `reviews/` folder in your home directory (format below, and in `takode review --help`). Its path is shown as the review's source.
4. Check it: `takode review <map.json> --check [--repo <dir>]`. It prints every changed line the map leaves out or claims twice; fix the map until it reports "Map OK".
5. Publish: `takode review <map.json> --thread <main|q-N> [--repo <dir>]`. Leaders publish into the quest's thread. A worker publishes into its own session (`--thread main`) and tells its leader, who shares it where the user reads it (below).
6. When the answers arrive, act on them like any user message: questions and requested changes typed into an answer are requests.

## Sharing a review into another thread

The user reads their leader's threads, not workers' sessions, so a review a worker publishes reaches them only when the leader shares it: `takode review --share <worker session> --thread q-N` (the worker's newest review; `--review <review-id>` picks another). Sharing needs no copy of the repository on the leader's machine: the shared copy keeps the review's saved code, and Full diff still reads git on the machine where it was first published. The user's answers in the shared copy come to the leader, who passes them to the worker. A leader may share from its own session or any session it herds.

## The overview

The overview is the first thing anyone reads, including people the user shows the review to. Open with what the change does for its users in a sentence or two, then how it works, then what the review found. Use plain words rather than the project's internal names. Takode already shows how many decisions, careful looks, checks and summaries there are, so don't count them again.

## Choosing tiers

Each stop has a tier. Keep the review short: about 3-12 stops for a change of a few thousand lines.

- **decide**: only the user can choose. Cost (paid APIs, more requests, bigger bills), privacy or data leaving the machine (what is sent where, on whose key), security and authority, data kept or deleted, licences and new dependencies, behavior that changes beyond the feature (shared components, app-wide defaults), anything that departs from what the user asked, and anything hard to undo. Write a real question with 2-4 short answers (at most 40 characters each, such as "Keep 4", "Cap at 2", "Ask me").
- **check**: worth the user's careful look, but no decision needed: non-obvious mechanisms, assumptions later changes could break, behavior no test can cover, risky code that is right but subtle.
- **checked**: looked risky, and you verified it is fine. The note is the evidence ("every lookup checks the ID before joining the path; a test sends unsafe IDs").
- **summaries**: everything routine: tests, wiring, renames, plumbing, UI details the user already approved, decisions the user already made (say when: "you approved this licence on Oct 19"). Group files by what they do, one sentence or two per group.

Rules that keep summaries honest:

- Never bury in a summary something the decide or check rules name. When in doubt, make it a stop.
- New dependencies, changes to login, routes or permissions, deleted or skipped tests, data migrations, settings and secrets, and edits to components many screens use always get a stop, at least `check`.
- Notes say why something matters in plain words, not what the code says line by line. The user sees the code right below.

## Map format

```json
{
  "base": "<rev>",
  "head": "<rev>",
  "title": "Read aloud for assistant messages and reports",
  "overview": "Markdown: what the change does, how, and what the review found.",
  "stops": [
    {
      "tier": "decide",
      "title": "Up to 4 paid speech requests per piece",
      "note": "Slow pieces are requested again; aborted responses may still be billed.",
      "question": "Keep up to 4 requests per piece?",
      "answers": ["Keep 4", "Cap at 2", "Ask me"],
      "code": [{ "path": "web/server/read-aloud-speech.ts", "lines": [79, 118] }]
    },
    { "tier": "check", "title": "...", "note": "...", "code": [{ "path": "...", "lines": [10, 30] }] },
    { "tier": "checked", "title": "...", "note": "The evidence.", "code": [{ "path": "..." }] }
  ],
  "summaries": [
    { "title": "Tests", "text": "53 new tests covering ...", "paths": ["web/server/read-aloud.test.ts"] }
  ]
}
```

Coverage rule: every added or removed line is in exactly one stop, or in a file listed by exactly one summary. A code entry without `lines` covers the whole file. Two stops may not claim the same line, and a stop range must contain changed lines. A file listed in a summary may also have stops; the summary covers the rest of it. A removed line belongs to the range that contains the new-file line it sat before, or, when none does, to a range ending just above it.

The review keeps only the code your stops show (at most 1 MiB in total), so point stops at the lines that matter and summarize the rest; the user reads summarized code in the full diff, which Takode reads from git.
