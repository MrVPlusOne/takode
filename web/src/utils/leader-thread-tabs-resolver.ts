import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import {
  activePhaseDotKeys,
  type LeaderActivePhaseSummaryRow,
  type LeaderActivePhaseSummarySegment,
} from "../../shared/leader-active-phase-summary.js";
import {
  LEADER_OPEN_THREAD_TABS_VERSION,
  type LeaderOpenThreadTabsState,
} from "../../shared/leader-open-thread-tabs.js";
import type { AppState } from "../store-types.js";
import { getSyncedProjectionValue, hasSyncedProjectionValue } from "../store-synced-projections.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { resolveSessionNavigation, type SessionNavigationResolverSource } from "./session-navigation-resolver.js";
import { normalizeThreadKey } from "./thread-projection.js";

export interface LeaderThreadTabsProjectionSource {
  syncedProjectionValues?: Map<string, unknown>;
  syncedProjectionKeys?: Set<string>;
}

const EMPTY_THREAD_STATUSES: Readonly<Record<string, LeaderThreadStatus>> = {};
const EMPTY_ACTIVE_PHASE_SUMMARY: LeaderActivePhaseSummarySegment[] = [];

export type ResolvedLeaderThreadTabsProjection =
  | { projectionState: "accepted"; value: LeaderThreadTabsProjectionValue }
  | { projectionState: "unavailable"; value: null };

const EMPTY_AUTHORITATIVE_TAB_STATE: LeaderOpenThreadTabsState = {
  version: LEADER_OPEN_THREAD_TABS_VERSION,
  orderedOpenThreadKeys: [],
  closedThreadTombstones: [],
  updatedAt: 0,
};
const projectedOpenTabStateCache = new WeakMap<LeaderThreadTabsProjectionValue, LeaderOpenThreadTabsState>();

function projectionCacheState(source: LeaderThreadTabsProjectionSource) {
  return source as Pick<AppState, "syncedProjectionValues" | "syncedProjectionKeys">;
}

/** Resolve current-build synchronized leader-tab authority without a runtime legacy visual fallback. */
export function resolveLeaderThreadTabsProjection(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): ResolvedLeaderThreadTabsProjection {
  const cacheState = projectionCacheState(source);
  if (hasSyncedProjectionValue(cacheState, LEADER_THREAD_TABS_PROJECTION, sessionId)) {
    const value = getSyncedProjectionValue(cacheState, LEADER_THREAD_TABS_PROJECTION, sessionId);
    if (value?.currentQuestStateVersion === 1) return { projectionState: "accepted", value };
  }
  return { projectionState: "unavailable", value: null };
}

/** Null accepted tab state permits the one-time persisted browser-state migration only. */
export function projectedLeaderOpenThreadTabs(
  resolution: ResolvedLeaderThreadTabsProjection,
): LeaderOpenThreadTabsState | undefined {
  if (resolution.projectionState !== "accepted") return EMPTY_AUTHORITATIVE_TAB_STATE;
  if (!resolution.value.tabState) return undefined;
  const cached = projectedOpenTabStateCache.get(resolution.value);
  if (cached) return cached;
  const state: LeaderOpenThreadTabsState = {
    version: LEADER_OPEN_THREAD_TABS_VERSION,
    orderedOpenThreadKeys: resolution.value.tabs.map((tab) => tab.threadKey),
    closedThreadTombstones: [],
    updatedAt: 0,
  };
  projectedOpenTabStateCache.set(resolution.value, state);
  return state;
}

export function selectLeaderThreadStatuses(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): Readonly<Record<string, LeaderThreadStatus>> {
  const resolution = resolveLeaderThreadTabsProjection(source, sessionId);
  return resolution.projectionState === "accepted" ? resolution.value.threadStatuses : EMPTY_THREAD_STATUSES;
}

export function selectLeaderActivePhaseSummary(
  source: LeaderThreadTabsProjectionSource,
  sessionId: string,
): LeaderActivePhaseSummarySegment[] {
  const resolution = resolveLeaderThreadTabsProjection(source, sessionId);
  return resolution.projectionState === "accepted" ? resolution.value.activePhaseSummary : EMPTY_ACTIVE_PHASE_SUMMARY;
}

/**
 * The phase dots of a leader's Overview button, `questId:phaseId` joined by commas. They come with
 * the projection, so a quest changing phase redraws the leader's navigation once, with its tabs;
 * the board detail gives them only until a projection carries them.
 */
export function selectLeaderPhaseDotsKey(
  source: LeaderThreadTabsProjectionSource & {
    sessionBoards?: Map<string, readonly LeaderActivePhaseSummaryRow[]>;
  },
  sessionId: string,
): string {
  const resolution = resolveLeaderThreadTabsProjection(source, sessionId);
  const projected = resolution.projectionState === "accepted" ? resolution.value.activePhaseDots : undefined;
  return (projected ?? activePhaseDotKeys(source.sessionBoards?.get(sessionId) ?? [])).join(",");
}

/** Whether a session shows the leader's work board and thread tab row. */
export function resolveWorkBoardIsOrchestrator(
  source: LeaderThreadTabsProjectionSource & SessionNavigationResolverSource,
  sessionId: string,
): boolean {
  return (
    resolveLeaderThreadTabsProjection(source, sessionId).projectionState === "accepted" ||
    resolveSessionNavigation(source, sessionId)?.viewModel.isOrchestrator === true
  );
}

/**
 * Whether one of a leader's threads is running, by the rule the status groups use: a quest whose
 * work is running (the board's `runningQuestIds`), or the thread the leader is writing in now.
 */
export function isLeaderThreadRunning(
  state: Pick<AppState, "syncedProjectionValues" | "syncedProjectionKeys" | "sessionStatus" | "activeTurnRoutes">,
  leaderId: string,
  threadKey: string,
): boolean {
  const key = normalizeThreadKey(threadKey);
  const writing = state.sessionStatus.get(leaderId) === "running" ? state.activeTurnRoutes.get(leaderId) : null;
  if (writing?.threadKey && normalizeThreadKey(writing.threadKey) === key) return true;
  const running = resolveLeaderThreadTabsProjection(state, leaderId).value?.runningQuestIds ?? [];
  return running.some((questId) => normalizeThreadKey(questId) === key);
}
