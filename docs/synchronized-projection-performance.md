# Synchronized Projection Performance Baseline

Measured on August 30, 2026 against synchronized runtime target `b54821520f863c00af50d38db93edce439d048a3`.

This document fixes the comparison boundary for the session-navigation and leader-thread-tab projection migrations. It compares equivalent bounded feature work, not whole-server behavior or unrelated commits.

## Supported runtime boundary

The supported target is a frontend and backend from the same compatible build. Current cases always use accepted synchronized projections.

Missing, malformed, or older projection envelopes are historical controls only. Mixed-version fallback is not required product behavior and is not a performance acceptance case. Build-mismatch detection and the resulting Reload flow are owned separately. Confirmed compatibility-only work that still executes for a compatible pair is measured as removable overhead; parallel detail or activity authorities are kept distinct.

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

## Server results

### Equivalent control versus matched-pair event work

Counts below use two browsers. “Assembly” is one full control/parallel payload assembly or one projection dependency/value assembly.

| Family and scenario | Historical assemblies / sends / deliveries | Matched-pair assemblies / sends / deliveries | Historical bytes per browser | Matched bytes per browser | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Navigation equal producer frame | 1 / 1 / 2 | 2 / 1 / 2 | 412 | 366 | Same sends; smaller retained frame, projected value suppressed |
| Navigation one status change | 1 / 1 / 2 | 2 / 2 / 4 | 412 | 2,055 | Worse: 4.99× bytes and one extra send |
| Navigation 25-frame burst | 25 / 25 / 50 | 26 / 26 / 52 | 10,300 | 10,839 | Worse: 5.2% more bytes and one extra send |
| Leader equal board producer | 2 / 2 / 4 | 3 / 2 / 4 | 6,934 | 6,934 | Same wire; projected value suppressed |
| Leader Work → Memory producer | 2 / 2 / 4 | 3 / 3 / 6 | 7,102 | 14,852 | Worse: 2.09× bytes and one extra send |
| Leader 25-frame phase burst | 50 / 50 / 100 | 51 / 51 / 102 | 177,550 | 185,300 | Worse: 4.4% more bytes and one extra send |

Each leader board producer includes the companion global activity message followed by `board_updated`. The control and current pair are modeled with established leader navigation and attention subscriptions, so the activity message uses its subscribed residual shape.

The projection runtime itself coalesces effectively: one or 25 navigation status frames settle as one batch, one selection, one derivation, and one projection publication; leader phase invalidations behave the same. That internal saving does not make the matched pair cheaper while retained activity plus board/detail payloads still arrive for every producer frame.

Both feature definitions build their complete value during dependency selection and use identity derivation. `dependencyEqualSuppressions` therefore records the effective no-op path and `equalValueSuppressions` remains zero.

### Narrow updates, subscriptions, and no-subscriber work

| Measurement | Historical or parallel payload | Projection contribution | Matched/current result |
| --- | ---: | ---: | ---: |
| Navigation one status change, per browser | 366 B retained activity/notification fields | 1,689 B | 2,055 B total |
| Leader narrow thread-status update, per browser | 236 B confirmed projection-owned compatibility | 7,659 B | 7,659 B compatible target; 7,895 B currently shipped |
| Leader Work → Memory producer, per browser | 3,317 B subscribed activity residual + 3,785 B board/detail payload | 7,750 B | 14,852 B total |

Initial subscription for two browsers performs two dependency selections, one initial derivation, two accepted subscriptions, and two snapshots. The projection snapshot-plus-ack response is 1,819 B per browser for navigation and 7,799 B for leader tabs. The normal `state_snapshot` follows and is not included in those incremental totals. Historical navigation has no navigation-projection subscription work; the leader control already assumes the shared navigation and attention subscriptions but has no leader-tabs subscription.

A cold navigation invalidation with no subscribers still selects, derives, and caches a 1,506 B value. Targeted cross-leader quest invalidation correctly skips leader-tab work without a subscriber, but generic session persistence still derives and caches a 7,490 B leader-tab value without a viewer. Reconnect snapshots also rebuild dependencies before equality suppresses derivation.

## Frontend results

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

**Current performance is mixed and does not satisfy the equal-or-better acceptance gate.** Projection-local batching, dependency equality, and linear fanout work: equal projected values do not publish, 25 invalidations collapse to one projected update, and subscriber count does not multiply server derivation.

Those internal gains are outweighed at the matched-pair boundary. Navigation single-change wire is 4.99× the control, its 25-frame burst is 5.2% larger, and both single and burst add a full-list React commit. Leader Work → Memory wire is 2.09× the full historical producer sequence and its 25-frame burst is 4.4% larger. Leader phase changes and reconnect add a commit; the full three-frame leader burst merely breaks even on commits while doing fewer store writes. Both reconnect paths add one commit, session navigation still rerenders unrelated rows, generic invalidation can derive without subscribers, and snapshots reselect whole values.

Before another UI family uses this pattern, cleanup should split or delta-encode hot leader-tab facets, remove confirmed projection-owned compatibility fields without deleting detailed board authority, batch or reconcile parallel detail-plus-visual deliveries, isolate session-row selectors, and demand-gate generic invalidation. The repaired authority model remains valuable, but these measurements do not support treating the current implementation as a minimal or performance-proven template.
