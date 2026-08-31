# Synchronized Projection Performance Baseline

Baseline established on August 30, 2026 against synchronized runtime target `b54821520f863c00af50d38db93edce439d048a3`, remeasured after the framework-only consolidation on a worktree based on `8e03fd27999c6fe29d576bed367ad3296d71a146`, and remeasured again after the session-navigation and session-attention cleanups on August 31, 2026.

This document fixes the comparison boundary for the session-navigation and leader-thread-tab projection migrations. It compares equivalent bounded feature work, not whole-server behavior or unrelated commits.

## Supported runtime boundary

The supported target is a frontend and backend from the same compatible build. Current cases always use accepted synchronized projections.

Missing or malformed projection envelopes are historical controls only. Mixed-version negotiation and fallback are unsupported: subscription requests carry only projection identity, the wire value is validated by the current descriptor, and a delayed acknowledgement no longer turns `state_snapshot` into an old-backend fallback boundary. Build-mismatch detection and the resulting Reload flow remain owned separately. Persisted-state migration and current-version ordering, authorization, archive fencing, partial acknowledgement, and gap recovery remain required. Confirmed feature compatibility work that still executes for a compatible pair is measured as removable overhead; parallel detail or activity authorities are kept distinct.

## Reproducible code-accounting boundary

Use each feature commit against its own direct parent. Do not use one cumulative range, because unrelated commits sit between the original leader-tab migration and its repair.

| Change | Direct-parent range | Non-test files touched | Additions | Deletions | Net |
| --- | --- | ---: | ---: | ---: | ---: |
| Session navigation | `12b08e56dd321d5cd7138cf5e57ee42eb8796f7d..6b50d3bd51b3782540016f02dc76576e5b70281d` | 44 | 2,915 | 836 | +2,079 |
| Leader tabs, original | `6b50d3bd51b3782540016f02dc76576e5b70281d..928cf8d8efc37546fdc13ef86ba837da581f0ebc` | 26 | 2,108 | 231 | +1,877 |
| Leader tabs, authority/order repair | `406e91036c4954ed5ce4d651d4680e73faf5af63..84ef893a8e139bfcdb7101349f4ffd679608f7e9` | 23 | 2,621 | 1,586 | +1,035 |
| Repair fixture follow-up | `84ef893a8e139bfcdb7101349f4ffd679608f7e9..255a78e26de763aafb1ff5250322117ba95a7299` | 0 | 0 | 0 | 0 |
| **Repaired current envelope** | three non-test ranges above | **93 range-local touches / 68 unique files** | **7,644** | **2,653** | **+4,991** |

| Category | Net lines |
| --- | ---: |
| Server production | +2,251 |
| Shared protocol and types | +1,044 |
| Frontend state and components | +1,696 |
| **Total non-test footprint** | **+4,991** |

The later `90af5d6686c5930aac768c7288455c409433fb86` recovery commit and `b54821520f863c00af50d38db93edce439d048a3` scheduled-tab priority follow-up are excluded from the original migration footprint. The latter adds one bounded activation-history boolean per projected tab, so the leader-tab wire figures below were remeasured on that synchronized target.

The reusable synchronized-projection foundation is excluded in full: `0e5c6eb2e1f49856d48e57556de260b5984f8d2f..a17da8a10e3fc19385c30467126e3b6fe659fe2c`. Later feature-specific definitions, registrations, invalidations, subscriptions, wire integration, stores, resolvers, compatibility arbitration, and UI consumption remain included even when they modify generic framework files.

A file is non-test when it is under `web/server`, `web/shared`, or `web/src` and its path contains neither `.test.` nor `/test-fixtures/`. Category reporting treats `web/src/types.ts` as shared protocol/types; the remaining non-test `web/src` paths are frontend. Runtime Playground code is included in the footprint, although it is not a performance hot path.

To regenerate one row:

```bash
git diff --numstat --no-renames <parent> <commit> \
  | awk '$3 !~ /\.test\./ && $3 !~ /\/test-fixtures\// { files += 1; added += $1; deleted += $2 } END { print files, added, deleted, added - deleted }'
```

The +4,991 total is an exact conservative patch envelope, not a claim that every line is new projection logic. It includes organizational extractions such as the turn-tool summary, Codex replay deduplication, thread-attachment broadcasting, and the Work Board tab component split. Some are nearly pure moves; the Work Board split also contains repaired tab behavior and cannot be excluded safely by path.

## Framework consolidation remeasurement

The framework-only pass centralizes the three current projection descriptors—ID, REST field, subscription scope, value validator, equality/reconciliation, and byte ceiling—then drives typed client access, session-list hydration/fencing, REST field typing, subscription inventory, and generic invalidate/remove iteration from that registry. Navigation and leader tabs now use a direct-value definition helper; shared codec and stable-reconciliation primitives replace repeated validation, UTF-8 sizing, and array/record reuse code.

The same-build contract also removes generic compatibility plumbing: subscription requests no longer send unused generation/revision hints, `state_snapshot` no longer interprets a delayed acknowledgement as an unsupported backend, and projection envelopes no longer carry a redundant outer schema-version literal. Generation/revision ordering, exact snapshot-before-ack settlement, malformed-value rejection, partial-ack fencing, and feature-specific persisted-state migration remain unchanged.

The runtime now keeps unsubscribed invalidations dirty without selecting or constructing a value. The first requested snapshot computes it; later subscribers and reconnects reuse the clean cache. This changes navigation and generic leader no-subscriber work from one selection/derivation and 1,506 B/7,138 B of constructed cache to zero, and reconnect dependency selections from one to zero. Initial two-browser subscription selection falls from two to one for both families.

These are real framework wins, but they do not satisfy the full matched-pair gate. Removing the redundant envelope field saves 18 B per snapshot/update; retained feature activity/detail payloads, whole-value projection updates, sequential frontend delivery, and broad row subscriptions still dominate the failing scenarios below.

## Measurement method and limitation

The executable controls live in `web/server/projection-performance.test.ts` and `web/src/projection-performance.test.tsx`.

- Historical revisions anchor the control boundary, but the tests do not load archived binaries. They execute the retained current payload builders and legacy frontend branches with projections absent, then freeze their expected structural results. This is a controlled equivalent baseline, not a claim about unrelated whole-build timing.
- The server fixture has 24 visible sessions, one leader, 12 retained tabs, two browser subscribers, and a 25-frame producer burst.
- The frontend fixture renders four actual `SessionItem` rows or one actual `WorkBoardBar`, then sends full producer-shaped messages through the current WebSocket handler. Current matched-pair cases always install a valid accepted projection.
- Server control accounting records source/payload assemblies, logical sends, deliveries, bytes, and zero historical subscription work. Current runtime metrics add invalidations, batches, dependency selections, derivations, suppressions, updates, snapshots, and accepted subscriptions.
- Raw socket capture supplies exact serialized message bytes because runtime byte counters cover projection values rather than full envelopes.
- React Profiler commit counts and Zustand notification counts are hard evidence. Duration is report-only because sub-millisecond JSDOM timing is too noisy for a gate.

Reproduce the report with:

```bash
cd web
TAKODE_PRINT_PROJECTION_PERFORMANCE=1 \
TAKODE_PROJECTION_PERF_REPORT=1 \
bun --no-install ./node_modules/.bin/vitest run \
  server/projection-performance.test.ts \
  src/projection-performance.test.tsx \
  --reporter=verbose
```

## Framework-consolidation server results (pre-session-navigation cleanup)

### Equivalent control versus matched-pair event work

Counts below use two browsers. “Assembly” is one full control/parallel payload assembly or one projection dependency/value assembly.

| Family and scenario | Historical assemblies / sends / deliveries | Matched-pair assemblies / sends / deliveries | Historical bytes per browser | Matched bytes per browser | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Navigation equal producer frame | 1 / 1 / 2 | 2 / 1 / 2 | 412 | 366 | Same sends; smaller retained frame, projected value suppressed |
| Navigation one status change | 1 / 1 / 2 | 2 / 2 / 4 | 412 | 2,037 | Worse: 4.94× bytes and one extra send |
| Navigation 25-frame burst | 25 / 25 / 50 | 26 / 26 / 52 | 10,300 | 10,821 | Worse: 5.1% more bytes and one extra send |
| Leader equal board producer | 2 / 2 / 4 | 3 / 2 / 4 | 6,934 | 6,934 | Same wire; projected value suppressed |
| Leader Work → Memory producer | 2 / 2 / 4 | 3 / 3 / 6 | 7,102 | 14,834 | Worse: 2.09× bytes and one extra send |
| Leader 25-frame phase burst | 50 / 50 / 100 | 51 / 51 / 102 | 177,550 | 185,282 | Worse: 4.4% more bytes and one extra send |

Each leader board producer includes the companion global activity message followed by `board_updated`. The control and current pair are modeled with established leader navigation and attention subscriptions, so the activity message uses its subscribed residual shape.

The projection runtime itself coalesces effectively: one or 25 navigation status frames settle as one batch, one selection, one derivation, and one projection publication; leader phase invalidations behave the same. That internal saving does not make the matched pair cheaper while retained activity plus board/detail payloads still arrive for every producer frame.

Navigation and leader tabs still select their complete final value, but the direct-value helper now owns the shared equality and identity-derivation mechanics instead of repeating them in each definition. `dependencyEqualSuppressions` therefore remains the effective no-op path and `equalValueSuppressions` remains zero.

### Narrow updates, subscriptions, and no-subscriber work

| Measurement | Historical or parallel payload | Projection contribution | Matched/current result |
| --- | ---: | ---: | ---: |
| Navigation one status change, per browser | 366 B retained activity/notification fields | 1,671 B | 2,037 B total |
| Leader narrow thread-status update, per browser | 236 B feature compatibility payload | 7,641 B | 7,877 B currently shipped |
| Leader Work → Memory producer, per browser | 3,317 B subscribed activity residual + 3,785 B board/detail payload | 7,732 B | 14,834 B total |

Initial subscription for two browsers performs one dependency selection, one initial derivation, two accepted subscriptions, and two snapshots because the second subscriber reuses the clean cache. The projection snapshot-plus-ack response is 1,801 B per browser for navigation and 7,781 B for leader tabs. The normal `state_snapshot` follows and is not included in those incremental totals. Historical navigation has no navigation-projection subscription work; the leader control already assumes the shared navigation and attention subscriptions but has no leader-tabs subscription.

A cold invalidation with no subscribers now records dirtiness without selection, derivation, or cached-value construction for both navigation and leader tabs. The next requested snapshot computes the current value, while clean reconnect snapshots reuse the cache with zero dependency selection. Targeted cross-leader invalidation remains demand-gated.

## Framework-consolidation frontend results (pre-session-navigation cleanup)

All counts exclude initial mount and compare equal final rendered output. Row commits count four actual `SessionItem` children.

### Session navigation

| Scenario | Historical commits / row commits / store notifications | Isolated projection | Matched compatible pair | Result |
| --- | ---: | ---: | ---: | --- |
| Equal producer frame | 1 / 4 / 4 | 0 / 0 / 1 | 1 / 4 / 4 | Matched pair is equal, not better |
| One status change | 1 / 4 / 4 | 1 / 4 / 1 | 2 / 8 / 4 | Worse by one full-list commit |
| Three-frame burst | 3 / 12 / 12 | 1 / 4 / 1 | 4 / 16 / 10 | Fewer store writes, but one more commit |
| Reconnect | 1 / 4 / 15 | — | 2 / 8 / 16 | Worse by one full-list commit |

The isolated projection suppresses equal values and coalesces its own burst. The matched pair does not: retained activity/notification delivery adds a separate render boundary. One session revision also rerenders every measured row rather than isolating the owning row.

### Leader thread tabs

| Scenario | Historical commits / store notifications | Isolated projection | Matched compatible pair | Result |
| --- | ---: | ---: | ---: | --- |
| Equal board producer | 2 / 8 | 0 / 1 | 2 / 7 | Same commits, slightly fewer writes |
| One phase change | 2 / 8 | — | 3 / 7 | Worse by one commit |
| Three-frame burst | 7 / 24 | 1 / 1 | 7 / 19 | Same commits, fewer writes |
| Reconnect | 1 / 20 | — | 2 / 19 | Fewer writes, but one more commit |

Two independently reset compatible clients produced identical structural results. Aggregate commits and notifications scaled exactly linearly, matching the server’s one-delivery-per-subscriber fanout.

## Session-navigation cleanup remeasurement

The August 31, 2026 cleanup completes the current-build session-navigation migration. Projection updates now materialize directly into the existing `sdkSessions` row, and that row is the sole browser navigation read model. Mixed-version runtime arbitration, parallel status and permission-count activity delivery, duplicate name/preview caches, the second Takode session-list assembler, and stale consumer subscriptions are removed. REST envelopes remain ordering inputs, while stale or partial-ack responses cannot overwrite a newer materialized navigation row.

The gray-dot regression was traced to stale producer idle state outranking live generation. Current running, compacting, and reverting authority now wins; a fenced stale REST row also preserves the current `running` field rather than replacing it with `idle`.

### Current server results

| Navigation scenario | Historical control sends / deliveries / bytes per browser | Current compatible pair | Result |
| --- | ---: | ---: | --- |
| Equal producer frame | 1 / 2 / 412 B | 0 / 0 / 0 B | Better; one dependency check, no derivation or publication |
| One status change | 1 / 2 / 412 B | 1 / 2 / 180 B | Better; one 20 B field patch, 40 B delivered across two browsers |
| 25-frame status burst | 25 / 50 / 10,300 B | 1 / 2 / 180 B | Better; 50 invalidations coalesce into one selection, derivation, and patch |
| Cold invalidation without subscribers | no projection work | zero selection, derivation, cache construction, sends, or bytes | Demand-gated |

Initial navigation subscription remains bounded at 1,787 B per browser. The cached full value is 1,492 B; a clean reconnect reuses it with zero dependency reselection and returns one snapshot plus acknowledgement for the accepted key.

### Current frontend results

| Scenario | Historical root / row commits / store notifications | Current compatible pair | Result |
| --- | ---: | ---: | --- |
| Equal producer frame | 1 / 4 / 4 | 0 / 0 / 1 | Better; no component commit |
| One status change | 1 / 4 / 4 | 1 / 1 / 1 | Same root commits; only the changed row rerenders |
| Three-frame burst | 3 / 12 / 12 | 1 / 1 / 1 | Better and coalesced |
| Reconnect | 1 / 4 / 14 | 1 / 1 / 15 | No added commit; only the changed row rerenders |

Two independently reset compatible clients still produce identical output, and aggregate delivery/render work remains exactly linear by client.

### Final feature-size accounting

The hard size gate compares the original session-navigation migration with this cleanup, excluding only the already-audited 57-line incidental turn-tool-summary extraction and genuinely generic synchronized-projection patch/runtime machinery.

| Accounted change | Server | Shared protocol/types | Frontend | Total |
| --- | ---: | ---: | ---: | ---: |
| Original migration, gross | +759 | +382 | +938 | +2,079 |
| Original feature baseline after the 57-line incidental exclusion | +702 | +382 | +938 | **+2,022** |
| Current cleanup, raw tracked production delta | -160 | -366 | -1,425 | -1,951 |
| Current cleanup after generic framework exclusions (+27 server, +11 shared, +39 frontend) | -187 | -377 | -1,464 | **-2,028** |
| **Final session-navigation feature stack versus its direct-parent baseline** | **+515** | **+5** | **-526** | **-6** |

The final feature-specific non-test stack is therefore 6 lines smaller than the pre-migration baseline. The exclusion remains conservative: navigation definition, registration, materialization, source invalidation, REST integration, and UI consumption stay feature-owned; only generic patch transport/application and runtime support are removed from the count.

This closes the session-navigation-local wire, render, no-subscriber, duplicate-path, and code-size gates. It does not change the leader-thread-tab measurements below or waive final whole-application acceptance: leader cleanup remains downstream work, followed by the mismatch-only compatibility audit and final gate.

## Session-attention cleanup remeasurement

The August 31, 2026 cleanup makes `SESSION_ATTENTION_PROJECTION` the sole compact visual authority for current compatible builds. Projection-absent REST and WebSocket hydration, frontend notification reconstruction, optimistic attention-map mutation, and row/sidebar/hover arbitration are removed. Persisted attention inputs, exact owner notification inboxes, compact global notification summaries, permission detail, attention records, and read/unread commands remain separate server-owned authorities.

Malformed known projection messages and acknowledged subscriptions whose replacement snapshot is missing or malformed now fail closed, revoke stale visual state, and request one deduplicated resync. Unknown or unrequested identities cannot trigger resync. Browser-title and global-bell counts remain notification-summary projections of active unmuted needs-input prompts; they do not inherit permission, error, manual-unread, review, or muted-attention semantics from the session-attention projection.

### Current server results

Counts use two browsers and separate required owner detail, compact global summary, and synchronized projection traffic. Historical controls reconstruct the duplicate payloads at `0e5c6eb2e1f49856d48e57556de260b5984f8d2f`; they do not execute the archived binary.

| Attention scenario | Historical control sends / deliveries / total bytes | Current compatible pair | Result |
| --- | ---: | ---: | --- |
| Equal invalidation | 0 / 0 / 0 B | 0 / 0 / 0 B | Equal; one dependency check suppresses derivation and publication |
| First needs-input | 6 / 9 / 3,087 B | 3 / 5 / 1,573 B | Better; one owner inbox, one compact global summary, one projection update |
| First review | 6 / 9 / 3,042 B | 3 / 5 / 1,538 B | Better; same separated-authority shape |
| Same urgency, count 1 → 2 | 4 / 6 / 2,299 B | 3 / 5 / 1,685 B | Better; count changes without reviving raw attention delivery |
| 25-notification burst | 102 / 153 / 99,312 B | 51 / 77 / 71,889 B | Better; required detail/summary frames remain, projection work coalesces once |
| Explicit read/clear | 4 / 6 / 2,042 B | 3 / 5 / 1,321 B | Better; clear is projected without a raw attention/read session update |
| Permission appears | 2 / 3 / 1,029 B | 2 / 3 / 695 B | Same sends; owner permission detail plus scoped projection replaces global permission summary |

Every changed projection scenario performs one dependency selection, one derivation, and one update after its invalidations drain. Initial two-browser subscription is 366 B per browser with one source selection and one derivation; a clean reconnect is also 366 B and reuses the cache without dependency selection or derivation. With no attention subscriber, three notification invalidations perform zero selection, derivation, cache construction, projection sends, or projection bytes; required owner inbox and compact global summary delivery remains intact.

The measured current path sends no raw `attentionReason`/`lastReadAt` session update, exposes no legacy attention or permission fields in global summaries, and sends neither notification inbox nor permission detail to the observer browser. Two subscribers add delivery only; they do not add source selection or derivation.

### Current frontend results

Four real `SessionItem` rows exercise full producer-shaped notification detail and synchronized projection messages. Counts exclude initial mount.

| Scenario | Historical control root / owning-row commits / store notifications | Current compatible pair | Result |
| --- | ---: | ---: | --- |
| Equal value | 0 / 0 / 2 | 0 / 0 / 2 | Equal and commit-free |
| First visible needs-input | 1 / 1 / 2 | 1 / 1 / 2 | Equal; unrelated rows do not rerender |
| Same urgency, count 1 → 2 | 0 / 0 / 2 | 0 / 0 / 2 | Equal; projected count advances without a compact-row commit |
| Three-transition burst | 3 / 3 / 6 | 1 / 1 / 4 | Better; the final projected visual state commits once |
| Explicit read/clear | 1 / 1 / 3 | 1 / 1 / 2 | Equal commits, fewer store notifications |
| Reconnect | 0 / 0 / 18 | 0 / 0 / 18 | Equal; the accepted equivalent snapshot adds no commit |

Two independently reset compatible clients produce identical output. Aggregate root commits, owning-row commits, and notifications scale exactly linearly. Focused row, tree, hover, title/bell, participant, malformed/resync, and Playground coverage verifies that compact surfaces converge while notification/detail authority remains independently usable.

### Final attention feature-size accounting

The frozen pre-migration attention feature baseline is **+442 non-test lines** after excluding the reusable synchronized-projection foundation: +218 server, +37 shared protocol/types, and +187 frontend. Final cleanup accounting is completed from the synchronized starting target, excludes test paths, and separately neutralizes generic malformed/resync framework hardening rather than charging it to this feature. Runtime Playground coverage remains feature-owned production code.

| Accounted change | Server | Shared protocol/types | Frontend | Total |
| --- | ---: | ---: | ---: | ---: |
| Frozen pre-migration feature baseline | +218 | +37 | +187 | **+442** |
| Current cleanup, raw tracked production delta | -103 | 0 | -353 | **-456** |
| Generic malformed/resync framework exclusion | 0 | 0 | -42 | **-42** |
| Current cleanup after exclusion | -103 | 0 | -395 | **-498** |
| **Final attention feature stack versus its direct-parent baseline** | **+115** | **+37** | **-208** | **-56** |

The final feature-specific stack is therefore **56 non-test lines smaller than the pre-migration baseline**. The current frontend count includes the dedicated Playground matrix; the exclusion covers only reusable validation and resync transport behavior shared by every synchronized projection.

## Leader-thread cleanup remeasurement

The August 31, 2026 cleanup completes the current-build leader-thread visual migration. The accepted synchronized projection is now the only runtime tab, attention, phase-color, status-marker, Journey, and participant visual authority. Mixed-version arbitration, the client-side surfacing observer, projection-to-command synthesis, the full-history attachment broadcast arm, duplicate board/activity/status visual fields, and production-only copies of legacy visual builders are removed. Detailed board rows, notifications, history, routing, selection, persisted order/tombstones, and commands remain independently authoritative.

Persisted-state compatibility is intentionally narrow. `tabState: null` means the server has no durable open-tab state and permits one browser-to-server migration of older local tab keys. Once durable state exists, `tabState` is only `{ version: 1 }`; projected `tabs[]` supplies canonical visual order, while tombstones, explicit-order timestamps, capacity fences, and server-candidate promotion history remain server-only state.

### Current server results

| Leader scenario | Historical control sends / deliveries / bytes per browser | Current compatible pair | Result |
| --- | ---: | ---: | --- |
| Equal board producer | 2 / 4 / 6,934 B | 1 / 2 / 3,285 B | Better; duplicate global activity is removed and the equal projection is suppressed |
| Work → Memory phase change | 2 / 4 / 7,102 B | 2 / 4 / 4,286 B | Same sends and deliveries, 39.6% fewer bytes |
| 25-frame phase burst | 50 / 100 / 177,550 B | 26 / 52 / 83,150 B | Better; projection work coalesces to one publication and board detail remains authoritative |
| Narrow thread-status change | 1 / 2 / 236 B | 1 / 2 / 228 B | Better; the legacy status broadcast is retired in favor of one keyed patch |

A phase burst performs one projection dependency selection and one derivation after 25 invalidations. Equal values publish nothing. Targeted cross-leader and generic no-subscriber invalidations perform zero projection selection or derivation until a subscriber requests the value. Initial two-browser subscription is 7,602 B per browser, the cached full value is 7,311 B, and reconnect reuses that cache with one snapshot plus acknowledgement and no duplicate update. Additional browsers do not increase source selection or derivation; delivery remains exactly linear.

### Current frontend results

| Scenario | Historical root commits | Current compatible pair | Result |
| --- | ---: | ---: | --- |
| Equal board producer | 0 | 0 | Equal; the accepted equal projection is commit-free |
| One phase change | 1 | 1 | Equal; one atomic projected visual change |
| Three-frame phase burst | 3 | 2 | Better; one detail-count commit plus one final projection commit |
| Reconnect | 1 | 1 | Equal; the following detailed snapshot is a selector no-op |

The current pair preserves identical structural output across independently reset clients, with aggregate commits and notifications scaling exactly linearly. The Work Board continues to expose off-board historical threads through its **Other** control; detailed rows remain available for that view without becoming a second tab visual authority.

### Final leader feature-size accounting

The frozen pre-migration leader-thread feature baseline is +2,912 non-test lines. The cleanup is measured from the synchronized starting commit and excludes test paths. One 51-line file was already a test-store helper despite living under a production component path; moving it into `src/test-fixtures` is therefore added back rather than claimed as feature removal. Production-dead visual builders moved into test fixtures remain counted as removals because they no longer ship or execute.

| Accounted change | Server | Shared protocol/types | Frontend | Total |
| --- | ---: | ---: | ---: | ---: |
| Current cleanup, raw tracked production delta | -550 | -559 | -2,027 | **-3,136** |
| Test-helper relocation exclusion | 0 | 0 | +51 | **+51** |
| Current cleanup after exclusion | -550 | -559 | -1,976 | **-3,085** |
| Frozen pre-migration feature baseline | — | — | — | **+2,912** |
| **Final leader-thread feature stack versus its direct-parent baseline** | — | — | — | **-173** |

The final feature-specific stack is therefore 173 lines smaller than the frozen pre-migration baseline. No second full visual derivation stack remains active: current runtime visuals come from the synchronized projection, while retained legacy algorithms exist only as test controls or one-time persisted-state migration support.

## Acceptance thresholds

Downstream cleanup and any later projection candidate must preserve these deterministic properties:

1. Inside a projection, an accepted equal value emits zero updates, zero delivered value bytes, and zero projection-caused component commits.
2. A drained burst performs at most one dependency selection and one derivation per affected projection and emits at most one projection update; if the final value equals the cache, it emits none.
3. A matched compatible-pair equal frame must not add sends, wire bytes, or component commits beyond the historical control.
4. A representative matched-pair single change and bounded producer burst must use no more logical sends, deliveries, wire bytes, or measured component commits than the equivalent historical control.
5. Reconnect produces exactly one snapshot per accepted key and no duplicate update for the same revision; adding projection convergence must not add a consumer commit after equivalent state is present.
6. Additional browsers must not increase source selection or derivation work. Deliveries, wire bytes, and frontend work may scale only linearly by client.
7. A one-session visual change must not rerender unrelated visible session rows.
8. Invalidation with no subscriber should do no feature projection derivation unless it explicitly warms an imminent requested snapshot.
9. Confirmed compatibility-only fields may be removed for compatible builds, but detailed board, notification, history, routing, and command authorities remain unless independently replaced.
10. Wall-clock results remain report-only until the project has a repeatable environment and observed variance band. Deterministic counts, bytes, and renders own the current pass/fail decision.

## Overall verdict

**Session navigation, session attention, and leader-thread tabs now satisfy their feature-local equal-or-better gates.** Session navigation emits no parallel status activity, uses a smaller one-field patch, coalesces bursts, adds no reconnect commit, rerenders only the changed row, and finishes 6 non-test lines below its baseline. Session attention removes raw and locally reconstructed visual delivery, keeps required notification and permission authorities separate, coalesces projection work, adds no unrelated-row or reconnect commit, and reduces every measured changed wire scenario. Leader tabs remove duplicate global activity and status delivery, coalesce projection bursts, match or improve representative commit counts, preserve the detailed board separately, and finish 173 non-test lines below their baseline.

The remaining program work is the other separately owned compatibility cleanup plus final whole-application acceptance. Those later checks must preserve the thresholds above and confirm that no obsolete cross-feature path remains; they do not reopen the completed feature-local migrations unless new evidence finds a regression.
