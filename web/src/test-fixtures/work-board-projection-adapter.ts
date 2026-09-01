import {
  LEADER_THREAD_TABS_PROJECTION,
  isLeaderThreadTabsProjectionValue,
  reconcileLeaderThreadTabsProjectionValue,
  type LeaderThreadTabsProjectionAttention,
  type LeaderThreadTabsProjectionJourney,
  type LeaderThreadTabsProjectionTab,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import { buildLeaderActivePhaseSummary } from "../../shared/leader-active-phase-summary.js";
import {
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyCurrentPhaseIndex,
  normalizeQuestJourneyPlan,
  summarizeQuestJourneyDurations,
} from "../../shared/quest-journey.js";
import { isInMotionLeaderThreadTabRow } from "../../shared/leader-thread-tab-priority.js";
import { normalizeLeaderOpenThreadKeys, normalizeLeaderThreadKey } from "../../shared/leader-open-thread-tabs.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { BoardRowData } from "../components/BoardTable.js";
import type { QuestmasterTask, SessionAttentionRecord } from "../types.js";

interface WorkBoardThreadRowFixture {
  threadKey: string;
  questId?: string;
  title: string;
  status?: string;
  boardStatus?: string;
  messageCount?: number;
  section?: "active" | "done";
}

interface WorkBoardProjectionStateFixture {
  sessionBoards: Map<string, BoardRowData[]>;
  sessionCompletedBoards: Map<string, BoardRowData[]>;
  sdkSessions?: Array<{ sessionId: string; isOrchestrator?: boolean }>;
  sessions?: Map<string, unknown>;
  quests?: QuestmasterTask[];
  syncedProjectionValues?: Map<string, unknown>;
  syncedProjectionKeys?: Set<string>;
}

export interface WorkBoardProjectionPropsFixture {
  sessionId: string;
  openThreadKeys?: string[];
  closedThreadKeys?: string[];
  threadRows?: WorkBoardThreadRowFixture[];
  attentionRecords?: ReadonlyArray<SessionAttentionRecord>;
}

interface ProjectionFixtureHistory {
  orderedKeys: string[];
  explicitKeys: string[] | null;
  closedKeys: Set<string>;
}

const historyBySession = new Map<string, ProjectionFixtureHistory>();

const EMPTY_ATTENTION: LeaderThreadTabsProjectionAttention = {
  needsInput: false,
  mutedNeedsInput: false,
  reviewUnread: false,
  updatedAt: 0,
};

const ACTIVE_ATTENTION_STATES = new Set<SessionAttentionRecord["state"]>(["unresolved", "seen", "reopened"]);
const COMPLETED_STATUSES = new Set(["done", "completed", "needs_verification"]);

function normalizeThreadKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = normalizeLeaderThreadKey(value);
  return normalized && normalized !== "main" && normalized !== "all" ? normalized : null;
}

function normalizedStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isCompletedQuest(quest: QuestmasterTask | undefined): boolean {
  return !!quest && COMPLETED_STATUSES.has(normalizedStatus(quest.status));
}

function isCompletedThreadRow(row: WorkBoardThreadRowFixture | undefined): boolean {
  if (!row) return false;
  if (COMPLETED_STATUSES.has(normalizedStatus(row.status))) return true;
  if (COMPLETED_STATUSES.has(normalizedStatus(row.boardStatus))) return true;
  return row.section === "done" && row.status === undefined && row.boardStatus === undefined;
}

function isCompletedBoardRow(row: BoardRowData | undefined, fromCompletedBoard: boolean): boolean {
  return (
    !!row &&
    (fromCompletedBoard || row.completedAt !== undefined || COMPLETED_STATUSES.has(normalizedStatus(row.status)))
  );
}

function isAttentionActive(record: SessionAttentionRecord): boolean {
  return ACTIVE_ATTENTION_STATES.has(record.state);
}

function isMutedNeedsInput(record: SessionAttentionRecord): boolean {
  return record.state === "muted" && record.type === "needs_input" && record.priority === "needs_input";
}

function isNeedsInput(record: SessionAttentionRecord): boolean {
  return isAttentionActive(record) && record.type === "needs_input" && record.priority === "needs_input";
}

function isReviewUnread(record: SessionAttentionRecord): boolean {
  return (
    isAttentionActive(record) &&
    record.source.kind === "notification" &&
    (record.type === "review_ready" || record.priority === "review" || record.priority === "completed")
  );
}

function isPrimaryCandidate(record: SessionAttentionRecord): boolean {
  return (
    isAttentionActive(record) &&
    !isNeedsInput(record) &&
    record.priority !== "review" &&
    record.priority !== "completed" &&
    record.type !== "review_ready" &&
    record.type !== "quest_completed_recent"
  );
}

function attentionThreadKey(record: SessionAttentionRecord): string {
  return normalizeLeaderThreadKey(record.route.threadKey || record.threadKey || record.questId || "main");
}

function attentionByThread(
  attentionRecords: ReadonlyArray<SessionAttentionRecord>,
  activeRows: ReadonlyMap<string, BoardRowData>,
): Map<string, LeaderThreadTabsProjectionAttention> {
  const recordsByThread = new Map<string, SessionAttentionRecord[]>();
  for (const record of attentionRecords) {
    const key = attentionThreadKey(record);
    const existing = recordsByThread.get(key);
    if (existing) existing.push(record);
    else recordsByThread.set(key, [record]);
  }

  const result = new Map<string, LeaderThreadTabsProjectionAttention>();
  for (const key of new Set([...recordsByThread.keys(), ...activeRows.keys()])) {
    const records = recordsByThread.get(key) ?? [];
    const row = activeRows.get(key);
    const mutedNotificationIds = new Set(
      records
        .filter(isMutedNeedsInput)
        .map((record) => (record.source.kind === "notification" ? record.source.id : undefined)),
    );
    const waitForInput = row?.waitForInput ?? [];
    const rowNeedsInput = waitForInput.length > 0 && !waitForInput.every((id) => mutedNotificationIds.has(id));
    const rowMutedNeedsInput = waitForInput.length > 0 && waitForInput.every((id) => mutedNotificationIds.has(id));
    result.set(key, {
      needsInput: rowNeedsInput || records.some(isNeedsInput),
      mutedNeedsInput: rowMutedNeedsInput || records.some(isMutedNeedsInput),
      reviewUnread: records.some(isReviewUnread),
      updatedAt: Math.max(row?.updatedAt ?? 0, ...records.map((record) => record.updatedAt ?? 0), 0),
    });
  }
  return result;
}

function compactJourney(row: BoardRowData | undefined): LeaderThreadTabsProjectionJourney | null {
  if (!row?.journey) return null;
  const normalized = normalizeQuestJourneyPlan(row.journey, row.status);
  const phaseIds = normalized.phaseIds.slice(0, 100);
  const activePhaseIndex = getQuestJourneyCurrentPhaseIndex(normalized, row.status);
  const summary = summarizeQuestJourneyDurations(normalized, row.status, {
    allowActiveElapsed: !isCompletedBoardRow(row, false),
    maxPhaseCount: phaseIds.length,
  });
  return {
    mode: normalized.mode ?? null,
    phaseIds,
    currentPhaseId: getQuestJourneyCurrentPhaseId(normalized, row.status) ?? null,
    activePhaseIndex:
      activePhaseIndex !== undefined && activePhaseIndex >= 0 && activePhaseIndex < phaseIds.length
        ? activePhaseIndex
        : null,
    phaseCount: phaseIds.length,
    durationSummary: summary,
  };
}

function titleIsQuestIdFallback(title: string, threadKey: string, questId?: string): boolean {
  const normalized = title.trim().toLowerCase();
  const ids = new Set([threadKey, questId?.trim().toLowerCase()].filter((value): value is string => !!value));
  if (ids.has(normalized)) return true;
  return [...ids].some((id) => normalized === `${id}: ${id}` || normalized === `${id} ${id}`);
}

function attentionTitle(records: ReadonlyArray<SessionAttentionRecord>, threadKey: string): string | undefined {
  return records
    .filter((record) => attentionThreadKey(record) === threadKey)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .map((record) => record.title?.trim())
    .find((title): title is string => !!title && !titleIsQuestIdFallback(title, threadKey, threadKey));
}

function placeFirst(keys: string[], key: string): void {
  const index = keys.indexOf(key);
  if (index >= 0) return;
  keys.unshift(key);
}

function placeLast(keys: string[], key: string): void {
  if (!keys.includes(key)) keys.push(key);
}

function placeBeforeDeferred(keys: string[], key: string, deferredKeys: ReadonlySet<string>): void {
  if (keys.includes(key)) return;
  const index = keys.findIndex((candidate) => deferredKeys.has(candidate));
  if (index < 0) keys.push(key);
  else keys.splice(index, 0, key);
}

function candidateOrder(
  explicitKeys: ReadonlyArray<string>,
  previous: ProjectionFixtureHistory | undefined,
  closedKeys: ReadonlySet<string>,
  activeBoardRows: ReadonlyArray<BoardRowData>,
  attentionRecords: ReadonlyArray<SessionAttentionRecord>,
): string[] {
  const keys = explicitKeys.filter((key) => !closedKeys.has(key));
  for (const key of previous?.orderedKeys ?? []) {
    if (!closedKeys.has(key)) placeLast(keys, key);
  }

  const activeByKey = new Map(
    activeBoardRows
      .map((row) => [normalizeThreadKey(row.questId), row] as const)
      .filter((entry): entry is [string, BoardRowData] => entry[0] !== null),
  );
  const needsInputCandidates = [...attentionByThread(attentionRecords, activeByKey)]
    .filter(([key, attention]) => key !== "main" && attention.needsInput)
    .sort((left, right) => left[1].updatedAt - right[1].updatedAt || left[0].localeCompare(right[0]));
  for (const [key] of needsInputCandidates) if (!closedKeys.has(key)) placeFirst(keys, key);

  const inMotionRows = activeBoardRows
    .filter((row) =>
      isInMotionLeaderThreadTabRow(row, {
        completed: isCompletedBoardRow(row, false),
      }),
    )
    .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.questId.localeCompare(right.questId));
  for (const row of [...inMotionRows].reverse()) {
    const key = normalizeThreadKey(row.questId);
    if (key && !closedKeys.has(key)) placeFirst(keys, key);
  }

  const deferredKeys = new Set<string>();
  for (const row of activeBoardRows) {
    const status = normalizedStatus(row.status);
    if (status !== "queued" && status !== "proposed") continue;
    const key = normalizeThreadKey(row.questId);
    if (!key || closedKeys.has(key)) continue;
    deferredKeys.add(key);
    placeLast(keys, key);
  }

  const sortedAttention = [...attentionRecords].sort(
    (left, right) =>
      (left.updatedAt ?? 0) - (right.updatedAt ?? 0) ||
      attentionThreadKey(left).localeCompare(attentionThreadKey(right)),
  );
  for (const record of sortedAttention) {
    if (!isReviewUnread(record)) continue;
    const key = normalizeThreadKey(attentionThreadKey(record));
    if (key && !closedKeys.has(key)) placeBeforeDeferred(keys, key, deferredKeys);
  }
  for (const record of sortedAttention) {
    if (!isPrimaryCandidate(record)) continue;
    const key = normalizeThreadKey(attentionThreadKey(record));
    if (key && !closedKeys.has(key)) placeFirst(keys, key);
  }

  return normalizeLeaderOpenThreadKeys(keys);
}

function relevantThreadStatuses(
  state: WorkBoardProjectionStateFixture,
  sessionId: string,
  orderedKeys: ReadonlyArray<string>,
): Record<string, LeaderThreadStatus> {
  const session = state.sessions?.get(sessionId) as
    | { leaderThreadStatuses?: Record<string, LeaderThreadStatus> }
    | undefined;
  const source = session?.leaderThreadStatuses ?? {};
  const result: Record<string, LeaderThreadStatus> = {};
  for (const key of ["main", ...orderedKeys]) {
    const status = source[key];
    if (!status || (key !== "main" && !/^q-\d+$/.test(key))) continue;
    result[key] = {
      ...status,
      threadKey: key,
      label: status.kind === "waiting" ? "Thread Waiting" : "Thread Ready",
      ...(key === "main" ? { questId: undefined } : { questId: status.questId ?? key }),
    };
  }
  return result;
}

function questByKey(state: WorkBoardProjectionStateFixture): Map<string, QuestmasterTask> {
  return new Map((state.quests ?? []).map((quest) => [normalizeLeaderThreadKey(quest.questId), quest]));
}

export function resetWorkBoardProjectionFixture(): void {
  historyBySession.clear();
}

export function installWorkBoardProjectionFixture(
  state: WorkBoardProjectionStateFixture,
  props: WorkBoardProjectionPropsFixture,
  options: { explicitOpenKeysProvided?: boolean } = {},
): LeaderThreadTabsProjectionValue | null {
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, props.sessionId);
  const isOrchestrator = state.sdkSessions?.find((session) => session.sessionId === props.sessionId)?.isOrchestrator;
  if (isOrchestrator === false) {
    state.syncedProjectionValues?.delete(entryId);
    state.syncedProjectionKeys?.delete(entryId);
    return null;
  }

  const previous = historyBySession.get(props.sessionId);
  const explicitKeysProvided = options.explicitOpenKeysProvided ?? props.openThreadKeys !== undefined;
  const explicitKeys = explicitKeysProvided ? normalizeLeaderOpenThreadKeys(props.openThreadKeys ?? []) : [];
  const closedKeys = new Set(previous?.closedKeys ?? []);
  for (const key of normalizeLeaderOpenThreadKeys(props.closedThreadKeys ?? [])) closedKeys.add(key);
  if (explicitKeysProvided && previous?.explicitKeys) {
    for (const key of previous.explicitKeys) if (!explicitKeys.includes(key)) closedKeys.add(key);
  }
  for (const key of explicitKeys) closedKeys.delete(key);

  const activeBoardRows = state.sessionBoards.get(props.sessionId) ?? [];
  const completedBoardRows = state.sessionCompletedBoards.get(props.sessionId) ?? [];
  const attentionRecords = props.attentionRecords ?? [];
  const orderedKeys = candidateOrder(explicitKeys, previous, closedKeys, activeBoardRows, attentionRecords);
  const activeByKey = new Map(activeBoardRows.map((row) => [normalizeLeaderThreadKey(row.questId), row]));
  const completedByKey = new Map(completedBoardRows.map((row) => [normalizeLeaderThreadKey(row.questId), row]));
  const threadRowsByKey = new Map(
    (props.threadRows ?? []).map((row) => [normalizeLeaderThreadKey(row.threadKey), row] as const),
  );
  const quests = questByKey(state);
  const attention = attentionByThread(attentionRecords, activeByKey);

  const tabs: LeaderThreadTabsProjectionTab[] = orderedKeys.map((threadKey) => {
    const activeRow = activeByKey.get(threadKey);
    const completedRow = activeRow ? undefined : completedByKey.get(threadKey);
    const boardRow = activeRow ?? completedRow;
    const threadRow = threadRowsByKey.get(threadKey);
    const quest = quests.get(normalizeLeaderThreadKey(boardRow?.questId ?? threadRow?.questId ?? threadKey));
    const completed = activeRow
      ? isCompletedBoardRow(activeRow, false) || isCompletedQuest(quest)
      : isCompletedBoardRow(completedRow, !!completedRow) || isCompletedThreadRow(threadRow) || isCompletedQuest(quest);
    const status = boardRow?.status ?? threadRow?.boardStatus ?? threadRow?.status ?? (completed ? "done" : null);
    const queued = !completed && normalizedStatus(status) === "queued";
    const proposed = !completed && normalizedStatus(status) === "proposed";
    const active = !completed && !queued && !proposed && isInMotionLeaderThreadTabRow(activeRow);
    const tabAttention = attention.get(threadKey) ?? EMPTY_ATTENTION;
    const questId = boardRow?.questId ?? threadRow?.questId ?? (/^q-\d+$/i.test(threadKey) ? threadKey : null);
    return {
      threadKey,
      questId,
      title:
        boardRow?.title ??
        threadRow?.title ??
        attentionTitle(attentionRecords, threadKey) ??
        quest?.title ??
        questId ??
        threadKey,
      boardStatus: status,
      journey: compactJourney(boardRow),
      sourceLeaderSessionId: boardRow ? props.sessionId : null,
      sourceRowCreatedAt: boardRow ? Math.max(0, boardRow.createdAt ?? 0) : null,
      workerSessionId: boardRow?.worker ?? null,
      workerSessionNum: boardRow?.workerNum ?? null,
      active,
      queued,
      proposed,
      neverStartedScheduled: (queued || proposed) && boardRow?.threadTabActivatedAt === undefined,
      completed,
      canClose: !active,
      attention: { ...tabAttention },
      updatedAt: Math.max(boardRow?.completedAt ?? 0, boardRow?.updatedAt ?? 0, tabAttention.updatedAt),
    };
  });

  const value: LeaderThreadTabsProjectionValue = {
    currentQuestStateVersion: 1,
    tabState: { version: 1 },
    tabs,
    mainAttention: { ...(attention.get("main") ?? EMPTY_ATTENTION) },
    threadStatuses: relevantThreadStatuses(state, props.sessionId, orderedKeys),
    activePhaseSummary: buildLeaderActivePhaseSummary(activeBoardRows),
  };
  if (!isLeaderThreadTabsProjectionValue(value)) {
    throw new Error(`Invalid WorkBoardBar projection fixture for ${props.sessionId}`);
  }

  state.syncedProjectionValues ??= new Map();
  state.syncedProjectionKeys ??= new Set();
  const cachedProjection = state.syncedProjectionValues.get(entryId);
  const reconciledValue = reconcileLeaderThreadTabsProjectionValue(
    isLeaderThreadTabsProjectionValue(cachedProjection) ? cachedProjection : undefined,
    value,
  );
  state.syncedProjectionValues.set(entryId, reconciledValue);
  state.syncedProjectionKeys.add(entryId);
  historyBySession.set(props.sessionId, {
    orderedKeys: [...orderedKeys],
    explicitKeys: explicitKeysProvided ? [...explicitKeys] : (previous?.explicitKeys ?? null),
    closedKeys,
  });
  return reconciledValue;
}
