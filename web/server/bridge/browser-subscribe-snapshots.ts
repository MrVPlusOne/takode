import type { BoardRow, BrowserIncomingMessage, SessionAttentionRecord } from "../session-types.js";
import { snapshotPartHash, type KnownSnapshotParts } from "../../shared/snapshot-part-hash.js";
import { browserBoardRows } from "./browser-board-rows.js";
import { buildBackendStateSnapshot } from "./backend-state-snapshot.js";
import { codexReasoningSnapshotFields } from "./codex-reasoning-preview-state.js";
import { getSessionDraftsSnapshot, type DraftSession } from "./session-drafts-controller.js";
import {
  getNotificationStatusSnapshot,
  getUserVisibleSessionNotifications,
} from "./session-notification-controller.js";
import { getCodexAutoPauseRecoveryProgress } from "../codex-result-error-auto-pause.js";
import { attentionRecordFields, notificationListFields } from "./feed-attention-lists.js";
import { treeGroupUpdates } from "./tree-group-updates.js";
import {
  deriveActiveTurnRoute,
  deriveSessionStatus,
  sendToBrowser,
  type BrowserTransportDeps,
  type BrowserTransportSessionLike,
  type BrowserTransportSocketLike,
  type BrowserTransportTreeGroupState,
} from "./browser-transport-controller.js";

/** What a subscribing socket already received or holds, for leaving it out of later subscribe snapshots. */
export interface SubscribeSnapshotSocketData {
  /** Hashes of the large snapshot parts the browser named in its subscribe as already held. */
  knownSnapshotParts?: KnownSnapshotParts;
  /** This subscribe already sent the feed attention snapshot, so the state snapshot need not repeat it. */
  feedAttentionSent?: boolean;
  initialTreeGroupState?: Promise<BrowserTransportTreeGroupState | null>;
}

function socketData(ws: BrowserTransportSocketLike): SubscribeSnapshotSocketData {
  return (ws.data ??= {}) as SubscribeSnapshotSocketData;
}

/** Notifications and attention records go ahead of the conversation window: the
 *  feed places chips and rows from them, so arriving after it (the state snapshot
 *  comes last) they would push the first rendered messages around. */
export function sendFeedAttentionSnapshot(session: BrowserTransportSessionLike, ws: BrowserTransportSocketLike): void {
  sendToBrowser(ws, {
    type: "feed_attention_snapshot",
    ...feedAttentionLists(session, socketData(ws).knownSnapshotParts),
    ...getNotificationStatusSnapshot(session),
  } as BrowserIncomingMessage);
  socketData(ws).feedAttentionSent = true;
}

/** The notification list and attention records, each left out or sent as changes when the browser holds a recent copy. */
function feedAttentionLists(session: BrowserTransportSessionLike, known: KnownSnapshotParts | undefined) {
  return {
    ...notificationListFields(session, getUserVisibleSessionNotifications(session), known?.notifications),
    ...attentionRecordFields(
      session,
      (session.attentionRecords ?? []) as SessionAttentionRecord[],
      known?.attention_records,
    ),
  };
}

/**
 * The session's authoritative state, last in the subscribe. Parts the browser
 * already holds are left out: the completed work board when the browser's copy
 * hashes the same (the browser then keeps its copy), and the notifications and
 * attention records when this subscribe already sent them in the feed
 * attention snapshot (later changes reach the subscribed socket live).
 */
export function sendStateSnapshot(
  session: BrowserTransportSessionLike,
  ws: BrowserTransportSocketLike,
  deps: BrowserTransportDeps,
): void {
  const data = socketData(ws);
  const known = data.knownSnapshotParts;
  const feedAttentionSent = data.feedAttentionSent === true;
  delete data.knownSnapshotParts;
  delete data.feedAttentionSent;
  const board = deps.getBoard(session.id) as BoardRow[];
  const completedBoard = deps.getCompletedBoard(session.id) as BoardRow[];
  const browserCompletedBoard = browserBoardRows(completedBoard);
  const completedBoardHeld =
    !!known?.completed_board && known.completed_board === snapshotPartHash(browserCompletedBoard);
  const notificationStatus = getNotificationStatusSnapshot(session);
  sendToBrowser(ws, {
    type: "state_snapshot",
    sessionStatus: deriveSessionStatus(session, deps),
    permissionMode: session.state.permissionMode,
    ...buildBackendStateSnapshot(session, deps),
    uiMode: session.state.uiMode ?? null,
    askPermission: session.state.askPermission ?? true,
    generationStartedAt: session.generationStartedAt ?? null,
    activeTurnRoute: deriveActiveTurnRoute(session),
    ...codexReasoningSnapshotFields(session),
    codexAutoPauseRecoveryProgress: getCodexAutoPauseRecoveryProgress(session),
    board: browserBoardRows(board),
    ...(completedBoardHeld ? {} : { completedBoard: browserCompletedBoard }),
    rowSessionStatuses: deps.getBoardRowSessionStatuses(session.id, board, completedBoard),
    ...(feedAttentionSent ? {} : feedAttentionLists(session, known)),
    drafts: getSessionDraftsSnapshot(session as DraftSession),
    notificationUrgency: notificationStatus.notificationUrgency,
    activeNotificationCount: notificationStatus.activeNotificationCount,
    activeNeedsInputNotificationCount: notificationStatus.activeNeedsInputNotificationCount,
    activeReviewNotificationCount: notificationStatus.activeReviewNotificationCount,
    mutedNeedsInputNotificationCount: notificationStatus.mutedNeedsInputNotificationCount,
    notificationStatusVersion: notificationStatus.notificationStatusVersion,
    notificationStatusUpdatedAt: notificationStatus.notificationStatusUpdatedAt,
  } as BrowserIncomingMessage);
}

/**
 * The session tree groups, prepared when the socket opened; left out when the
 * browser's copy hashes the same, and sent as changed assignments when it holds a recent copy.
 */
export async function sendInitialTreeGroupState(ws: BrowserTransportSocketLike): Promise<void> {
  const data = socketData(ws);
  const pending = data.initialTreeGroupState;
  // Read before waiting: the state snapshot clears the subscribe's held parts.
  const held = data.knownSnapshotParts?.tree_groups;
  delete data.initialTreeGroupState;
  if (!pending) return;
  try {
    const treeGroups = await pending;
    if (!treeGroups) return;
    const update = treeGroupUpdates.forBrowser(treeGroups, held);
    if (update) sendToBrowser(ws, update);
  } catch {
    // Preparation already records the failure; socket cleanup is handled elsewhere.
  }
}

/**
 * Sends a list again to a browser whose copy did not match an update it
 * received (`list_resync`): as changes from the copy it holds when that copy
 * is recent, otherwise whole.
 */
export async function answerListResync(
  session: BrowserTransportSessionLike,
  ws: BrowserTransportSocketLike,
  list: "notifications" | "attention_records" | "tree_groups",
  held: string,
  deps: Pick<BrowserTransportDeps, "getTreeGroupState">,
): Promise<void> {
  if (list === "notifications") {
    sendToBrowser(ws, {
      type: "notification_update",
      ...notificationListFields(session, getUserVisibleSessionNotifications(session), held),
      ...getNotificationStatusSnapshot(session),
    } as BrowserIncomingMessage);
    return;
  }
  if (list === "attention_records") {
    sendToBrowser(ws, {
      type: "attention_records_update",
      ...attentionRecordFields(session, (session.attentionRecords ?? []) as SessionAttentionRecord[], held),
    } as BrowserIncomingMessage);
    return;
  }
  const update = treeGroupUpdates.forBrowser(await deps.getTreeGroupState(), held);
  if (update) sendToBrowser(ws, update);
}
