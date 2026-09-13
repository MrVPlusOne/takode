# Browser connection transfer diagnostics

The backend logs one `browser-connection` observation for each session WebSocket,
including reconnects. Inspect it with:

```bash
takode logs --component browser-connection --since 10m --limit 100
takode logs --component browser-connection --pattern <connection-id> --json
```

Use the opaque `connectionId` to group events from one physical socket. A new
socket receives a new ID even when it views the same session. `clientPlatform`
is a coarse user-agent hint (`ios`, `android`, `other`, or `unknown`), not verified
device identity. An iPad using a desktop user agent may appear as `other`.
No user agent, client address, URL, message body, tool output, or credentials are
retained by this diagnostic.

Events follow these boundaries:

- `opened`: the backend has accepted the WebSocket. HTML/assets, API bootstrap,
  DNS, TLS, and the WebSocket handshake happened outside this timing boundary.
- `initial_sync_queued`: the first subscribe handler finished. The count includes
  initial messages, selected conversation windows, replay, projections, state,
  and any live messages interleaved on this socket before the end marker.
- `client_marker_received`: the browser acknowledged the marker queued after
  the initial state snapshot. `markerReceiptDelayMs` includes socket buffering,
  downstream delivery, browser message scheduling, and the acknowledgement's
  return trip. It is not an isolated network-latency measurement, proof that all
  prior messages applied successfully, React commit, paint, or frontend usability.
- `initial_sync_slow`: ten seconds have elapsed since socket open without the
  initial marker acknowledgement. `status` identifies whether the server is
  still awaiting subscribe, handling it, or awaiting the browser marker.
- `initial_sync_failed`: the subscribe handler failed. Existing failure behavior
  is preserved; diagnostics do not retry or recover it.
- `closed`: cumulative totals for the whole socket lifetime, including explicit
  later browsing and live updates. An early close retains the incomplete status.

`subscribeStartDelayMs` measures socket-open to first subscribe handling;
`subscribeHandlerMs` measures that handler, including awaited work.
`initialLastSeq` records the normalized initial sequence request. Zero does not
prove a cold page load. `explicitFullHistory` records a deliberately requested
full-history operation. The diagnostic does not change synchronization, replay,
retention, content selection, or model input delivery.

`acceptedPayloadBytes` is the UTF-8 byte length of serialized application payloads
accepted by the socket send API, counted once per actual recipient. It is not
JavaScript string length, compressed bytes, frame/TLS overhead, or proof of
delivery. `initialSyncAcceptedPayloadBytes` freezes that count at the initial
marker; subsequent totals continue to include live traffic. `largestMessageTypes`
reports the eight largest type buckets; `otherAcceptedPayloadBytes` accounts for
the remainder. Type inventory is capped at 32 names plus an overflow bucket.

Bun send result zero counts as dropped; a thrown send counts as failed; minus
one counts as accepted with backpressure. `peakBufferedBytes` samples Bun's
socket buffer after accepted sends. It is not the client's pending work or a
measurement of every buffering layer. The existing aggregate `/api/traffic/stats`
is a separate historical metric: its `wireBytes` is encoded payload size times
fanout, not captured wire traffic.

Warnings are diagnostic heuristics, not load budgets or evidence of a root cause:

- `large_initial_payload`: at least 2 MiB of accepted initial payload.
- `slow_initial_sync`: at least 10 seconds from accepted socket to marker receipt
  or an outstanding initial observation. Backgrounding or client suspension can
  also cause it.
- `send_not_accepted`: a send returned zero or threw.

There is at most one timeout warning per socket. State is bounded by live sockets,
with counts and capped type buckets only; close releases it. The existing async,
rotated server logger owns retention. Raw protocol recording remains independent
and off by default. The content-free probe is not persisted or replayed.

These records cover the session WebSocket, not the whole page. Correlate a phone
retry's exact time, URL/access route, selected session/view, and browser mode with
the connection ID. Use existing frontend performance entries to distinguish
parse/apply, replay flush, React commit, next paint, and long tasks. A fast server
handler cannot establish a fast usable page, and a large transfer alone cannot
establish the cause of a reported delay.

## Frontend startup, foreground, and feed stages

`browser-load` logs retain bounded browser-reported stage batches in the same
rotated backend logger. Join them to the transfer records by the server-issued
`connectionId` and server-owned session ID:

```bash
takode logs --component browser-load --since 10m --limit 100 --json
takode logs --component browser-load --pattern <connection-id> --json
```

The browser receives its diagnostic connection ID in `session_init`, before the
final initial-sync marker. Startup stages observed before that message are
buffered locally and sent once that physical socket has an identity. Diagnostic
reports are consumed independently of the model/session work queue. They do not
enter conversation history, replay, model input, or recovery. Archived sessions
can also report these read-only observations.

Each batch identifies a randomly generated document ID, lifecycle number and
kind (`startup`, `foreground`, or a later `connection`), frontend build ID,
standalone/browser display mode, current visibility, and document time origin.
The server adds its own backend build ID; missing identity remains null.
A surviving document keeps its document ID; reload creates another one. A
foreground lifecycle begins on an observed return from hidden/pagehide state.
`hiddenMs` is the observed wall-clock hidden interval, subject to clock changes;
it is not proof of OS suspension. `pageshow` records `persisted` when available.
Display mode is a browser signal, not independent verification of the physical
device or how the user entered it.

Stage timestamps (`atMs`, `startedAtMs`, `moduleStartedAtMs`) use the document's
monotonic performance clock in milliseconds. Compare stage differences within
that document. `timeOrigin + atMs` provides an approximate browser wall-time
reference; do not subtract it from server timestamps as if the clocks were
synchronized. Server log time is receipt/processing time, not the original stage.

- `module_started` marks execution of the instrumentation module, imported before
  the application. It does not measure the icon tap or the first possible browser
  JavaScript execution. Optional document Navigation Timing fields expose request,
  response, DOM and load milestones without collecting URLs or resource lists.
  Zero-valued unfinished/unavailable milestones are not zero-cost operations.
- `app_commit` is the first root React layout effect. `app_frame` and
  `foreground_frame` are two animation-frame callbacks later. These are scheduling
  observations, not screenshots, compositor completion, or physical presentation.
- `connect`, `open`, `subscribe`, and `sync_marker` locate session connection work.
  A subscribe `view` of `history` means the generic bounded history request; it
  does not infer that the user selected All Threads or that leader routing failed.
- `view_request` records a browser WebSocket send for explicit history/thread
  browsing. `message_received` / `message_applied` record selected protocol
  categories, a numeric receive ID, parse/apply durations, and the view/window
  digest when present. An applied callback is not proof the application accepted
  a stale response. `state_snapshot` application includes synchronous replay work.
- `feed_commit` samples the committed feed's view, loading state, and available
  window digest. The loading state uses the feed's actual loading branch. Matching
  receipt and commit digests provide stronger correlation than session identity
  alone. A cached commit can precede receipt of its validation; preserve event
  ordering rather than assuming every commit follows its matching receipt.
  `feed_frame` follows two frame callbacks, only while that observed feed
  signature, socket and lifecycle are still current. It still does not certify
  pixels or that every asynchronous UI task is finished. A retained feed may
  remain visible without a new React commit; absent commit timing is not a stall.

Capture is limited to 64 stages in the first 90 seconds of a socket observation
or foreground lifecycle, in batches of at most 16. Batches normally flush after
200 ms, or when full/identified/hidden. Browser observation state is capped at 16
sessions, contains only counters and metadata, and retires with its socket. The
backend independently accepts at most 64 stages per socket per 90-second budget
window, even if a client invents more lifecycle resets. Invalid fields, arbitrary
strings, oversized batches, non-finite/negative timings, and unknown keys are
rejected rather than logged. No conversation text, image, URL, address, user
agent, arbitrary resource name, or credentials are collected.

Telemetry is best effort. Failed sends are not retried and do not affect the
application. A disconnected/replaced document can lose queued stages; a stalled
frame callback produces no frame event; a cap or expired capture window can
omit later stages. There is no global raw recording or background history upload.
A complete stall before JavaScript or session connection remains unreported by
this channel. Missing telemetry must not be presented as a fast load.

For a future original-path observation, record a precise user opening time and
separate black-screen, shell, and feed intervals. Inspect matched startup versus
foreground stages, document navigation milestones, first connection/subscribe,
window receipt/application, and matching feed commit/frame callbacks. Activation
and a physical-device observation are separate from source delivery and isolated
validation; these diagnostics do not establish a cause or authorize optimization.
