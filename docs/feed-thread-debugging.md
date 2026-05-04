# Feed and Thread Debugging Guardrails

This guide is for changes that touch chat feed rendering, thread projection,
thread-window hydration, notifications, attention rows, collapsed activity, or
dense leader-session history.

The main risk is not only "slow code." A small render-time loop, impossible test
fixture, or unbounded synthetic row merge can wedge one browser renderer while
the server and other sessions stay healthy. Use these guardrails before editing
the feed path and while reviewing feed changes.

## Quick Reviewer Checklist

- Manual loops in render/model code always advance, return, or fail loudly.
- Thread/feed tests use producer-shaped inputs from shared/server builders,
  captured payloads, or maintained replay fixtures.
- Main, selected quest threads, All Threads, notifications, collapsed turns,
  attachments, selected-window state, and large history are represented when the
  change can affect dense leader sessions.
- Freeze evidence is gathered from outside the renderer when browser probes
  stop returning.
- Main/thread projection invariants are explicitly covered when attachment or
  notification visibility changes.

## Manual Render Loop Progress

Avoid manual `while` loops in render paths unless they are clearly simpler than
an iterator or helper extraction. If a manual loop is needed, every branch must
do one of these before control reaches the next iteration:

- advance the loop index;
- assign the loop index to a known-larger cursor;
- return or break;
- throw in dev/test if the input violates an invariant.

This includes branches that only skip invisible rows, merge adjacent rows, or
render nothing. A `continue` that does not advance can pin the renderer even
when the input is small.

Preferred review pattern:

```ts
let i = 0;
while (i < entries.length) {
  const start = i;
  const entry = entries[i];

  if (shouldSkip(entry)) {
    i++;
    continue;
  }

  if (shouldBatch(entry)) {
    const next = findBatchEnd(entries, i);
    if (next <= i) {
      throw new Error("Feed batcher did not advance");
    }
    renderBatch(i, next);
    i = next;
    continue;
  }

  renderEntry(entry);
  i++;

  if (import.meta.env.DEV && i <= start) {
    throw new Error("Feed renderer loop did not advance");
  }
}
```

Do not rely on visual inspection alone. Add a regression test for the skipped or
batched row that caused the branch to exist. Empty assistant messages,
notification-only rows, hidden marker rows, collapsed turn rows, and synthetic
ledger rows are common skip paths.

## Producer-Shaped Fixtures

Thread/feed/window tests should model the shape the frontend actually receives.
Prefer these sources, in order:

1. Shared/server builders such as `buildThreadWindowSync` or
   `buildThreadFeedWindowSync`.
2. Sanitized captured browser payloads such as `thread_window_sync` or
   `message_history`.
3. Maintained generated fixtures such as
   `web/src/test-fixtures/large-leader-feed-fixture.ts`.

Avoid frontend-invented shapes for server-owned state. If production hides or
adds fields before the browser receives a selected window, the test should
consume that transformed shape too.

Specific examples:

- Main thread windows suppress `thread_attachment_marker` rows. Tests for Main
  attachment retention should not put visible marker rows into
  `selectedFeedWindowMessages` unless they are explicitly testing an impossible
  defensive path.
- Backfilled Main/source rows should be hydrated from raw marker facts in the
  shared/server window builder, then projected into the browser-visible window.
- Attention and notification ledger rows are synthetic frontend rows. Tests that
  exercise selected-window bounds should include the real selected window state,
  not only an arbitrary array of visible messages.
- Captured payload fixtures must be sanitized. Do not commit raw session exports,
  private paths, keys, or user conversation text.

## Dense Leader Replay Coverage

For changes that affect feed organization, selected-thread windows, collapsed
activity, notifications, or attachment projection, a useful replay or fixture
should cover at least:

- Main thread latest-tail rendering.
- One selected quest-thread tab with copied/backfilled context.
- All Threads or another global aggregation view when the code path includes it.
- Journey or event-feed rows.
- Notification chips, including active needs-input/review notifications.
- Collapsed leader activity with dense historical tool and board rows.
- Attachment markers as raw history facts and hidden projected rows.
- Selected-window metadata: item count, total count, from item, source history
  length, older/newer availability, and browser-visible entries.
- Large history size with many irrelevant rows, so model derivation remains
  bounded to the selected window plus explicitly retained rows.

If a full browser replay harness would be substantial, do not build it as part
of a small feed fix. Instead, add a generated fixture or document the missing
coverage in the quest handoff.

## Renderer-Freeze Triage

When the browser appears frozen, gather evidence that does not depend on the
wedged page responding. Record the exact last successful step and save artifact
paths.

Capture:

- browser open/navigation result;
- viewport command result;
- URL/eval result, including whether it timed out;
- screenshot result, including blank/dark screenshots;
- browser close result;
- backend health and Vite health;
- process list with the owned browser renderer CPU;
- console logs collected before the hang;
- server logs and isolated fixture state strategy;
- last visible UI state before probes stopped returning.

Interpretation:

- One renderer process pinned near a full core while backend/Vite stay healthy
  points to a frontend render loop or pathological render path.
- Other sessions staying responsive points away from global server-heavy work.
- A screenshot/eval timeout after a click or route transition should be treated
  as evidence even if the page cannot return in-page performance data.

## Projection Invariants

Preserve these invariants unless a product decision explicitly changes them:

- Main keeps messages that originally belonged to Main/source visible after they
  are attached to a destination quest thread.
- Destination quest threads receive the attached context.
- Source-side `thread_attachment_marker` rows remain hidden in normal Main feed
  projection.
- Future messages explicitly routed to a quest thread stay out of Main.
- Notification chips render once in chronological context when their source row
  is visible.
- Active notification or attention rows should not duplicate as fallback ledger
  rows when the source chip is already visible.
- Collapsed turns preserve visible notification and needs-input chips even when
  dense tool activity stays unmounted.

When touching these areas, include a representative test in one of the existing
feed/window suites:

- `web/shared/thread-window.test.ts` for server/shared selected-window shape;
- `web/src/utils/feed-render-model.test.ts` for projection and ledger derivation;
- `web/src/components/MessageFeed.messagefeed-message-rendering.test.tsx` or
  adjacent `MessageFeed.*.test.tsx` suites for rendered visibility and collapsed
  activity behavior;
- `web/src/utils/feed-render-model.large-leader-budget.test.ts` for dense leader
  budget expectations.

## Follow-Up Harness Shape

A full freeze triage harness would be useful but is intentionally larger than a
normal feed bug fix. The desired version would:

- launch an isolated server and browser profile, never live default state;
- replay a sanitized dense leader session with Main, selected quest tabs,
  notifications, attachments, board/tool rows, and selected-window metadata;
- run deterministic route transitions: Main, selected quest thread, Main
  switchback, All Threads;
- record outside-renderer probes and process CPU after every transition;
- retain screenshots, server logs, Vite logs, browser logs, and fixture metadata;
- support both Claude Code and Codex-shaped messages.

Until that exists, prefer small generated fixtures plus the outside-renderer
triage checklist above.
