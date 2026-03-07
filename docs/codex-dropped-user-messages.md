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
  - `pendingCodexTurns`
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

### 13. `turn/start` can succeed but recovery still loses the turn identity

- Investigation date: `2026-03-07`
- Concrete case:
  - session `140`
  - session id `4db7762d-0df0-499c-863f-fc345ac1d743`
  - recording:
    `/tmp/companion-recordings/4db7762d-0df0-499c-863f-fc345ac1d743_codex_2026-03-07T05-48-05.146Z_a7912e.jsonl`
- Symptom:
  - user sent a post-restart message
  - server dispatched `turn/start`
  - Codex returned a new turn id
  - transport closed about `6ms` later
  - relaunch resumed the thread as `idle`, but the last turn still claimed
    `inProgress`
  - the user message was never replayed, so the session looked idle and stuck
- Important detail from the resume snapshot:
  - `thread.status = idle`
  - `lastTurn.status = inProgress`
  - `lastTurn.items = []`
- Why prior fixes did not catch it:
  - `pendingCodexTurnRecovery` was present, but the bridge had no reliable turn
    match key:
    - the disconnect landed in the window after Codex accepted `turn/start`
      but before the adapter had recorded `currentTurnId`
    - the resumed stale turn had no user item text to compare against
  - existing reconciliation logic only retried unmatched turns when:
    - the pending turn id mismatched, or
    - resumed user text matched, or
    - a later stale-turn branch ran after the match gate
  - with `pending.turnId = null` and `lastTurn.items = []`, the bridge returned
    early and skipped the retry entirely
- Related persistence gap found during the same investigation:
  - `pendingCodexTurnRecovery` was not being written by `persistSession()`
  - `restoreFromDisk()` also reset it to `null`
  - that means restart-time replay can lose the only recovery state needed to
    retry the user message
- Practical lesson:
  - a resumed stale turn with `thread idle + lastTurn inProgress + no items`
    should be treated as retry-safe even when the original `turn/start` id was
    never recorded locally
  - recovery state for Codex replay must survive persistence, not just stay in
    memory

### 14. Session 140 exposed a broader broken-session lifecycle bug

- Investigation date: `2026-03-07`
- Concrete case:
  - session `140`
  - session id `4db7762d-0df0-499c-863f-fc345ac1d743`
  - recording:
    `/tmp/companion-recordings/4db7762d-0df0-499c-863f-fc345ac1d743_codex_2026-03-07T10-36-31.245Z_989d8b.jsonl`
- What was different:
  - this was not another plain "pending turn was not retried" bug
  - the inline-image turn definitely reached Codex and Codex acknowledged
    `turn/start`
  - the transport then died immediately
  - auto-relaunch failed during initialization (`Transport closed`)
  - later user messages were still allowed into a fake local generation path
    and expired via `user_message_timeout`
- Additional divergence found in the same incident:
  - launcher state said the Codex session had exited
  - the old Codex app-server pid was still alive
  - bridge state, launcher state, and actual process state had drifted apart
- Root design smell:
  - delivery semantics for outbound user turns were still spread across too many
    partially authoritative layers:
    browser websocket, bridge state, adapter state, subprocess state,
    relaunch/resume logic, image annotation, and herd-injected user messages
  - the bridge still inferred too much after disconnect instead of treating
    outbound turn lifecycle as first-class state
- Design simplification introduced after session 140:
  - backend health is now explicit in session state:
    `initializing | resuming | connected | disconnected | broken`
  - Codex is no longer treated as connected merely because an adapter object is
    attached; `backend_connected` is sent only after `session_meta`
  - queued Codex messages are no longer flushed on adapter attach; they flush
    only after confirmed `session_meta`, so resume reconciliation runs first
  - Codex user turns now have one authoritative persisted queue:
    `pendingCodexTurns`
    - the head entry is the only turn the bridge may dispatch or reconcile
    - later user turns stay in the same queue instead of being split across
      recovery state and raw `pendingMessages`
    - queue entries carry richer outbound-turn state:
      `historyIndex`, `status`, `dispatchCount`, timestamps, `turnTarget`,
      `turnId`, and `lastError`
  - the bridge marks a fresh Codex turn as running only after explicit
    `turn/start` acknowledgement (`onTurnStarted`), not merely because
    `sendBrowserMessage()` accepted the payload
  - Codex init failure is now first-class:
    - adapter detaches
    - session backend state becomes `broken`
    - the head outbound turn is marked `blocked_broken_session`
    - later user messages are queued/blocked instead of entering fake-running
      timeout churn
  - launcher relaunch/init failure now tries to terminate the known pid even if
    it only exists in persisted launcher state, reducing silent orphan drift
- Why this differs from earlier fixes:
  - earlier fixes mostly patched one replay/retry heuristic at a time
  - this change narrows the state machine by separating:
    - backend health
    - outbound turn delivery/ack state
    - generation lifecycle
  - the main goal is to stop dead/broken sessions from masquerading as normal
    running turns

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

Newer protections added after session 140:

- Codex backend state is explicit and browser-visible
- Codex init failure leaves the session `broken`, not fake-idle
- later user messages to a broken Codex session stay queued/blocked and remain
  visibly pending instead of timing out locally
- Codex user turns now have one authoritative queue (`pendingCodexTurns`)
- raw `pendingMessages` is no longer a second authority for Codex user turns
- queue flush to a newly attached Codex adapter waits for `session_meta`
- persisted stale pids are terminated during relaunch/init failure handling
- migration from legacy raw queued Codex user messages into `pendingCodexTurns`
  is persisted immediately
- replayed assistant/tool artifacts from a resumed `inProgress` turn no longer
  complete the queue head or unblock the next queued user message early

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
- the `2026-03-07` session-140 investigation found another gap:
  reconciliation could still miss a retry if disconnect happened after Codex
  accepted `turn/start` but before the adapter stored the turn id locally, and
  persistence did not preserve Codex outbound-turn state reliably enough
- the follow-up fix for session 140 also found a separate lifecycle bug:
  a broken Codex session could still look connected enough for later user
  messages to start local running state and expire via timeout
- the queue-first redesign then needed two follow-up correctness fixes:
  - migration of raw queued Codex `user_message` payloads into
    `pendingCodexTurns` had to persist immediately, even when dispatch was
    blocked by an already-active head turn
  - resume reconciliation had to stop treating replayed assistant/tool
    artifacts from a resumed `inProgress` turn as proof that the head turn was
    complete
- `q-154` appears only partially closed: the queue/relaunch path has been fixed
  in several places, but historical feedback says some pre-existing exited
  sessions still ignored new messages after restart.

### 15. Queue-first redesign replaced recovery heuristics with one authoritative outbound-turn model

- Investigation date: `2026-03-07`
- Trigger:
  - session `140` showed that a "dropped message" could really be a
    broken-session lifecycle bug spanning dispatch, disconnect, relaunch,
    init failure, and later user turns
- What changed:
  - `pendingCodexTurnRecovery` stopped being the primary authority
  - Codex outbound user turns now live in one persisted queue:
    `pendingCodexTurns`
  - the queue head is authoritative across:
    - queued
    - dispatched
    - backend-acknowledged
    - blocked broken-session recovery
  - backend health was separated from generation state:
    `initializing | resuming | connected | disconnected | broken`
  - queued Codex traffic stopped flushing on adapter attach and now waits for
    `session_meta`, so resume reconciliation runs before new turn dispatch
  - fresh Codex turns stopped entering running state on optimistic send; they
    now wait for explicit `turn/start` acknowledgement
- Why it was a simplification:
  - one queue became the source of truth for outbound Codex user turns
  - broken-session behavior became explicit instead of falling through generic
    local-running timeout heuristics
  - reconnect/relaunch logic no longer had to infer as much from detached
    adapter state and raw `pendingMessages`
- Practical debugging impact:
  - when debugging a modern Codex delivery bug, start from the head of
    `pendingCodexTurns`, not from older references to
    `pendingCodexTurnRecovery`

### 16. Queue-first redesign needed two follow-up correctness fixes

- Investigation date: `2026-03-07`
- Symptom class:
  - the design was simpler, but two helper paths still violated the new
    authoritative-turn contract
- Fix A: persist migrated queued user turns immediately
  - path:
    `flushQueuedMessagesToCodexAdapter()`
  - problem:
    - a legacy raw Codex `user_message` could still be sitting in
      `pendingMessages`
    - the bridge would migrate it into `pendingCodexTurns`
    - if the queue head was already active, dispatch of the migrated turn was
      blocked and the function could return without persisting the migration
    - crash/restart in that window could lose the migrated turn
  - change:
    - migration to `pendingCodexTurns` now persists immediately before any early
      return
- Fix B: resumed `inProgress` replay must not complete the queue head
  - path:
    `reconcileCodexResumedTurn()`
  - problem:
    - a resumed Codex turn could replay assistant/tool artifacts from the head
      turn while still honestly reporting `lastTurn.status = inProgress`
    - the bridge recovered those artifacts, completed the head turn, and could
      dispatch the next queued user message too early
  - change:
    - recovered browser-visible artifacts are still allowed
    - but if the resumed turn is still `inProgress`, the head queue entry stays
      `backend_acknowledged` and remains authoritative until a terminal status
      arrives
- Why these matter:
  - both fixes preserve the "one authoritative outbound turn" contract instead
    of reintroducing split authority through helper paths
- Regression coverage added:
  - queued-turn migration must persist before blocked dispatch returns
  - resumed `inProgress` turn with replayed assistant items must not advance the
    queue until terminal completion

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
- Do not assume unmatched resume snapshots are always unsafe.
  - if the resumed thread is idle, the last turn still says `inProgress`, and
    the last turn has no items at all, that is a retry-safe stale-turn shape
    even when `pending.turnId` was never captured
- Do not treat "adapter attached" as equivalent to "backend connected".
  - for Codex, adapter attach happens before `session_meta`
  - if queued messages flush before `session_meta`, resume reconciliation can be
    bypassed and the same user turn can be sent twice
- Do not let broken-session user messaging depend on the relaunch callback.
  - even if relaunch wiring is unavailable or delayed, the browser still needs a
    clear blocked/queued error instead of silent timeout behavior
- Do not run recovered-message synthesis before checking whether the resumed turn
  is definitely stale.
- Do not treat replayed assistant/tool artifacts from a resumed `inProgress`
  turn as proof that the head outbound turn has completed.
  - recovery of browser-visible artifacts is allowed
  - queue advancement is not
- Do not migrate Codex `user_message` entries out of raw `pendingMessages`
  without persisting the new `pendingCodexTurns` state before returning.
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
   - Look at `pendingCodexTurns` and identify the head turn.
   - Look at `session.state.backend_state` and `backend_error`.
   - Confirm whether the head outbound turn `turnId` was ever captured or lost
     in the narrow post-`turn/start` disconnect window.
   - Look at resumed `threadStatus`, `lastTurn.status`, and `lastTurn.items`.
   - Check whether stale-turn retry happened before recovery/synthesis.
   - Check whether the bridge ever marked the backend `broken` after init
     failure, or whether later messages were still allowed into local running
     state.

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
   - But prefer reducing state-machine ambiguity over adding another
     one-off retry heuristic.

## Specific code points to inspect first

- `web/server/ws-bridge.ts`
  - image-path conversion and Codex dispatch
  - backend state transitions (`initializing`, `resuming`, `connected`,
    `disconnected`, `broken`)
  - `pendingMessages`
  - `pendingCodexTurns`
  - `reconcileCodexResumedTurn()`
  - `retryPendingCodexTurn()`
  - `isDuplicateCodexAssistantReplay()`
- `web/server/codex-adapter.ts`
  - `handleOutgoingUserMessage()`
  - `onTurnStarted()` / `turn/start` acknowledgement timing
  - `thread/resume` current-turn restoration
  - `handleThreadStatusChanged()`
  - interrupt/wait behavior
- `web/server/cli-launcher.ts`
  - relaunch stale-pid termination
  - Codex init-error cleanup

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
