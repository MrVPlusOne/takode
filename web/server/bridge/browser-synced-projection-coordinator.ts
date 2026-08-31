import {
  applyLeaderThreadTabUpdate,
  normalizeLeaderOpenThreadTabsState,
} from "../../shared/leader-open-thread-tabs.js";
import type { LeaderThreadTabMutationPolicy } from "../../shared/leader-thread-tab-priority.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage, SessionState } from "../session-types.js";

export type SyncedProjectionSubscriptions = Extract<
  BrowserOutgoingMessage,
  { type: "synced_projection_subscribe" }
>["subscriptions"];

type LeaderThreadTabsOperation = Extract<BrowserOutgoingMessage, { type: "leader_thread_tabs_update" }>["operation"];

export interface SyncedProjectionSocketData {
  syncedProjectionReplacementVersion?: number;
  pendingSearchDataProjectionReplacement?: { version: number; subscriptions: SyncedProjectionSubscriptions };
}

interface SyncedProjectionSocketLike {
  data?: unknown;
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

function replaceSyncedProjectionSubscriptions<
  TSession extends SyncedProjectionSessionLike,
  TSocket extends SyncedProjectionSocketLike,
>(
  session: TSession,
  socket: TSocket,
  subscriptions: SyncedProjectionSubscriptions,
  deps: SyncedProjectionTransportDeps<TSession, TSocket>,
  sendToBrowser: SendToBrowser<TSocket>,
): void {
  const data = (socket.data ??= {}) as SyncedProjectionSocketData;
  const version = (data.syncedProjectionReplacementVersion ?? 0) + 1;
  data.syncedProjectionReplacementVersion = version;
  for (const snapshot of deps.replaceSyncedProjectionSubscriptions?.(socket, subscriptions) ?? []) {
    if (sendToBrowser(socket, snapshot)) continue;
    deps.removeSyncedProjectionSubscriber?.(socket);
    break;
  }
  if (session.searchDataOnly && subscriptions.some((subscription) => subscription.key === session.id)) {
    data.pendingSearchDataProjectionReplacement = { version, subscriptions };
  }
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
    if (socket) replaceSyncedProjectionSubscriptions(session, socket, message.subscriptions, deps, sendToBrowser);
    return true;
  }
  if (message.type !== "synced_projection_resync") return false;
  if (!socket) return true;
  const snapshot = deps.resyncSyncedProjection?.(socket, message.projection, message.key);
  if (snapshot && !sendToBrowser(socket, snapshot)) deps.removeSyncedProjectionSubscriber?.(socket);
  return true;
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
) {
  const replacedBeforeLazyLoad = session.searchDataOnly === true;
  if (replacedBeforeLazyLoad && subscriptions) {
    replaceSyncedProjectionSubscriptions(session, socket, subscriptions, deps, sendToBrowser);
  }
  const lazyLoad = session.searchDataOnly ? deps.lazyLoadFullHistory?.(session) : undefined;
  return { replacedBeforeLazyLoad, ...(lazyLoad ? { lazyLoad } : {}) };
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
  // Search-only self-subscriptions are rejected before lazy load. Retry only
  // the latest replacement once the session becomes active.
  const data = (socket.data ??= {}) as SyncedProjectionSocketData;
  const pending = data.pendingSearchDataProjectionReplacement;
  const canRetry =
    !archivedReadOnly &&
    session.searchDataOnly !== true &&
    pending !== undefined &&
    pending.version === data.syncedProjectionReplacementVersion;
  const retry = canRetry ? pending?.subscriptions : !replacedBeforeLazyLoad ? subscriptions : undefined;
  if (session.searchDataOnly !== true) delete data.pendingSearchDataProjectionReplacement;
  if (retry) replaceSyncedProjectionSubscriptions(session, socket, retry, deps, sendToBrowser);
}

interface LeaderThreadTabsCommandSessionLike {
  id: string;
  state: Pick<SessionState, "leaderOpenThreadTabs">;
}

interface LeaderThreadTabsCommandDeps<TSession extends LeaderThreadTabsCommandSessionLike> {
  getLeaderThreadTabMutationPolicy?: (sessionId: string, threadKey: string) => LeaderThreadTabMutationPolicy | null;
  persistSession: (session: TSession) => void;
}

export function handleLeaderThreadTabsUpdate<TSession extends LeaderThreadTabsCommandSessionLike>(
  session: TSession,
  operation: LeaderThreadTabsOperation,
  deps: LeaderThreadTabsCommandDeps<TSession>,
): void {
  const existingState = normalizeLeaderOpenThreadTabsState(session.state.leaderOpenThreadTabs);
  if (
    (operation.type === "migrate" && existingState) ||
    (operation.type === "open" && (operation as { source?: unknown }).source === "server_candidate") ||
    (operation.type === "close" &&
      deps.getLeaderThreadTabMutationPolicy?.(session.id, operation.threadKey)?.canClose === false)
  ) {
    return;
  }
  const nextState = applyLeaderThreadTabUpdate(existingState, operation);
  if (nextState === existingState) return;
  session.state.leaderOpenThreadTabs = nextState;
  deps.persistSession(session);
}

export function isObsoleteLeaderThreadTabOperation(operation: LeaderThreadTabsOperation | { type?: unknown }): boolean {
  return (
    !operation ||
    typeof operation !== "object" ||
    !["migrate", "open", "close", "reorder"].includes(String(operation.type))
  );
}
