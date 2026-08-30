import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import type { LeaderActivePhaseSummarySegment } from "../../shared/leader-active-phase-summary.js";
import {
  LEADER_OPEN_THREAD_TABS_VERSION,
  type LeaderOpenThreadTabsState,
} from "../../shared/leader-open-thread-tabs.js";
import type { AppState } from "../store-types.js";
import { getSyncedProjectionValue, hasSyncedProjectionValue } from "../store-synced-projections.js";
import type { SdkSessionInfo } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { SessionState } from "../types.js";

export interface LeaderThreadTabsProjectionSource {
  sessions?: Map<string, SessionState>;
  sdkSessions?: SdkSessionInfo[];
  syncedProjectionValues?: Map<string, unknown>;
  syncedProjectionKeys?: Set<string>;
}

const EMPTY_THREAD_STATUSES: Readonly<Record<string, LeaderThreadStatus>> = {};
const EMPTY_ACTIVE_PHASE_SUMMARY: LeaderActivePhaseSummarySegment[] = [];

export type ResolvedLeaderThreadTabsProjection =
  | { projectionState: "accepted"; value: LeaderThreadTabsProjectionValue }
  | { projectionState: "invalid-supplied"; value: null }
  | { projectionState: "legacy"; value: null };

const EMPTY_AUTHORITATIVE_TAB_STATE: LeaderOpenThreadTabsState = {
  version: LEADER_OPEN_THREAD_TABS_VERSION,
  orderedOpenThreadKeys: [],
  closedThreadTombstones: [],
  updatedAt: 0,
};

function projectionCacheState(source: LeaderThreadTabsProjectionSource) {
  return source as Pick<AppState, "syncedProjectionValues" | "syncedProjectionKeys">;
}

function hasSuppliedProjectionEnvelope(session: SdkSessionInfo | undefined): boolean {
  return !!session && Object.prototype.hasOwnProperty.call(session, "leaderThreadTabsProjection");
}

/** Resolve synchronized leader-tab authority without falling through malformed supplied envelopes. */
export function resolveLeaderThreadTabsProjection(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): ResolvedLeaderThreadTabsProjection {
  const cacheState = projectionCacheState(source);
  if (hasSyncedProjectionValue(cacheState, LEADER_THREAD_TABS_PROJECTION, sessionId)) {
    const value = getSyncedProjectionValue(cacheState, LEADER_THREAD_TABS_PROJECTION, sessionId);
    if (value) return { projectionState: "accepted", value };
  }

  const sdkSession = source.sdkSessions?.find((session) => session.sessionId === sessionId);
  if (hasSuppliedProjectionEnvelope(sdkSession)) return { projectionState: "invalid-supplied", value: null };
  return { projectionState: "legacy", value: null };
}

export function hasLeaderThreadTabsVisualAuthority(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): boolean {
  return resolveLeaderThreadTabsProjection(source, sessionId).projectionState !== "legacy";
}

export function stripLegacyLeaderThreadTabsState<T extends Partial<SessionState>>(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
  value: T,
): T {
  if (!hasLeaderThreadTabsVisualAuthority(source, sessionId)) return value;
  const { leaderOpenThreadTabs: _leaderOpenThreadTabs, leaderThreadStatuses: _leaderThreadStatuses, ...rest } = value;
  return rest as T;
}

/** Missing accepted tab state permits one-time local migration; malformed envelopes still fail closed. */
export function projectedLeaderOpenThreadTabs(
  resolution: ResolvedLeaderThreadTabsProjection,
): LeaderOpenThreadTabsState | undefined {
  if (resolution.projectionState === "legacy") return undefined;
  if (resolution.projectionState === "invalid-supplied") return EMPTY_AUTHORITATIVE_TAB_STATE;
  return resolution.value.tabState ?? undefined;
}

export function projectedLeaderOpenThreadTabsFromState(
  projectionState: ResolvedLeaderThreadTabsProjection["projectionState"],
  value: LeaderThreadTabsProjectionValue | null,
): LeaderOpenThreadTabsState | undefined {
  if (projectionState === "legacy") return undefined;
  if (projectionState === "invalid-supplied") return EMPTY_AUTHORITATIVE_TAB_STATE;
  return value?.tabState ?? undefined;
}

export function selectLeaderThreadStatuses(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): Readonly<Record<string, LeaderThreadStatus>> | undefined {
  const resolution = resolveLeaderThreadTabsProjection(source, sessionId);
  if (resolution.projectionState === "accepted") return resolution.value.threadStatuses;
  if (resolution.projectionState === "invalid-supplied") return EMPTY_THREAD_STATUSES;
  return source.sessions?.get(sessionId)?.leaderThreadStatuses;
}

export function selectLeaderActivePhaseSummary(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): LeaderActivePhaseSummarySegment[] | undefined {
  const resolution = resolveLeaderThreadTabsProjection(source, sessionId);
  if (resolution.projectionState === "accepted") return resolution.value.activePhaseSummary;
  if (resolution.projectionState === "invalid-supplied") return EMPTY_ACTIVE_PHASE_SUMMARY;
  return source.sdkSessions?.find((session) => session.sessionId === sessionId)?.leaderActivePhaseSummary;
}
