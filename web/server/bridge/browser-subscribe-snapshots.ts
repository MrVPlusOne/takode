import type { BoardRow, BrowserIncomingMessage } from "../session-types.js";
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
    notifications: getUserVisibleSessionNotifications(session),
    attentionRecords: session.attentionRecords ?? [],
    ...getNotificationStatusSnapshot(session),
  } as BrowserIncomingMessage);
  socketData(ws).feedAttentionSent = true;
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
    ...(feedAttentionSent
      ? {}
      : {
          notifications: getUserVisibleSessionNotifications(session),
          attentionRecords: session.attentionRecords ?? [],
        }),
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

/** The session tree groups, prepared when the socket opened; left out when the browser's copy hashes the same. */
export async function sendInitialTreeGroupState(ws: BrowserTransportSocketLike): Promise<void> {
  const data = socketData(ws);
  const pending = data.initialTreeGroupState;
  delete data.initialTreeGroupState;
  if (!pending) return;
  try {
    const treeGroups = await pending;
    if (!treeGroups) return;
    const part = {
      groups: treeGroups.groups,
      assignments: treeGroups.assignments,
      nodeOrder: treeGroups.nodeOrder ?? {},
    };
    const held = data.knownSnapshotParts?.tree_groups;
    if (held && held === snapshotPartHash(part)) return;
    sendToBrowser(ws, {
      type: "tree_groups_update",
      treeGroups: part.groups,
      treeAssignments: part.assignments,
      treeNodeOrder: part.nodeOrder,
    } as BrowserIncomingMessage);
  } catch {
    // Preparation already records the failure; socket cleanup is handled elsewhere.
  }
}
