# Leader Dispatch Edge Cases

Read this reference only when the dispatch or phase handoff involves one of these cases:

- human feedback rework or stale in-flight completions
- screenshots, generated images, image-heavy browser evidence, or 413/payload recovery
- worker/reviewer file links that the user should inspect before Port
- memory-specific dispatch deltas or final completion-summary details
- a phase handoff where the hot-path checklist is not enough

## Human Feedback Rework

Fresh human feedback overrides stale in-flight work. If new human feedback lands while a quest is on the board or while an older review/port turn is still completing:

1. Record the feedback on the quest.
2. Reset the board row to the earliest valid phase for the fresh cycle:
   - `PLANNING` if the same worker is still the intended owner and should produce a fresh Alignment read-in.
   - `QUEUED` if you need to choose a worker again or prior ownership is no longer valid.
3. If old-scope work is still generating, interrupt it before sending the correction.
4. Do not let stale review acceptance, stale Port confirmation, or old-scope completion advance the board after reset.

When same-thread user feedback appears unrelated, cross-cutting, or cleaner as its own work item, propose a separate quest/Journey instead of mutating the current quest. If unclear, ask a short clarifying question and pause only the affected quest.

For feedback rework Alignment, add this to the normal dispatch:

```text
The quest has unaddressed human feedback -- read it carefully and factor it into your alignment read-in.
```

Feedback addressing happens during implementation or the appropriate substantive phase, not during Alignment.

## Screenshots And Images

Forward user screenshots into durable quest context:

- If a quest exists, attach user-provided screenshots with `quest feedback ... --image <path>` before dispatching.
- If no quest exists yet, preserve the image path in the quest once created or send it to the worker in a follow-up message. `takode spawn` does not support images.
- User-uploaded chat and Questmaster images already pass through Takode's image pipeline. Do not ask workers to recompress them unless an older unmarked path has concrete size or dimension evidence.

For local/generated screenshots:

- Prefer `.takode-agent.` optimized paths returned by `agent-browser screenshot`.
- Use the original screenshot only when the worker needs precision/pixel debugging.
- For other generated images, use `quest optimize-image <path>` and forward the optimized sibling.

## Worker/Reviewer File Links For Users

Before showing unported worker or reviewer file links to the user, resolve them against the originating session:

```bash
takode file-resolve --session <worker-or-reviewer> <path-or-file-link>
```

Use the returned absolute `file:` link when the user should inspect unported worktree state. Repo-relative links are correct after Port/main sync or when intentionally pointing at the leader/main checkout.

## 413 Or Payload Recovery

Do not blindly retry a worker or reviewer turn that failed with `413 Payload Too Large` or equivalent request-size wording, especially after image-heavy browser evidence.

Prefer, in order:

1. Manual compaction or removing redundant local image references where possible.
2. A bounded restart/replacement with pointers to durable quest notes, optimized evidence paths, and the exact remaining question.
3. Avoid replaying a full image-heavy transcript into the replacement.

If evidence was not durably recorded before the failure, recover the smallest useful artifacts and document what is missing.

## Memory-Specific Dispatch Deltas

Normal phase notes are not file-based memory. Final Memory owns durable-state closure for non-cancelled quests.

Include memory deltas in a handoff only when the actor cannot infer them:

- files or memory decisions already inspected
- accepted evidence that changes durable facts
- known freshness or audit concerns
- external artifact locations or retention choices
- explicit memory-writing assignment

Do not require routine `memory update not needed` statements from non-Memory phases. If memory writing is explicitly assigned before final Memory, say so directly and point to the relevant memory responsibility area.

## Completion Summaries

When reporting a completed quest to the user, lead with the delivered result or accepted decision, why it matters, and any real residual risk or user action.

Do not lead with routine internals such as command lists, raw commit hashes, empty User review checks, final debrief metadata status, no-op memory statements, or ordinary verification. Keep those in phase docs, Port notes, structured commit metadata, final debriefs, or memory notes unless the exact detail is directly useful.

If quiz metadata exists when the leader reports final completion, write the useful completion summary first, then render the quiz directive in the proper leader response location.
