import {
  applyLeaderServerCandidateThreadTabEvent,
  applyLeaderThreadTabUpdate,
  LEADER_OPEN_THREAD_TABS_VERSION,
  MAX_LEADER_OPEN_THREAD_TABS,
  normalizeLeaderOpenThreadTabsState,
} from "../../shared/leader-open-thread-tabs.js";
import type { LeaderThreadTabsProjectionValue } from "../../shared/leader-thread-tabs-projection.js";
import {
  isScheduledLeaderThreadTabStatus,
  type LeaderThreadTabMutationPolicy,
} from "../../shared/leader-thread-tab-priority.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage, SessionState } from "../session-types.js";

export type SyncedProjectionSubscriptions = Extract<
  BrowserOutgoingMessage,
  { type: "synced_projection_subscribe" }
>["subscriptions"];

type LeaderThreadTabsOperation = Extract<BrowserOutgoingMessage, { type: "leader_thread_tabs_update" }>["operation"];

export interface SyncedProjectionSocketData {
  syncedProjectionReplacementVersion?: number;
  pendingSearchDataProjectionReplacement?: {
    version: number;
    subscriptions: SyncedProjectionSubscriptions;
  };
}

interface SyncedProjectionSocketLike {
  data?: unknown;
  send(data: string): unknown;
}

interface SyncedProjectionSessionLike {
  id: string;
  searchDataOnly?: boolean;
}

interface SyncedProjectionTransportDeps<
  TSession extends SyncedProjectionSessionLike,
  TSocket extends SyncedProjectionSocketLike,
> {
  lazyLoadFullHistory?: (session: TSession) => Promise<void>;
  replaceSyncedProjectionSubscriptions?: (
    socket: TSocket,
    subscriptions: SyncedProjectionSubscriptions,
  ) => BrowserIncomingMessage[];
  resyncSyncedProjection?: (socket: TSocket, projection: string, key: string) => BrowserIncomingMessage | null;
  removeSyncedProjectionSubscriber?: (socket: TSocket) => void;
}

type SendToBrowser<TSocket extends SyncedProjectionSocketLike> = (
  socket: TSocket,
  message: BrowserIncomingMessage,
) => boolean;

function sendSyncedProjectionReplacement<
  TSession extends SyncedProjectionSessionLike,
  TSocket extends SyncedProjectionSocketLike,
>(
  socket: TSocket,
  subscriptions: SyncedProjectionSubscriptions,
  deps: SyncedProjectionTransportDeps<TSession, TSocket>,
  sendToBrowser: SendToBrowser<TSocket>,
): number {
  const data = (socket.data ??= {}) as SyncedProjectionSocketData;
  const replacementVersion = (data.syncedProjectionReplacementVersion ?? 0) + 1;
  data.syncedProjectionReplacementVersion = replacementVersion;
  for (const snapshot of deps.replaceSyncedProjectionSubscriptions?.(socket, subscriptions) ?? []) {
    if (sendToBrowser(socket, snapshot)) continue;
    deps.removeSyncedProjectionSubscriber?.(socket);
    break;
  }
  return replacementVersion;
}

function retainPendingSearchDataSelfSubscription(
  session: SyncedProjectionSessionLike,
  socket: SyncedProjectionSocketLike,
  subscriptions: SyncedProjectionSubscriptions,
  replacementVersion: number,
): void {
  if (!session.searchDataOnly || !subscriptions.some((subscription) => subscription.key === session.id)) return;
  const data = (socket.data ??= {}) as SyncedProjectionSocketData;
  data.pendingSearchDataProjectionReplacement = {
    version: replacementVersion,
    subscriptions,
  };
}

export function handleSyncedProjectionProtocolMessage<
  TSession extends SyncedProjectionSessionLike,
  TSocket extends SyncedProjectionSocketLike,
>(
  session: TSession,
  message: BrowserOutgoingMessage,
  socket: TSocket | undefined,
  deps: SyncedProjectionTransportDeps<TSession, TSocket>,
  sendToBrowser: SendToBrowser<TSocket>,
): boolean {
  if (message.type === "synced_projection_subscribe") {
    if (socket) {
      const replacementVersion = sendSyncedProjectionReplacement(socket, message.subscriptions, deps, sendToBrowser);
      retainPendingSearchDataSelfSubscription(session, socket, message.subscriptions, replacementVersion);
    }
    return true;
  }

  if (message.type !== "synced_projection_resync") return false;
  if (socket) {
    const snapshot = deps.resyncSyncedProjection?.(socket, message.projection, message.key);
    if (snapshot && !sendToBrowser(socket, snapshot)) deps.removeSyncedProjectionSubscriber?.(socket);
  }
  return true;
}

export interface SyncedProjectionSessionSubscribePreparation {
  replacedBeforeLazyLoad: boolean;
  lazyLoad?: Promise<void>;
}

export function prepareSyncedProjectionSessionSubscribe<
  TSession extends SyncedProjectionSessionLike,
  TSocket extends SyncedProjectionSocketLike,
>(
  session: TSession,
  socket: TSocket,
  subscriptions: SyncedProjectionSubscriptions | undefined,
  deps: SyncedProjectionTransportDeps<TSession, TSocket>,
  sendToBrowser: SendToBrowser<TSocket>,
): SyncedProjectionSessionSubscribePreparation {
  const replacedBeforeLazyLoad = session.searchDataOnly === true;
  if (replacedBeforeLazyLoad && subscriptions) {
    const replacementVersion = sendSyncedProjectionReplacement(socket, subscriptions, deps, sendToBrowser);
    retainPendingSearchDataSelfSubscription(session, socket, subscriptions, replacementVersion);
  }

  const lazyLoad = session.searchDataOnly ? deps.lazyLoadFullHistory?.(session) : undefined;
  return {
    replacedBeforeLazyLoad,
    ...(lazyLoad ? { lazyLoad } : {}),
  };
}

export function completeSyncedProjectionSessionSubscribe<
  TSession extends SyncedProjectionSessionLike,
  TSocket extends SyncedProjectionSocketLike,
>(
  session: TSession,
  socket: TSocket,
  subscriptions: SyncedProjectionSubscriptions | undefined,
  replacedBeforeLazyLoad: boolean,
  archivedReadOnly: boolean,
  deps: SyncedProjectionTransportDeps<TSession, TSocket>,
  sendToBrowser: SendToBrowser<TSocket>,
): void {
  // Install the replacement after synchronous reconnect cleanup but before
  // the first active-session history await. A restored self-subscription is
  // rejected while search-only, so retain the latest requested inventory
  // during lazy load and retry it unless a newer replacement overtook it.
  const data = (socket.data ??= {}) as SyncedProjectionSocketData;
  const pendingReplacement = data.pendingSearchDataProjectionReplacement;
  const retryAfterLazyLoad =
    !archivedReadOnly &&
    session.searchDataOnly !== true &&
    pendingReplacement !== undefined &&
    data.syncedProjectionReplacementVersion === pendingReplacement.version;
  if (retryAfterLazyLoad) {
    delete data.pendingSearchDataProjectionReplacement;
    sendSyncedProjectionReplacement(socket, pendingReplacement.subscriptions, deps, sendToBrowser);
    return;
  }

  if (session.searchDataOnly !== true) delete data.pendingSearchDataProjectionReplacement;
  if (!replacedBeforeLazyLoad && subscriptions) {
    sendSyncedProjectionReplacement(socket, subscriptions, deps, sendToBrowser);
  }
}

interface LeaderThreadTabsCommandSessionLike {
  id: string;
  state: Pick<SessionState, "leaderOpenThreadTabs">;
  board?: ReadonlyMap<string, { questId: string; status?: string }>;
}

interface LeaderThreadTabsCommandDeps<TSession extends LeaderThreadTabsCommandSessionLike> {
  getLeaderThreadTabsProjectionValue?: (sessionId: string) => LeaderThreadTabsProjectionValue | null;
  getLeaderThreadTabMutationPolicy?: (sessionId: string, threadKey: string) => LeaderThreadTabMutationPolicy | null;
  persistSession: (session: TSession) => void;
  broadcastToBrowsers: (session: TSession, message: BrowserIncomingMessage) => void;
}

function isScheduledLeaderThreadTabCommandTarget(
  session: LeaderThreadTabsCommandSessionLike,
  threadKey: string,
): boolean {
  const normalizedThreadKey = threadKey.trim().toLowerCase();
  for (const row of session.board?.values() ?? []) {
    if (row.questId.trim().toLowerCase() !== normalizedThreadKey) continue;
    return isScheduledLeaderThreadTabStatus(row.status);
  }
  return false;
}

function projectedLeaderThreadTabMutationPolicy(
  projection: LeaderThreadTabsProjectionValue | null,
  threadKey: string,
): LeaderThreadTabMutationPolicy | null {
  const normalizedThreadKey = threadKey.trim().toLowerCase();
  const tab = projection?.tabs.find((candidate) => candidate.threadKey === normalizedThreadKey);
  if (!tab) return null;
  const scheduled = tab.queued || tab.proposed;
  return {
    inMotion: tab.active,
    scheduled,
    neverStartedScheduled: tab.neverStartedScheduled ?? false,
    canClose: tab.canClose,
  };
}

export function handleLeaderThreadTabsUpdate<TSession extends LeaderThreadTabsCommandSessionLike>(
  session: TSession,
  operation: LeaderThreadTabsOperation,
  deps: LeaderThreadTabsCommandDeps<TSession>,
): void {
  const existingState = normalizeLeaderOpenThreadTabsState(session.state.leaderOpenThreadTabs);
  if (operation.type === "migrate" && existingState) return;
  const projection = deps.getLeaderThreadTabsProjectionValue?.(session.id) ?? null;
  const targetThreadKey = operation.type === "open" || operation.type === "close" ? operation.threadKey : null;
  const mutationPolicy = targetThreadKey
    ? (deps.getLeaderThreadTabMutationPolicy?.(session.id, targetThreadKey) ??
      projectedLeaderThreadTabMutationPolicy(projection, targetThreadKey))
    : null;
  // Closeability is server authority, not merely a hidden browser affordance.
  if (operation.type === "close" && mutationPolicy?.canClose === false) return;
  // Scheduled rows are already supplied by the server projection. Browser
  // attachment/transition candidates must not promote them or revive a close
  // tombstone; explicit user and route opens keep their normal authority.
  if (
    operation.type === "open" &&
    operation.source === "server_candidate" &&
    (mutationPolicy?.scheduled || isScheduledLeaderThreadTabCommandTarget(session, operation.threadKey))
  ) {
    return;
  }

  const projectedState =
    operation.type === "migrate" ? undefined : leaderThreadTabsCommandStateFromProjection(projection);
  const commandBaseState = mergeLeaderThreadTabsCommandBase(existingState, projectedState);
  if (
    operation.type === "open" &&
    operation.source === "server_candidate" &&
    !commandBaseState?.orderedOpenThreadKeys.includes(operation.threadKey.trim().toLowerCase()) &&
    (commandBaseState?.orderedOpenThreadKeys.length ?? 0) >= MAX_LEADER_OPEN_THREAD_TABS
  ) {
    return;
  }
  const nextState =
    operation.type === "open" &&
    operation.source === "server_candidate" &&
    typeof operation.eventAt === "number" &&
    Number.isFinite(operation.eventAt)
      ? applyLeaderServerCandidateThreadTabEvent(commandBaseState, operation.threadKey, operation.eventAt, {
          repositionExisting: true,
          placement: operation.placement === "last" ? "last" : "first",
        })
      : applyLeaderThreadTabUpdate(commandBaseState, operation);
  if (statesEqual(existingState, nextState)) return;

  session.state.leaderOpenThreadTabs = nextState;
  deps.persistSession(session);
  if (statesVisuallyEqual(existingState, nextState)) return;
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: { leaderOpenThreadTabs: nextState },
  });
}

export function isObsoleteLeaderThreadTabOperation(operation: LeaderThreadTabsOperation | { type?: unknown }): boolean {
  if (!operation || typeof operation !== "object") return true;
  return operation.type === "auto_close" || !["migrate", "open", "close", "reorder"].includes(String(operation.type));
}

function leaderThreadTabsCommandStateFromProjection(
  projection: LeaderThreadTabsProjectionValue | null,
): ReturnType<typeof normalizeLeaderOpenThreadTabsState> {
  if (!projection) return undefined;
  if (projection.tabState) return normalizeLeaderOpenThreadTabsState(projection.tabState);
  if (projection.tabs.length === 0) return undefined;
  return normalizeLeaderOpenThreadTabsState({
    version: LEADER_OPEN_THREAD_TABS_VERSION,
    orderedOpenThreadKeys: projection.tabs.map((tab) => tab.threadKey),
    closedThreadTombstones: [],
    updatedAt: Math.max(...projection.tabs.map((tab) => tab.updatedAt), 0),
  });
}

function mergeLeaderThreadTabsCommandBase(
  existingState: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
  projectedState: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
): ReturnType<typeof normalizeLeaderOpenThreadTabsState> {
  if (!projectedState) return existingState;
  if (!existingState) return projectedState;
  return normalizeLeaderOpenThreadTabsState({
    ...projectedState,
    closedThreadTombstones: [...existingState.closedThreadTombstones, ...projectedState.closedThreadTombstones],
    updatedAt: Math.max(existingState.updatedAt, projectedState.updatedAt),
    ...(existingState.migratedFromLocalStorageAt !== undefined
      ? { migratedFromLocalStorageAt: existingState.migratedFromLocalStorageAt }
      : {}),
    ...(existingState.explicitOrderUpdatedAt !== undefined
      ? { explicitOrderUpdatedAt: existingState.explicitOrderUpdatedAt }
      : {}),
    ...(existingState.latestServerCandidateEventAt !== undefined
      ? { latestServerCandidateEventAt: existingState.latestServerCandidateEventAt }
      : {}),
    ...(existingState.serverCandidatePromotedAt
      ? { serverCandidatePromotedAt: existingState.serverCandidatePromotedAt }
      : {}),
  });
}

function statesVisuallyEqual(
  left: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
  right: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.updatedAt === right.updatedAt &&
    left.migratedFromLocalStorageAt === right.migratedFromLocalStorageAt &&
    left.explicitOrderUpdatedAt === right.explicitOrderUpdatedAt &&
    arraysEqual(left.orderedOpenThreadKeys, right.orderedOpenThreadKeys) &&
    left.closedThreadTombstones.length === right.closedThreadTombstones.length &&
    left.closedThreadTombstones.every(
      (entry, index) =>
        entry.threadKey === right.closedThreadTombstones[index]?.threadKey &&
        entry.closedAt === right.closedThreadTombstones[index]?.closedAt,
    )
  );
}

function statesEqual(
  left: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
  right: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.updatedAt === right.updatedAt &&
    left.migratedFromLocalStorageAt === right.migratedFromLocalStorageAt &&
    left.explicitOrderUpdatedAt === right.explicitOrderUpdatedAt &&
    left.latestServerCandidateEventAt === right.latestServerCandidateEventAt &&
    numberRecordsEqual(left.serverCandidatePromotedAt, right.serverCandidatePromotedAt) &&
    arraysEqual(left.orderedOpenThreadKeys, right.orderedOpenThreadKeys) &&
    left.closedThreadTombstones.length === right.closedThreadTombstones.length &&
    left.closedThreadTombstones.every(
      (entry, index) =>
        entry.threadKey === right.closedThreadTombstones[index]?.threadKey &&
        entry.closedAt === right.closedThreadTombstones[index]?.closedAt,
    )
  );
}

function numberRecordsEqual(
  left: Readonly<Record<string, number>> | undefined,
  right: Readonly<Record<string, number>> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  return leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => right?.[key] === value);
}

function arraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
