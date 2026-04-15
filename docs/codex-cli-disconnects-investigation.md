# Codex CLI Disconnect Investigation

Investigation for [q-300](quest:q-300).

This is an investigation and proposal only. No implementation is included here.

## Executive Summary

The strongest supported root cause category is not NFS slowness. On the local
laptop, Takode still sees Codex app-server transports close unexpectedly while
the underlying process often remains alive long enough to require a forced kill
during relaunch.

The most important current findings are:

- Codex disconnects are real adapter transport failures, not just browser UI
  glitches.
- The adapter often loses stdout first, while the process is still alive.
- Takode treats Codex disconnects much more harshly than Claude CLI
  WebSocket disconnects:
  - no grace period
  - immediate `backend_disconnected`
  - immediate turn interruption
  - auto-relaunch only when a browser is attached
- That policy gap is large enough to explain why workers frequently appear as
  `CLI disconnected`, why leaders see dead workers, and why reliability feels
  poor even when some sessions later recover.

Recommended fix direction:

1. Treat unexpected Codex adapter disconnects as restart-worthy even when no
   browser is attached.
2. Stop relying on browser reconnect as the main wake-up path for dead Codex
   sessions.
3. Tighten the “adapter missing but launcher still says connected” paths so
   queued messages can trigger recovery instead of waiting for a later browser
   open.

## What Takode Does Today

### Claude CLI WebSocket path

`web/server/ws-bridge.ts` gives classic CLI WebSocket sessions a 15-second
disconnect grace period in `handleCLIClose()`.

- `handleCLIClose()` starts a timer instead of immediately running full
  disconnect side effects.
- If the CLI reconnects within the window, the disconnect is treated as
  seamless.
- This is explicitly meant to hide transient disconnect/reconnect cycles.

Relevant code:

- `web/server/ws-bridge.ts`
  - `handleCLIClose()`
  - `runFullDisconnect()`

### Codex adapter path

Codex uses stdio through `codex-adapter.ts`, not a reconnecting WebSocket. When
the transport closes, `attachCodexAdapter(...).onDisconnect(...)` immediately:

- clears pending permissions
- marks the turn interrupted
- clears generating state
- broadcasts `backend_disconnected`
- may request relaunch, but only if `session.browserSockets.size > 0`

Relevant code:

- `web/server/codex-adapter.ts`
  - `transport.onClose(...)`
  - `proc.exited.then(...)`
- `web/server/ws-bridge.ts`
  - `attachCodexAdapter(...)`
  - Codex `adapter.onDisconnect(...)`

This is the core Takode asymmetry. Claude CLI gets a grace path. Codex gets an
immediate hard failure path plus browser-gated relaunch.

## Direct Evidence From Current Logs

The current local logs already show the issue on the laptop:

- log files:
  - `~/.companion/logs/server-3455.log`
  - `~/.companion/logs/server-3455.log.1`

Quick counts from those two files:

- `22` Codex adapter disconnect events
- `18` unique Codex sessions affected
- `12` auto-relaunch requests specifically because an active browser was
  attached
- `11` explicit `Transport closed for session ... (process may still be running)`
  events
- `11` later relaunches that had to escalate from `SIGTERM` to `SIGKILL`

That `Transport closed` + `process may still be running` + forced `SIGKILL`
combination is the clearest evidence that the bad state is not “the process
cleanly exited” and not “the browser disconnected”. The stdio transport dies
first.

### Concrete local example

In `server-3455.log`, around lines 548-587:

- session `6043f842` logs:
  - `Transport closed for session ... (process may still be running)`
  - last raw messages were still normal `item/agentMessage/delta`
- session `28401c3b` logs:
  - `Transport closed for session ... (process may still be running)`
  - last raw messages included normal completion/idle messages
- session `12df3e21` logs:
  - `Transport closed for session ... (process may still be running)`
- session `179b7a2c` logs:
  - `Transport closed for session ... (process may still be running)`
  - active browser path immediately requested relaunch
  - the old process then required forced `SIGKILL`

This cluster matters because:

- it happened on the laptop, not the old NFS setup
- it affected multiple Codex sessions in a short window
- the last raw messages were ordinary Codex stream/completion traffic, not an
  obvious Takode-side malformed request
- there was no corresponding large event-loop stall right next to the cluster

The nearest perf line after that burst is:

- `server-3455.log:594`
  - `lag: max=88ms`

That does not support “the event loop was frozen long enough to explain these
disconnects”.

### Detached session recovery is browser-gated

The same log shows a second important failure mode.

After `28401c3b` disconnected, it did not relaunch immediately. It relaunched
only when a browser later reconnected:

- `server-3455.log:604`
  - `Browser connected but backend is dead for session 28401c3b ..., requesting relaunch`

Likewise for `6043f842`:

- `server-3455.log:627`
  - `Browser connected but backend is dead for session 6043f842 ..., requesting relaunch`

That matches the code exactly: Codex auto-relaunch on disconnect only happens
when a browser is already attached. Otherwise the session stays dead until some
later browser open path notices.

### Some disconnects are real mass events, but that is not the whole story

`server-3455.log.1` contains genuine mass-drop incidents:

- up to `21` CLIs dropped within `1ms`
- the log explicitly labels those as likely shared network events

Those events are real and should not be ignored. But they do not explain the
entire reliability problem, because current local logs also show isolated or
small-group Codex transport closures with no matching mass-disconnect marker and
no severe adjacent perf lag.

## Supported Causes

### 1. Unexpected Codex app-server transport loss

This is the strongest supported cause category.

What is directly supported:

- `codex-adapter.ts` is seeing transport close before or independently of clean
  process exit.
- server logs repeatedly say the process may still be running.
- relaunch often has to kill the old process forcibly.

What is not yet proven:

- the exact upstream Codex bug that causes stdout/transport loss
- whether the failure is in Codex itself, the `codex.sh` wrapper, or some
  lower-level process/pipe lifecycle beneath Takode

But the existence of the transport failure itself is directly evidenced.

### 1a. Upstream stdio teardown is not fail-closed

Looking at the latest upstream Codex source from fetched `origin/main`
(`05c582992`) adds an important source-level finding.

In stdio mode, app-server starts two independent tasks:

- a stdin reader in
  `/tmp/openai-codex-cli-origin-main/codex-rs/app-server/src/transport/stdio.rs`
- a stdout writer in the same file

Current behavior:

- if stdin reaches EOF, the reader sends `TransportEvent::ConnectionClosed`
- if stdout `write_all(...)` fails, the writer only logs and exits
- the writer does not notify the processor that the stdio connection is dead
- the reader is not cancelled when the writer dies

That matters because app-server runs single-client stdio mode with:

- `single_client_mode = true`
- `shutdown_when_no_connections = true`

in
`/tmp/openai-codex-cli-origin-main/codex-rs/app-server/src/lib.rs`

So upstream shutdown depends on the stdio connection being considered closed.
But on stdout write failure, the transport currently does not fail closed.

This is a strong explanation for the Takode-side pattern:

- parent sees child stdout close
- Takode logs `Transport closed ... (process may still be running)`
- the process can linger until forcibly killed during relaunch

This source-level finding is strongest for explaining the lingering zombie-ish
process after transport loss. It does not, by itself, prove why the stdio peer
breaks in the first place.

### 2. Takode’s Codex recovery policy amplifies the impact

This is fully supported by current code.

Codex disconnect handling in `ws-bridge.ts` currently makes the user-visible
experience worse than it needs to be:

- immediate disconnect state
- immediate turn interruption
- no equivalent of the Claude CLI grace window
- no autonomous relaunch for detached sessions

Even if the upstream Codex transport issue remained unchanged, this recovery
policy would still cause many sessions to look broken longer than necessary.

### 3. Message wake-up logic is too narrow when the adapter is gone

This is a smaller but important Takode-side issue.

In `routeBrowserMessage()` and `injectUserMessage()`:

- queued Codex messages request relaunch only when launcher state is `exited`
- not merely when the adapter is missing or the backend is effectively dead

That means a session can be in the bad state:

- launcher says `connected`
- adapter is gone
- queued work exists
- no immediate relaunch is triggered from some message paths

This does not create the original disconnect, but it does prolong it.

## Current Instrumentation

This investigation now has fresh instrumentation in both Takode and the local
`mai-agents` wrapper so the next repro should answer more specific questions.

### mai-agents wrapper change

`/Users/jiayiwei/Code/mai-agents/codex.sh` now:

- resolves `codex` once before launch
- emits wrapper diagnostics to stderr when `MAI_CODEX_DEBUG_WRAPPER=1`
- uses `exec "$CODEX_BIN" ...` for the final handoff instead of leaving the
  bash wrapper as a long-lived parent

New wrapper log prefix:

- `[mai-codex-wrapper] ...`

What this should prove:

- whether Takode still ends up talking to a wrapper process or only the real
  Codex launcher chain
- what the wrapper PID and PPID were at launch

### Takode launcher instrumentation

`web/server/cli-launcher.ts` now:

- sets `MAI_CODEX_DEBUG_WRAPPER=1` for host Codex sessions
- logs a process snapshot right after Codex spawn
- logs another process snapshot when the Codex adapter disconnects

New launcher log prefix:

- `[cli-launcher] Codex process snapshot ...`

What this should prove:

- whether the spawned PID still has direct child processes underneath it
- whether the `codex.sh` shell parent disappeared after `exec`
- what process tree is still alive when Takode reports adapter disconnect

### Takode adapter instrumentation

`web/server/codex-adapter.ts` now logs:

- `pid=...`
- `pidAlive=...`
- `closeContext=stdout_eof(...)` or `stdout_read_error:...`
- explicit `stdin write failed ...` diagnostics if parent-side writes to the
  Codex stdin pipe start failing

What this should prove:

- whether the first observed failure is:
  - stdout EOF on the child -> parent read side
  - a stdout read error
  - a parent-side stdin write failure

### How to read the next repro

Most useful sequences to look for:

1. Wrapper breadcrumb at launch, then spawn snapshot shows no lingering shell:
   - supports the theory that the wrapper was only an extra parent, not the
     remaining disconnect trigger
2. `stdin write failed ...` before transport close:
   - points to child-side stdin being gone first
3. `closeContext=stdout_eof(...)` with no earlier stdin write failure:
   - points to child stdout disappearing first
4. Process snapshot at adapter disconnect still shows healthy-looking Codex
   descendants:
   - supports the theory that transport died before process-tree shutdown
5. Process snapshot at adapter disconnect shows only the parent PID and no
   descendants:
   - suggests the launcher chain already collapsed before Takode observed the
     close

## What Is No Longer Well-Supported

### “This is mainly NFS slowness”

No longer sufficient.

Why:

- the user explicitly moved Codex to run locally on the laptop
- current laptop logs still show the problem
- current evidence points at transport closure with live processes, not only
  slow I/O

NFS may still have explained some older historical failures, especially when the
server or worktree setup blocked the event loop. But it does not explain the
current local pattern by itself.

### “This is just a browser WebSocket issue”

Not supported.

The relevant failure happens on the server-to-Codex side first:

- `codex-adapter` sees transport close
- `ws-bridge` reacts to adapter disconnect
- browser banners are downstream symptoms

### “All of these are just shared network blips”

Not supported.

There are real mass events in the logs, but the persistent Codex reliability
problem also occurs outside those bursts.

## UX Failure Modes

### Active chat open in browser

What the user sees:

- after a short debounce in `web/src/ws-handlers.ts` (`250ms`), the UI flips to
  disconnected
- `web/src/components/ChatView.tsx` renders a `CLI disconnected` banner with a
  `Resume` button
- if relaunch/init fails, the banner becomes the broken-session state

What is at risk:

- the active turn is interrupted
- in-flight tool progress is cleared
- pending work depends on recovery/replay logic

Takode does have significant Codex turn-recovery machinery, so this is not a
guaranteed data-loss event. But it is still a real interruption, not a cosmetic
blip.

### Detached worker with no browser attached

What the leader/workflow sees:

- the worker can silently become dead while not being actively viewed
- it does not immediately relaunch on disconnect
- later, when a browser opens that session, Takode notices `backend is dead`
  and only then requests relaunch

What is at risk:

- orchestrated work stalls until something explicitly reopens or wakes the
  worker
- queued follow-up instructions may wait longer than expected

This is one of the clearest reliability problems for normal Takode orchestration
because workers are often detached most of the time.

### Broken-session path after relaunch/init failure

If the adapter fails during init, Takode moves the session to `backend_state =
"broken"` and later user messages are queued behind the blocked recovery turn.

What the user sees:

- a broken-session banner
- later messages do not run immediately
- explicit relaunch is required

This is the correct behavior for an unrecoverable restart failure, but it is a
separate failure mode from the more common plain `disconnected` case.

## Strongest Root Cause Statement

The strongest supported root cause statement today is:

Takode is suffering from real Codex stdio transport failures on the local
laptop, where the adapter loses its transport while the Codex process often
remains alive. Takode’s current Codex recovery policy then turns those transport
failures into a visible reliability problem by immediately marking sessions
disconnected and only auto-relaunching if a browser is already attached.

That statement is directly supported by current code and current logs.

What is still not proven is the exact upstream reason the Codex transport is
closing.

## Recommended Fix Direction

### 1. Auto-relaunch detached Codex sessions too

Unexpected Codex adapter disconnects should request relaunch even when
`session.browserSockets.size === 0`, subject to the existing failure cap and
intentional-relaunch guard.

Why this is the highest-value Takode fix:

- it directly targets the worker-session reliability problem
- it removes browser attachment as a hidden prerequisite for recovery
- it does not require first solving the deeper upstream transport bug

### 2. Treat “adapter missing” as enough reason to recover

Message-triggered wake-up paths should not require launcher state to already be
`exited`.

If:

- the adapter is gone
- backend is effectively dead
- the session is not intentionally broken

then queued work should be allowed to trigger recovery.

### 3. Add an explicit Codex recovering state

For active browsers, the current UX jumps quickly to `CLI disconnected`.

That is technically true, but it is a poor presentation when Takode is already
attempting recovery. A `recovering` or `restarting Codex` state would more
honestly describe what is happening and reduce perceived flakiness.

This is secondary to the relaunch-policy fix, not the primary fix.

### 4. Keep the current process-kill-on-relaunch behavior

The logs show this is necessary. When transport is gone but the process is still
alive, Takode needs to terminate the stale process before starting a new one.

The problem is not that Takode kills too aggressively during relaunch. The
problem is that it does not always decide to relaunch soon enough.

### 5. Upstream Codex app-server should fail closed on stdio peer loss

The concrete upstream patch direction suggested by the source is:

- add a shared cancellation token for the stdio connection
- make the stdout writer cancel that token on `write_all(...)` failure
- make the stdin reader `select!` on either `next_line()` or cancellation
- ensure stdio peer loss causes exactly one `ConnectionClosed` path
- ensure single-client stdio mode stops both halves promptly instead of leaving
  the reader blocked on stdin after stdout already died

That would not prove away every unexpected disconnect, but it would remove one
clear upstream lifecycle bug that currently matches the “stdout closed, process
still alive, later SIGKILL” evidence.

## Verification Plan For A Later Implementation

### Automated coverage

Add or extend tests in `web/server/ws-bridge.test.ts` for:

- Codex adapter disconnect with no attached browser should still request
  relaunch
- queued Codex user message should request relaunch when adapter is missing even
  if launcher state still says `connected`
- intentional relaunch still must not double-spawn
- repeated disconnects still stop after the existing max-failure cap

Add or extend UI tests for:

- active Codex session shows recovery state correctly during auto-relaunch
- detached worker does not require a browser-open round trip before recovery

If pursuing the upstream Codex patch too, add app-server coverage for:

- stdio stdout-write failure should cause connection teardown
- stdio reader should stop when the paired writer dies
- single-client app-server should not linger indefinitely after one half of the
  stdio transport is lost

### Manual verification

1. Start one leader and multiple Codex workers.
2. Leave at least one worker detached.
3. Force or reproduce a Codex transport drop.
4. Verify:
   - detached worker auto-relaunches without opening its chat first
   - leader can continue dispatching without manual `Resume`
   - active browser path shows a recovery state instead of lingering
     disconnected/broken UI unless the relaunch actually fails

### Log-level acceptance criteria

After the fix, for an unexpected detached Codex disconnect, logs should show:

- `Codex adapter disconnected ...`
- immediate relaunch request without waiting for `Browser connected but backend is dead ...`

The old browser-gated recovery signature should disappear for ordinary detached
Codex crashes.

## Bottom Line

The old NFS theory is no longer the main explanation.

Current local evidence supports a two-layer diagnosis:

- upstream-facing layer:
  - Codex stdio transport sometimes dies unexpectedly while the process still
    lives
- Takode layer:
  - Codex recovery is too browser-dependent and too eager to expose a hard
    disconnected state

The most pragmatic next fix is on the Takode layer:

- auto-relaunch unexpected Codex adapter failures even for detached sessions
- widen the wake-up logic for adapter-missing Codex sessions
- optionally improve active-browser recovery UX so transient restarts are shown
  as recovery, not just failure
