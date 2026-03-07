# Codex dropped user messages: archaeology and fix history

This document is the durable handoff for the recurring Codex issue where a user
message appears to vanish, especially when the message includes one or more
image attachments.

Do not treat this as one bug with one root cause. The same user-visible symptom
("my message disappeared" or "Codex ignored the message") has come from several
different failure classes:

- image transport was too large or used the wrong representation
- `turn/start` was attempted while a prior Codex turn was still active
- the Codex process disconnected and the pending user turn was not replayed
- the process had already exited and a queued message never triggered relaunch
- `thread/resume` returned a stale "inProgress" last turn even though the
  resumed thread was idle
- replay/dedup logic failed, so the session looked broken because old assistant
  text reappeared and/or tools stayed stuck
- compaction introduced another replay path that bypassed reconnect-only fixes

The issue is still considered open in the broad sense. Several sub-cases were
fixed, but the family keeps recurring through new edge cases.

## Core files

Most real fixes have touched the same few places:

- `web/server/ws-bridge.ts`
  - image upload/path conversion before adapter dispatch
  - `pendingMessages`
  - `pendingCodexTurnRecovery`
  - `reconcileCodexResumedTurn()`
  - `retryPendingCodexTurn()`
  - `isDuplicateCodexAssistantReplay()`
  - compaction lifecycle handling
- `web/server/codex-adapter.ts`
  - `handleOutgoingUserMessage()`
  - `thread/resume` startup logic
  - `currentTurnId` lifecycle
  - `turn/interrupt` / wait-for-completion behavior
  - `thread/status/changed`
- `web/server/session-types.ts`
  - `local_images`
  - compaction event types
- `web/server/ws-bridge.test.ts`
- `web/server/codex-adapter.test.ts`

Current hot spots on `jiayi`:

- `web/server/codex-adapter.ts`
  - `thread/resume` stale-turn guard
  - local-image-only user input for Codex
- `web/server/ws-bridge.ts`
  - Codex image-path conversion around browser user-message dispatch
  - reconnect/compaction reconciliation and retry ordering
  - replay dedup and recovered-assistant matching

## Timeline

### 1. Mid-turn message/image disconnects

- Quest: `q-61`
- Commit: `791da9e` (`fix(codex): prevent mid-turn disconnect and handle /compact`)
- What it tried:
  - avoid `turn/start` while a turn is already active
  - interrupt the running turn first, then wait for `turn/completed`
  - re-queue the user message when transport closes during `turn/start`
- Why it mattered:
  - this was the first explicit link between dropped user messages and
    image-bearing follow-up turns sent during an active Codex turn
- What changed later:
  - this fixed one class of disconnect, but not the later inline-image and
    stale-resume variants

### 2. Move Codex image transport to local paths

- Commit: `6c7328b` (`fix(codex): prefer local image paths for user image turns`)
- Quest context:
  - `q-61` feedback later recorded that inline image payloads still reproduced
    disconnects even after the active-turn fix
- What it tried:
  - prefer `local_images` in `ws-bridge`
  - emit `localImage` inputs in `codex-adapter`
- Revision:
  - "prefer" was not strict enough; later fixes moved to enforcement

### 3. Recover in-flight image turns after disconnect

- Commit: `015b1f7` (`fix(codex): recover in-flight image turns after disconnect`)
- What it tried:
  - track in-flight Codex user turns more explicitly
  - reconcile resumed turns against the pending user turn after disconnect
- Why it mattered:
  - image messages were not only failing at transport size; they were also being
    stranded by disconnect/reconnect timing

### 4. Active-turn user message gets stuck after reconnect

- Quest: `q-135`
- Related commit lineage:
  - `ac6e042` (`fix(ws-bridge): replay stale codex queued messages after reconnect`)
  - later reconnect/dedup fixes below
- Symptom:
  - user sends a message while Codex is busy
  - server interrupts Codex
  - Codex disconnects and resumes
  - resumed thread goes idle and the queued user message never runs
- Important archaeology note:
  - `q-135` also documented the second symptom that kept returning later:
    assistant reasoning replayed as fresh messages after reconnect

### 5. Plan-mode retry heuristic was too conservative

- Quest: `q-146`
- Commit: `e05cd5c` (`fix(codex): stabilize plan mode resume retries and reconnect loops`)
- What it tried:
  - treat reasoning-only/context-compaction resumed items as retry-safe
  - stop repeated Codex relaunch loops after capped failures
- Why it mattered:
  - this proved that "non-user item seen in resume snapshot" was too coarse a
    signal; some resumed items are safe and should still retry the pending user
    message
- Current relevance:
  - the same idea still matters outside plan mode when classifying a resumed turn

### 6. Idle/exited Codex sessions ignored new messages

- Quest: `q-154`
- Likely related commits:
  - `86a25ff` (`fix(web): flush pending messages when attaching Codex adapter`)
  - surrounding `ws-bridge` queue/relaunch changes
- Symptom:
  - Codex finished a turn, exited cleanly, and a new message just sat in
    `pendingMessages`
- Important note from quest feedback:
  - the attempted fix appeared incomplete for sessions that were already in the
    exited state before the fix or after server restart
- Takeaway:
  - not every "dropped message" is a transport problem; some are plain
    queue-without-relaunch failures

### 7. Multi-image Codex messages still dropped

- Quest: `q-180`
- Commits:
  - `5a34def` (`fix(codex): use path-based image transport for multi-image turns`)
  - `a89146d` (`fix(images): fail fast on upload errors and enforce codex path refs`)
- Symptom:
  - even after the earlier local-image work, a user message with two screenshots
    was still silently dropped
- What changed:
  - moved from "prefer path refs when available" to "Codex must use path refs"
  - fail fast if uploads or path lookup fail instead of silently falling back
- Current code shape:
  - `ws-bridge` now builds ordered `local_images` for Codex
  - `codex-adapter` warns and ignores inline image payloads for Codex
- Important revision:
  - this is one of the clearest examples where a partial fallback looked safer
    but actually preserved the original failure mode

### 8. Reconnect replayed old assistant messages and stalled tools

- Quest: `q-183`
- Commits:
  - `98a4fb7` (`fix(ws-bridge): dedup replayed codex assistant messages`)
  - `00544d2` (`fix(codex): clear stale turn state and fix dedup window on reconnect`)
- Symptom:
  - Codex disconnected mid-turn, replayed prior assistant messages into the UI,
    and the in-flight tool never finished
- What was learned:
  - dedup by replay detection mattered, but the first version was incomplete
  - `thread/resume` could restore `lastTurn.status = inProgress` while
    `threadStatus = idle`, creating a stale `currentTurnId`
  - the timestamp-window dedup had a dead-code bug, so it did not actually catch
    the replay pattern it was meant to catch
- Current lasting fix pieces:
  - `codex-adapter` only restores `currentTurnId` if the resumed thread is not idle
  - `thread/status/changed` clears stale turn state
  - `isDuplicateCodexAssistantReplay()` uses a real recent-window comparison now

### 9. Stale resume snapshots still needed explicit retry

- Commit: `3c91ea5` (`fix(ws-bridge): retry pending codex turn when resume snapshot is stale`)
- Why it mattered:
  - even after earlier reconnect fixes, resumed snapshots still sometimes
    mismatched the pending turn strongly enough that the queued user message had
    to be retried rather than "recovered"

### 10. Compaction created a separate replay path

- Quest: `q-190`
- Commit: `469d583` (`fix(codex): dedup compaction resume replays`)
- Symptom:
  - after compaction, old assistant commentary replayed again, but tool calls did not
- Key lesson:
  - the reconnect dedup logic from `q-183` was not enough; compaction introduced
    another replay path with different identifiers and timing

### 11. Stale-turn retry order still mattered after compaction

- Commit: `6f99742` (`fix(codex): retry user message on stale turn after compaction disconnect`)
- What changed:
  - when a resumed last turn says `inProgress` but the thread is idle, retry the
    pending user message before trying to recover assistant text or synthesize tool results
- Why this was necessary:
  - the previous reconciliation order could absorb partial recovered output from a
    definitively stale turn, clear the pending recovery state, and still never
    replay the user's message
- This is the latest major iteration in the timeline as of `2026-03-07`

### 12. Resume matching must use the dispatched user text

- Commit: `a716078` (`fix(codex): recover annotated image turns on resume`)
- Symptom:
  - image-bearing Codex turns could still appear dropped if the transport died
    before `turn/start` returned a turn ID
  - on resume, the bridge had to match by user text, but the stored pending text
    was the original browser text rather than the text actually sent to Codex
- What changed:
  - `ws-bridge` now stores pending recovery text from the dispatched adapter
    payload, including the attachment-path annotation and any VSCode selection
    prompt that Codex will actually see
  - regression coverage now includes:
    - image-turn retry when resume matching must fall back to annotated text
    - image-turn retry when a resumed turn is stale (`lastTurn.status =
      inProgress`, `threadStatus = idle`)
- Why this was different from prior attempts:
  - earlier fixes focused on transport shape (`local_images` vs inline data),
    stale-turn ordering, replay dedup, or reconnect flushing
  - this case failed later in resume reconciliation because the comparison key
    did not match the real dispatched prompt text
  - it is therefore a recovery-state bug, not a new regression in image upload
    or compaction ordering

## Current status on `jiayi`

The repo now has meaningful defenses for several known sub-cases:

- Codex image user messages should use `local_images` / `localImage`, not inline base64
- `turn/start` should not be sent on top of an active turn without interrupt/wait
- reconnect should not restore a stale `currentTurnId` when the resumed thread is idle
- some replayed assistant messages are deduped
- compaction replay has additional dedup coverage
- stale-turn retry after compaction runs before partial recovery
- resume text matching now uses the actual Codex-bound user text for annotated
  image turns and VSCode-selection turns

Despite that, the broader bug family is still considered unresolved because the
same external symptom keeps surfacing through new edge cases. The next real fix
should start by identifying which class of failure is happening in the new
report rather than assuming an old root cause has regressed.

## What was attempted, revised, or effectively superseded

- `q-61` active-turn interrupt/requeue fix was necessary but not sufficient.
- "Prefer local paths" for images (`6c7328b`) was later tightened into
  "enforce path refs and fail fast" (`a89146d`).
- reconnect replay dedup (`98a4fb7`) was later corrected by `00544d2` because
  the dedup window logic was partly dead code and stale turn restoration was wrong.
- reconnect-only replay handling was later extended for compaction (`469d583`).
- resume recovery logic was later reordered by `6f99742` because recovering
  partial output from a stale idle-thread turn could suppress the needed retry.
- the next recurrence (`a716078`) was not another transport regression; the
  remaining gap was that resume matching still keyed off pre-dispatch browser
  text instead of the annotated prompt actually sent to Codex.
- `q-154` appears only partially closed: the queue/relaunch path has been fixed
  in several places, but historical feedback says some pre-existing exited
  sessions still ignored new messages after restart.

## Common pitfalls

- Do not assume "message dropped" means the browser never sent it.
  - Very often the browser sent it, `ws-bridge` queued it, and the failure was
    later in adapter attach, relaunch, resume reconciliation, or stale turn state.
- Do not allow inline image fallback for Codex.
  - The current code intentionally ignores inline images in `codex-adapter`.
  - If a future change silently reintroduces inline fallback, this bug family will recur.
- Do not classify every resumed non-user item as unsafe.
  - reasoning-only and compaction-only resumed items have already proven to be retry-safe.
- Do not restore `currentTurnId` from `lastTurn.status = inProgress` without
  checking `threadStatus`.
- Do not compare resumed user text against only the raw browser prompt.
  - image path annotations and VSCode selection prompts are appended before the
    Codex turn starts
  - pending recovery state has to track the dispatched text, not just the
    original browser text
- Do not run recovered-message synthesis before checking whether the resumed turn
  is definitely stale.
- Do not trust assistant item IDs during compaction replay.
  - compaction can rewrite historical items to generic `item-N` forms
- Do not diagnose only from the UI.
  - some cases are real message loss
  - some are replay duplication
  - some are orphaned tool/timer recovery bugs that only look like message loss
- Do not break non-Codex image paths while fixing Codex.
  - `q-172` verified that non-SDK Claude still needs inline image delivery
  - Codex path-ref enforcement must stay backend-specific

## Suggested starting points for the next real fix

When the next report arrives, work this checklist in order:

1. Identify the failure class from raw evidence.
   - Check the session recording in `/tmp/companion-recordings/`.
   - Verify whether the browser `user_message` reached `ws-bridge`.
   - Verify whether `adapter.sendBrowserMessage()` was called.
   - Verify whether Codex actually received a `turn/start`.

2. For image reports, inspect the transport shape first.
   - In `ws-bridge`, confirm the outgoing adapter message had `local_images`.
   - In `codex-adapter`, confirm the JSON-RPC input used `type: "localImage"`.
   - If inline `images` are involved at all for Codex, the bug is probably before reconnect logic.

3. Inspect the reconnect state machine.
   - Look at `pendingMessages`.
   - Look at `pendingCodexTurnRecovery`.
   - Look at resumed `threadStatus`, `lastTurn.status`, and `lastTurn.items`.
   - Check whether stale-turn retry happened before recovery/synthesis.

4. Separate true message loss from UI-only aftermath.
   - A message may have been delivered, but replay duplication or orphaned tool
     recovery can make the session look wedged.
   - Check whether the user turn exists in the resumed snapshot.

5. Start with a regression test before patching.
   - `web/server/ws-bridge.test.ts` for queue/retry/replay/compaction behavior
   - `web/server/codex-adapter.test.ts` for transport shape and `currentTurnId` lifecycle

6. Keep the fix narrow.
   - This area regresses easily because image transport, queueing, relaunch,
     resume recovery, replay dedup, and compaction all touch the same state.

## Specific code points to inspect first

- `web/server/ws-bridge.ts`
  - image-path conversion and Codex dispatch
  - `pendingMessages`
  - `pendingCodexTurnRecovery`
  - `reconcileCodexResumedTurn()`
  - `retryPendingCodexTurn()`
  - `isDuplicateCodexAssistantReplay()`
- `web/server/codex-adapter.ts`
  - `handleOutgoingUserMessage()`
  - `thread/resume` current-turn restoration
  - `handleThreadStatusChanged()`
  - interrupt/wait behavior

## Quests worth reading before another fix

- `q-61` - active-turn disconnect and first requeue fix
- `q-135` - stuck-after-interrupt reconnect and first replay duplication report
- `q-146` - retry-safe resumed items in plan mode and reconnect-loop stabilization
- `q-154` - queued messages to exited/idle Codex sessions
- `q-180` - multi-image messages still dropped after earlier local-image work
- `q-183` - reconnect replay duplicates and stale current-turn state
- `q-190` - compaction replay duplicates
- `q-197` - this archaeology/doc pass

## Bottom line

If a future worker starts with "Codex is dropping image messages again" and
immediately patches only image upload code or only replay dedup, they are likely
to miss the actual failure class.

Start from recordings, classify the failure, and only then decide whether the
bug is in:

- image transport
- pending message queueing
- relaunch/attach flush
- resume reconciliation
- stale turn state
- replay dedup
- compaction aftermath
