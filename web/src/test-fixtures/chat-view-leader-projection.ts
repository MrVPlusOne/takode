import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionTab,
} from "../../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import {
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "./leader-thread-tabs-projection.js";

interface ProjectionQuestFixture {
  questId: string;
  title: string;
  status: string;
}

interface ProjectionBoardRowFixture {
  questId: string;
  title?: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  completedAt?: number;
  worker?: string;
  workerNum?: number;
}

interface ProjectionNotificationFixture {
  category?: string;
  threadKey?: string | null;
  questId?: string | null;
  timestamp?: number;
  done?: boolean;
}

export interface ChatViewLeaderProjectionStateFixture {
  syncedProjectionValues: Map<string, unknown>;
  syncedProjectionKeys: Set<string>;
  quests?: ProjectionQuestFixture[];
  sessionBoards?: Map<string, unknown[]>;
  sessionCompletedBoards?: Map<string, unknown[]>;
  sessionNotifications?: Map<string, unknown[]>;
  questTitlePreviews?: Map<string, { title?: string } | null>;
}

export interface ChatViewLeaderProjectionOptions {
  tabState?: { version: 1 } | null;
  overrides?: Record<string, Partial<LeaderThreadTabsProjectionTab>>;
}

const COMPLETED_STATUSES = new Set(["done", "completed", "needs_verification"]);

function normalizedStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Install a current-build accepted leader-tabs projection into a lightweight mocked store. */
export function installChatViewLeaderProjection(
  state: ChatViewLeaderProjectionStateFixture,
  sessionId: string,
  orderedThreadKeys: readonly string[],
  options: ChatViewLeaderProjectionOptions = {},
) {
  const activeRows = (state.sessionBoards?.get(sessionId) ?? []) as ProjectionBoardRowFixture[];
  const completedRows = (state.sessionCompletedBoards?.get(sessionId) ?? []) as ProjectionBoardRowFixture[];
  const notifications = (state.sessionNotifications?.get(sessionId) ?? []) as ProjectionNotificationFixture[];
  const tabs = orderedThreadKeys.map((threadKey) => {
    const activeRow = activeRows.find((row) => row.questId.toLowerCase() === threadKey);
    const completedRow = completedRows.find((row) => row.questId.toLowerCase() === threadKey);
    const row = activeRow ?? completedRow;
    const quest = state.quests?.find((candidate) => candidate.questId.toLowerCase() === threadKey);
    const status = normalizedStatus(row?.status ?? quest?.status);
    const completed = !!completedRow || row?.completedAt !== undefined || COMPLETED_STATUSES.has(status);
    const queued = !completed && status === "queued";
    const proposed = !completed && status === "proposed";
    const active = !!activeRow && !completed && !queued && !proposed;
    const needsInput = notifications.some(
      (notification) =>
        notification.done !== true &&
        notification.category === "needs-input" &&
        (notification.threadKey ?? notification.questId)?.toLowerCase() === threadKey,
    );
    const updatedAt = Math.max(
      row?.completedAt ?? 0,
      row?.updatedAt ?? 0,
      ...notifications
        .filter((notification) => (notification.threadKey ?? notification.questId)?.toLowerCase() === threadKey)
        .map((notification) => notification.timestamp ?? 0),
    );
    return createLeaderThreadTabsProjectionTab(threadKey, {
      questId: threadKey,
      title: state.questTitlePreviews?.get(threadKey)?.title ?? row?.title ?? quest?.title ?? threadKey,
      boardStatus: row?.status ?? (completed ? "DONE" : null),
      sourceLeaderSessionId: row ? sessionId : null,
      sourceRowCreatedAt: row ? (row.createdAt ?? 0) : null,
      workerSessionId: row?.worker ?? null,
      workerSessionNum: row?.workerNum ?? null,
      active,
      queued,
      proposed,
      neverStartedScheduled: queued || proposed,
      completed,
      canClose: !active,
      attention: { needsInput, updatedAt },
      updatedAt,
      ...options.overrides?.[threadKey],
    });
  });
  const value = createLeaderThreadTabsProjectionValue({
    tabState: options.tabState === undefined ? { version: 1 } : options.tabState,
    tabs,
    mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
    threadStatuses: {},
    activePhaseSummary: [],
  });
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, sessionId);
  state.syncedProjectionValues.set(entryId, value);
  state.syncedProjectionKeys.add(entryId);
  return value;
}
