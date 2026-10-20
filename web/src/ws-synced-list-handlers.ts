import type {
  BoardListFields,
  BoardRow,
  BoardRowSessionStatus,
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
} from "./types.js";
import { useStore } from "./store.js";
import { heldTreeGroupsHash } from "./utils/held-snapshot-parts.js";
import { receivedListHash, receiveSyncedList, type SyncedListKind } from "./utils/synced-lists.js";

type LeaderProjectionMessage = Extract<BrowserIncomingMessage, { type: "leader_projection_snapshot" }>;

interface SyncedListDeps {
  sendToSession: (sessionId: string, msg: BrowserOutgoingMessage) => boolean;
}

/** Asks the server for a list again after an update that builds on a list this browser does not hold. */
export function requestListResync(sessionId: string, list: SyncedListKind | "tree_groups", deps: SyncedListDeps): void {
  // The leader projection's lists are only sent with the projection, which is resent whole.
  if (list === "thread_summaries" || list === "message_attention_records") {
    deps.sendToSession(sessionId, {
      type: "list_resync",
      list: "leader_projection",
      held: "",
    });
    return;
  }
  deps.sendToSession(sessionId, {
    type: "list_resync",
    list,
    held: (list === "tree_groups" ? heldTreeGroupsHash() : receivedListHash(list, sessionId)) ?? "",
  });
}

/**
 * Applies the completed board and row statuses of a board update or state
 * snapshot: each whole, as changes from the copy the server last sent, or
 * unchanged. A list the browser cannot build is asked for again.
 */
export function applyBoardLists(sessionId: string, data: BoardListFields, deps: SyncedListDeps): void {
  const store = useStore.getState();
  if (data.completedBoard || data.completedBoardHash !== undefined) {
    const rows = receiveSyncedList<BoardRow>(
      "completed_board",
      sessionId,
      {
        list: data.completedBoard,
        delta: data.completedBoardDelta,
        hash: data.completedBoardHash,
      },
      (row) => row.questId,
    );
    if (!rows) requestListResync(sessionId, "completed_board", deps);
    else if (store.sessionCompletedBoards.get(sessionId) !== rows) store.setSessionCompletedBoard(sessionId, rows);
  }
  if (data.rowSessionStatuses || data.rowSessionStatusesHash !== undefined) {
    const entries = receiveSyncedList<[string, BoardRowSessionStatus]>(
      "row_session_statuses",
      sessionId,
      {
        list: data.rowSessionStatuses && Object.entries(data.rowSessionStatuses),
        delta: data.rowSessionStatusesDelta,
        hash: data.rowSessionStatusesHash,
      },
      ([questId]) => questId,
    );
    if (!entries) requestListResync(sessionId, "row_session_statuses", deps);
    else {
      const statuses = rowStatusRecord(entries);
      if (store.sessionBoardRowStatuses.get(sessionId) !== statuses)
        store.setSessionBoardRowStatuses(sessionId, statuses);
    }
  }
}

/** The row statuses built from received entries, once per list, so an unchanged list leaves the store alone. */
const rowStatusRecords = new WeakMap<object, Record<string, BoardRowSessionStatus>>();

function rowStatusRecord(entries: [string, BoardRowSessionStatus][]): Record<string, BoardRowSessionStatus> {
  let record = rowStatusRecords.get(entries);
  if (!record) {
    record = Object.fromEntries(entries);
    rowStatusRecords.set(entries, record);
  }
  return record;
}

/**
 * Applies a leader projection, rebuilding each list the message sent as
 * changes or left out from the copy the server last sent. When a list cannot
 * be built the projection is asked for again and the held one stays.
 */
export function applyLeaderProjectionSnapshot(sessionId: string, data: LeaderProjectionMessage, deps: SyncedListDeps) {
  const { projection } = data;
  const threadSummaries = receiveSyncedList(
    "thread_summaries",
    sessionId,
    {
      list: projection.threadSummaries,
      delta: data.threadSummariesDelta,
      hash: data.threadSummariesHash,
    },
    (summary) => summary.threadKey,
  );
  const messageAttentionRecords = receiveSyncedList(
    "message_attention_records",
    sessionId,
    {
      list: projection.messageAttentionRecords,
      delta: data.messageAttentionRecordsDelta,
      hash: data.messageAttentionRecordsHash,
    },
    (record) => record.id,
  );
  if (!threadSummaries || !messageAttentionRecords) {
    requestListResync(sessionId, "thread_summaries", deps);
    return;
  }
  useStore.getState().setLeaderProjection(sessionId, {
    ...projection,
    threadSummaries,
    messageAttentionRecords,
  });
}
