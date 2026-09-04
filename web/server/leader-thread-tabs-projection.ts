import {
  LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
  LEADER_THREAD_TABS_PROJECTION,
  LEADER_THREAD_TABS_PROJECTION_MAX_ACTIVE_PHASE_SEGMENTS,
  LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TABS,
  LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
  createLeaderThreadTabsProjectionPatch,
  type LeaderThreadTabsProjectionAttention,
  type LeaderThreadTabsProjectionJourney,
  type LeaderThreadTabsProjectionTab,
  type LeaderThreadTabsProjectionTabState,
  type LeaderThreadTabsProjectionValue,
} from "../shared/leader-thread-tabs-projection.js";
import { buildLeaderActivePhaseSummary } from "../shared/leader-active-phase-summary.js";
import {
  LEADER_OPEN_THREAD_TABS_VERSION,
  normalizeLeaderOpenThreadTabsState,
} from "../shared/leader-open-thread-tabs.js";
import {
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyCurrentPhaseIndex,
  summarizeQuestJourneyDurations,
} from "../shared/quest-journey.js";
import {
  isInMotionLeaderThreadTabRow,
  isNeverStartedScheduledLeaderThreadTabRow,
  type LeaderThreadTabMutationPolicy,
} from "../shared/leader-thread-tab-priority.js";
import { threadStatusKey, threadStatusMessageIdHash, type LeaderThreadStatus } from "../shared/thread-status-marker.js";
import {
  buildProjectionAttentionRecords,
  collectLeaderThreadSummaries,
  collectMessageAttentionRecords,
} from "../shared/leader-projection.js";
import { getUserVisibleSessionNotifications } from "./bridge/session-notification-controller.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { BoardRow, SessionAttentionRecord } from "./session-types.js";
import { SYNCED_PROJECTION_DESCRIPTORS } from "../shared/synced-projection-registry.js";
import { jsonUtf8ByteLength } from "../shared/synced-projection-codec.js";
import {
  createDirectSyncedProjectionDefinition,
  type SyncedProjectionDefinition,
} from "./synced-projection-runtime.js";

const ACTIVE_ATTENTION_STATES = new Set<SessionAttentionRecord["state"]>(["unresolved", "seen", "reopened"]);
const COMPLETED_STATUSES = new Set(["done", "completed", "needs_verification"]);
const EMPTY_ATTENTION: LeaderThreadTabsProjectionAttention = {
  needsInput: false,
  mutedNeedsInput: false,
  reviewUnread: false,
  updatedAt: 0,
};

type LeaderMessageVisualInputs = {
  attentionRecords: SessionAttentionRecord[];
  threadSummaries: ReturnType<typeof collectLeaderThreadSummaries>;
};

type MessageAttentionCacheEntry = LeaderMessageVisualInputs & { signature: readonly unknown[] };
const messageAttentionCache = new WeakMap<object, MessageAttentionCacheEntry>();

export function getLeaderMessageVisualInputs(
  session: Pick<Session, "id" | "messageHistory">,
): LeaderMessageVisualInputs {
  const history = session.messageHistory;
  const tail = history.at(-1) as { content?: unknown; metadata?: unknown } | undefined;
  const signature = [history, history.length, tail, tail?.content, tail?.metadata];
  const cached = messageAttentionCache.get(session);
  if (cached?.signature.every((value, index) => value === signature[index])) return cached;
  const inputs = {
    attentionRecords: collectMessageAttentionRecords(session.id, history),
    threadSummaries: collectLeaderThreadSummaries(history),
    signature,
  };
  messageAttentionCache.set(session, inputs);
  return inputs;
}

export interface LeaderThreadTabsProjectionDefinitionDeps<TSubscriber> {
  getSession: (sessionId: string) => Session | undefined;
  listSessions?: () => Iterable<Session>;
  isCurrentQuestSourceSession?: (session: Session) => boolean;
  isLeaderSession: (session: Session) => boolean;
  authorizeSubscription: (subscriber: TSubscriber, session: Session) => boolean;
}

function boundedText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function boundedNullableText(value: unknown, maxLength: number): string | null {
  const bounded = boundedText(value, maxLength).trim();
  return bounded || null;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeThreadKey(value: unknown, allowMain = false): string | null {
  if (typeof value !== "string") return null;
  const key = threadStatusKey(value);
  if (!key || key === "all" || key.length > LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) return null;
  return key === "main" && !allowMain ? null : key;
}

function normalizeProjectionThreadKey(value: unknown): string | null {
  return normalizeThreadKey(value);
}

function normalizeStatusThreadKey(value: unknown): string | null {
  const key = normalizeThreadKey(value, true);
  return key && (key === "main" || /^q-\d+$/i.test(key)) ? key : null;
}

function normalizeAttentionThreadKey(value: unknown): string | null {
  return normalizeThreadKey(value, true);
}

function sortedBoardRows(rows: Iterable<BoardRow>, completed = false): BoardRow[] {
  return [...rows].sort((left, right) =>
    completed
      ? (right.completedAt ?? 0) - (left.completedAt ?? 0) || left.questId.localeCompare(right.questId)
      : left.createdAt - right.createdAt || left.questId.localeCompare(right.questId),
  );
}

function normalizedStatus(status: string | undefined): string {
  return (status ?? "").trim().toLowerCase();
}

function isCompletedRow(row: BoardRow | undefined): boolean {
  return !!row && (row.completedAt !== undefined || COMPLETED_STATUSES.has(normalizedStatus(row.status)));
}

function isQueuedRow(row: BoardRow | undefined): boolean {
  return normalizedStatus(row?.status) === "queued";
}

function isProposedRow(row: BoardRow | undefined): boolean {
  return normalizedStatus(row?.status) === "proposed";
}

function isInMotionBoardCandidate(row: BoardRow): boolean {
  return (
    isInMotionLeaderThreadTabRow(row, { completed: isCompletedRow(row) }) &&
    normalizeProjectionThreadKey(row.questId) !== null
  );
}

function boardRowsByKey(rows: ReadonlyArray<BoardRow>): Map<string, BoardRow> {
  const result = new Map<string, BoardRow>();
  for (const row of rows) {
    const key = normalizeProjectionThreadKey(row.questId);
    if (key && !result.has(key)) result.set(key, row);
  }
  return result;
}

interface CurrentQuestRow {
  row: BoardRow;
  sourceLeaderSessionId: string;
  completed: boolean;
  claimRank: number;
}

interface CurrentQuestClaim {
  workerSessionId: string;
  leaderSessionId?: string;
  active: boolean;
}

interface CurrentQuestStateOptions {
  sessions?: Iterable<Session>;
  isCurrentQuestSourceSession?: (session: Session) => boolean;
  isCurrentQuestLeaderSession?: (session: Session) => boolean;
}

function claimRank(
  claims: ReadonlyArray<CurrentQuestClaim>,
  workerSessionId: string | undefined,
  leaderSessionId: string,
  completed: boolean,
): number {
  let rank = 0;
  for (const claim of claims) {
    if (
      claim.workerSessionId !== workerSessionId ||
      (claim.leaderSessionId && claim.leaderSessionId !== leaderSessionId)
    ) {
      continue;
    }
    const scopedRank = claim.leaderSessionId ? 2 : 1;
    rank = Math.max(rank, !completed && claim.active ? scopedRank + 2 : scopedRank);
  }
  return rank;
}

function currentQuestRowRunAt(candidate: CurrentQuestRow): number {
  return candidate.completed
    ? nonNegativeNumber(candidate.row.completedAt ?? candidate.row.createdAt)
    : nonNegativeNumber(candidate.row.threadTabActivatedAt ?? candidate.row.createdAt);
}

function currentQuestRowOutranks(left: CurrentQuestRow, right: CurrentQuestRow): boolean {
  const leftHasActiveClaim = left.claimRank >= 3;
  const rightHasActiveClaim = right.claimRank >= 3;
  if (leftHasActiveClaim !== rightHasActiveClaim) return leftHasActiveClaim;
  if (leftHasActiveClaim && left.claimRank !== right.claimRank) return left.claimRank > right.claimRank;
  const runAt = currentQuestRowRunAt(left) - currentQuestRowRunAt(right);
  if (runAt !== 0) return runAt > 0;
  const createdAt = nonNegativeNumber(left.row.createdAt) - nonNegativeNumber(right.row.createdAt);
  if (createdAt !== 0) return createdAt > 0;
  if (left.completed !== right.completed) return !left.completed;
  if (left.claimRank !== right.claimRank) return left.claimRank > right.claimRank;
  return left.sourceLeaderSessionId.localeCompare(right.sourceLeaderSessionId) < 0;
}

function currentQuestRowsByKey(
  sessions: ReadonlyArray<Session>,
  relevantThreadKeys: ReadonlySet<string>,
  isLeaderSession: (session: Session) => boolean,
): Map<string, CurrentQuestRow> {
  const claimsByQuest = new Map<string, CurrentQuestClaim[]>();
  for (const session of sessions) {
    const questId = normalizeProjectionThreadKey(session.state.claimedQuestId);
    if (!questId || !relevantThreadKeys.has(questId)) continue;
    const leaderSessionId = boundedNullableText(
      session.state.claimedQuestLeaderSessionId,
      LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH,
    );
    const claims = claimsByQuest.get(questId) ?? [];
    claims.push({
      workerSessionId: session.id,
      ...(leaderSessionId ? { leaderSessionId } : {}),
      active: normalizedStatus(session.state.claimedQuestStatus) === "in_progress",
    });
    claimsByQuest.set(questId, claims);
  }

  const result = new Map<string, CurrentQuestRow>();
  const consider = (session: Session, row: BoardRow, completedBoard: boolean) => {
    const questId = normalizeProjectionThreadKey(row.questId);
    if (!questId || !relevantThreadKeys.has(questId)) return;
    const claims = claimsByQuest.get(questId) ?? [];
    const completed = completedBoard || isCompletedRow(row);
    const candidate: CurrentQuestRow = {
      row,
      sourceLeaderSessionId: session.id,
      completed,
      claimRank: claimRank(claims, row.worker, session.id, completed),
    };
    const current = result.get(questId);
    if (!current || currentQuestRowOutranks(candidate, current)) result.set(questId, candidate);
  };

  for (const session of sessions) {
    // Worker sessions provide claim evidence, but only visible leader-owned rows
    // may author the current quest/Journey visual projection. A source leader's
    // local tab close does not erase its current quest completion for another
    // leader that still retains the quest.
    if (!isLeaderSession(session)) continue;
    for (const row of session.board.values()) consider(session, row, false);
    for (const row of session.completedBoard.values()) consider(session, row, true);
  }
  return result;
}

function currentQuestRowsForSession(
  session: Session,
  relevantThreadKeys: ReadonlySet<string>,
  options: CurrentQuestStateOptions,
): Map<string, CurrentQuestRow> {
  const isSource =
    options.isCurrentQuestSourceSession ??
    ((candidate: Session) => candidate.searchDataOnly !== true && candidate.state.hidden !== true);
  const sessions = new Map<string, Session>([[session.id, session]]);
  for (const candidate of options.sessions ?? []) {
    if (candidate.id === session.id || isSource(candidate)) sessions.set(candidate.id, candidate);
  }
  return currentQuestRowsByKey(
    [...sessions.values()],
    relevantThreadKeys,
    options.isCurrentQuestLeaderSession ?? ((candidate) => candidate.state.isOrchestrator === true),
  );
}

export function resolveLeaderThreadTabMutationPolicy(
  session: Session,
  threadKey: string,
  options: CurrentQuestStateOptions = {},
): LeaderThreadTabMutationPolicy {
  const normalizedThreadKey = normalizeProjectionThreadKey(threadKey);
  if (!normalizedThreadKey) {
    return {
      inMotion: false,
      scheduled: false,
      neverStartedScheduled: false,
      completed: false,
      canClose: true,
    };
  }

  const currentQuestRow = currentQuestRowsForSession(session, new Set([normalizedThreadKey]), options).get(
    normalizedThreadKey,
  );
  const localActiveRow = boardRowsByKey([...session.board.values()]).get(normalizedThreadKey);
  const localCompletedRow = localActiveRow
    ? undefined
    : boardRowsByKey([...session.completedBoard.values()]).get(normalizedThreadKey);
  const row = currentQuestRow?.row ?? localActiveRow ?? localCompletedRow;
  const completed = currentQuestRow
    ? currentQuestRow.completed
    : isCompletedRow(row) || (!!localCompletedRow && !localActiveRow);
  const inMotion = isInMotionLeaderThreadTabRow(row, { completed });
  const scheduled = !completed && (isQueuedRow(row) || isProposedRow(row));
  return {
    inMotion,
    scheduled,
    neverStartedScheduled: scheduled && isNeverStartedScheduledLeaderThreadTabRow(row),
    completed,
    canClose: !inMotion,
  };
}

type ProjectionTabCandidateKind = "needs-input" | "primary" | "review";

interface ProjectionTabCandidate {
  threadKey: string;
  eventAt: number;
  kind: ProjectionTabCandidateKind;
}

function projectionTabCandidateKind(record: SessionAttentionRecord): ProjectionTabCandidateKind | null {
  if (record.type === "needs_input" && record.priority === "needs_input") {
    return isAttentionActive(record) || record.state === "muted" ? "needs-input" : null;
  }
  if (!isAttentionActive(record)) return null;
  if (
    record.source?.kind === "notification" &&
    (record.type === "review_ready" || record.priority === "review" || record.priority === "completed")
  ) {
    return "review";
  }
  return record.priority !== "review" &&
    record.priority !== "completed" &&
    record.type !== "review_ready" &&
    record.type !== "quest_completed_recent"
    ? "primary"
    : null;
}

interface AttentionVisualInput {
  attention: LeaderThreadTabsProjectionAttention;
  candidate: ProjectionTabCandidate | null;
  title: string | null;
  titleRank: number;
  titleUpdatedAt: number;
}

function buildAttentionVisualInputs(records: ReadonlyArray<SessionAttentionRecord>): Map<string, AttentionVisualInput> {
  const result = new Map<string, AttentionVisualInput>();
  for (const record of records) {
    const threadKey = normalizeAttentionThreadKey(
      record.route.threadKey || record.threadKey || record.questId || "main",
    );
    if (!threadKey) continue;
    const current = result.get(threadKey) ?? {
      attention: EMPTY_ATTENTION,
      candidate: null,
      title: null,
      titleRank: 0,
      titleUpdatedAt: 0,
    };
    const active = isAttentionActive(record);
    const updatedAt = nonNegativeNumber(record.updatedAt);
    const attention = {
      needsInput:
        current.attention.needsInput ||
        (active && record.type === "needs_input" && record.priority === "needs_input" && record.state !== "muted"),
      mutedNeedsInput:
        current.attention.mutedNeedsInput ||
        (record.state === "muted" && record.type === "needs_input" && record.priority === "needs_input"),
      reviewUnread:
        current.attention.reviewUnread ||
        (active &&
          record.source?.kind === "notification" &&
          (record.type === "review_ready" || record.priority === "review" || record.priority === "completed")),
      updatedAt: Math.max(current.attention.updatedAt, updatedAt),
    };

    let { candidate, title, titleRank, titleUpdatedAt } = current;
    if (threadKey !== "main") {
      const kind = projectionTabCandidateKind(record);
      if (kind) {
        const rank = kind === "primary" ? 3 : kind === "needs-input" ? 2 : 1;
        const currentRank = candidate?.kind === "primary" ? 3 : candidate?.kind === "needs-input" ? 2 : 1;
        if (!candidate || candidate.eventAt < updatedAt || (candidate.eventAt === updatedAt && currentRank < rank)) {
          candidate = { threadKey, eventAt: updatedAt, kind };
        }
      }

      const nextTitle = boundedText(record.title, LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH).trim();
      const nextTitleRank =
        record.source?.kind === "quest" || record.source?.kind === "board" || record.source?.kind === "message"
          ? 3
          : record.type === "needs_input"
            ? 2
            : 1;
      if (
        nextTitle &&
        !isQuestIdFallbackTitle(nextTitle, threadKey, record.questId) &&
        (nextTitleRank > titleRank || (nextTitleRank === titleRank && updatedAt > titleUpdatedAt))
      ) {
        title = nextTitle;
        titleRank = nextTitleRank;
        titleUpdatedAt = updatedAt;
      }
    }
    result.set(threadKey, { attention, candidate, title, titleRank, titleUpdatedAt });
  }
  return result;
}

function buildEffectiveOpenKeys(
  existingState: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
  boardRows: ReadonlyArray<BoardRow>,
  attentionVisualInputs: ReadonlyMap<string, AttentionVisualInput>,
): string[] {
  if (existingState) return existingState.orderedOpenThreadKeys.slice(0, LEADER_THREAD_TABS_PROJECTION_MAX_TABS);

  const active = boardRows.filter(isInMotionBoardCandidate).map((row) => normalizeProjectionThreadKey(row.questId)!);
  const scheduled = boardRows
    .filter((row) => !isCompletedRow(row) && (isQueuedRow(row) || isProposedRow(row)))
    .map((row) => normalizeProjectionThreadKey(row.questId))
    .filter((threadKey): threadKey is string => threadKey !== null);
  const boardKeys = new Set([...active, ...scheduled]);
  const blockedCandidates = new Set(
    boardRows
      .filter(isNeverStartedScheduledLeaderThreadTabRow)
      .map((row) => normalizeProjectionThreadKey(row.questId))
      .filter((threadKey): threadKey is string => threadKey !== null),
  );
  const candidates = [...attentionVisualInputs.values()]
    .map((input) => input.candidate)
    .filter(
      (candidate): candidate is ProjectionTabCandidate =>
        candidate !== null && !boardKeys.has(candidate.threadKey) && !blockedCandidates.has(candidate.threadKey),
    )
    .sort((left, right) => left.eventAt - right.eventAt || left.threadKey.localeCompare(right.threadKey));
  const keys = [
    ...candidates.filter((candidate) => candidate.kind === "primary").reverse(),
    ...active.map((threadKey) => ({ threadKey })),
    ...candidates.filter((candidate) => candidate.kind === "needs-input").reverse(),
    ...candidates.filter((candidate) => candidate.kind === "review"),
    ...scheduled.map((threadKey) => ({ threadKey })),
  ];
  return [...new Set(keys.map(({ threadKey }) => threadKey))].slice(0, LEADER_THREAD_TABS_PROJECTION_MAX_TABS);
}

function isAttentionActive(record: SessionAttentionRecord): boolean {
  return ACTIVE_ATTENTION_STATES.has(record.state);
}

function isQuestIdFallbackTitle(title: string, threadKey: string, questId?: string): boolean {
  const normalized = title.trim().toLowerCase();
  return [threadKey, questId?.trim().toLowerCase()].some(
    (id) => !!id && (normalized === id || normalized === `${id}: ${id}` || normalized === `${id} ${id}`),
  );
}

function compactJourney(row: BoardRow | undefined, completed: boolean): LeaderThreadTabsProjectionJourney | null {
  if (!row?.journey) return null;
  const phaseIds = row.journey.phaseIds.slice(0, 100);
  const phaseCount = phaseIds.length;
  const currentPhaseId = boundedNullableText(
    getQuestJourneyCurrentPhaseId(row.journey, row.status),
    LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH,
  );
  const activePhaseIndex = nonNegativeInteger(getQuestJourneyCurrentPhaseIndex(row.journey, row.status));
  return {
    mode: row.journey.mode ?? (normalizedStatus(row.status) === "proposed" ? "proposed" : "active"),
    phaseIds,
    currentPhaseId,
    activePhaseIndex: activePhaseIndex !== null && activePhaseIndex < phaseCount ? activePhaseIndex : null,
    phaseCount,
    durationSummary: summarizeQuestJourneyDurations(row.journey, row.status, {
      allowActiveElapsed: !completed,
      maxPhaseCount: phaseCount,
    }),
  };
}

function compactStatus(source: LeaderThreadStatus, key: string): LeaderThreadStatus {
  const kind = source.kind === "waiting" ? "waiting" : "ready";
  const questId = boundedNullableText(source.questId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH);
  const messageId = boundedText(source.messageId, LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH);
  const messageIdHash =
    source.messageIdHash ?? (messageId !== source.messageId ? threadStatusMessageIdHash(source.messageId) : undefined);
  return {
    kind,
    label: kind === "waiting" ? "Thread Waiting" : "Thread Ready",
    threadKey: key,
    ...(questId ? { questId } : {}),
    summary: boundedText(source.summary, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH),
    messageId,
    ...(messageIdHash ? { messageIdHash } : {}),
    timestamp: nonNegativeNumber(source.timestamp),
    updatedAt: nonNegativeNumber(source.updatedAt),
  };
}

function relevantThreadStatuses(
  source: Readonly<Record<string, LeaderThreadStatus>>,
  orderedOpenThreadKeys: ReadonlyArray<string>,
): Record<string, LeaderThreadStatus> {
  const byKey = new Map<string, LeaderThreadStatus>();
  for (const [rawKey, status] of Object.entries(source)) {
    const key = normalizeStatusThreadKey(status.threadKey || rawKey);
    if (key) byKey.set(key, status);
  }
  const relevantKeys = ["main", ...orderedOpenThreadKeys];
  const result: Record<string, LeaderThreadStatus> = {};
  for (const key of relevantKeys) {
    const status = byKey.get(key);
    if (status) result[key] = compactStatus(status, key);
  }
  return result;
}

function compactActivePhaseSummary(activeBoard: ReadonlyArray<BoardRow>) {
  return buildLeaderActivePhaseSummary(activeBoard)
    .slice(0, LEADER_THREAD_TABS_PROJECTION_MAX_ACTIVE_PHASE_SEGMENTS)
    .map((segment) => ({
      label: boundedText(segment.label, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH),
      count: Math.max(1, Math.floor(segment.count)),
      tone: segment.tone,
      ...(segment.color
        ? {
            color: boundedText(segment.color, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH),
          }
        : {}),
      ...(segment.colorName
        ? {
            colorName: boundedText(segment.colorName, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH),
          }
        : {}),
    }));
}

function serializedValueBytes(value: LeaderThreadTabsProjectionValue): number {
  return jsonUtf8ByteLength(value) ?? Number.POSITIVE_INFINITY;
}

function minimalStatusIdentity(status: LeaderThreadStatus): LeaderThreadStatus {
  const { questId: _questId, ...rest } = status;
  return {
    ...rest,
    summary: "",
    messageId: "",
    messageIdHash: status.messageIdHash ?? threadStatusMessageIdHash(status.messageId),
  };
}

function compactDisplayText(
  value: LeaderThreadTabsProjectionValue,
  titleLength: number,
  summaryLength: number,
  clearPhaseSummary = false,
): LeaderThreadTabsProjectionValue {
  return {
    ...value,
    tabs: value.tabs.map((tab) => ({ ...tab, title: tab.title?.slice(0, titleLength) || null })),
    threadStatuses: Object.fromEntries(
      Object.entries(value.threadStatuses).map(([key, status]) => [
        key,
        { ...status, summary: status.summary.slice(0, summaryLength) },
      ]),
    ),
    ...(clearPhaseSummary ? { activePhaseSummary: [] } : {}),
  };
}

function durationSummaryRetentionRank(tab: LeaderThreadTabsProjectionTab): number {
  if (tab.active) return 2;
  if (tab.completed) return 1;
  return 0;
}

function compactDurationSummariesToByteLimit(value: LeaderThreadTabsProjectionValue): LeaderThreadTabsProjectionValue {
  let compacted = value;
  const candidates = value.tabs
    .map((tab, index) => {
      const durationSummary = tab.journey?.durationSummary;
      return {
        index,
        rank: durationSummaryRetentionRank(tab),
        bytes:
          durationSummary !== null &&
          durationSummary !== undefined &&
          durationSummary !== LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED
            ? (jsonUtf8ByteLength(durationSummary) ?? 0)
            : 0,
      };
    })
    .filter(({ bytes }) => bytes > 0)
    .sort((left, right) => left.rank - right.rank || right.bytes - left.bytes || right.index - left.index);

  for (const { index } of candidates) {
    const tab = compacted.tabs[index];
    if (
      !tab?.journey ||
      tab.journey.durationSummary === null ||
      tab.journey.durationSummary === LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED
    ) {
      continue;
    }
    const tabs = [...compacted.tabs];
    tabs[index] = {
      ...tab,
      journey: { ...tab.journey, durationSummary: LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED },
    };
    compacted = { ...compacted, tabs };
    if (serializedValueBytes(compacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) return compacted;
  }
  return compacted;
}

function compactStatusIdentities(value: LeaderThreadTabsProjectionValue): LeaderThreadTabsProjectionValue {
  return {
    ...value,
    threadStatuses: Object.fromEntries(
      Object.entries(value.threadStatuses).map(([key, status]) => [key, minimalStatusIdentity(status)]),
    ),
  };
}

function compactValueToByteLimit(value: LeaderThreadTabsProjectionValue): LeaderThreadTabsProjectionValue {
  if (serializedValueBytes(value) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) return value;
  const compacted = compactDisplayText(value, 80, 100);
  if (serializedValueBytes(compacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) return compacted;

  const displayCompacted = compactDisplayText(compacted, 0, 48, true);
  if (serializedValueBytes(displayCompacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) {
    return displayCompacted;
  }

  const durationCompacted = compactDurationSummariesToByteLimit(displayCompacted);
  if (serializedValueBytes(durationCompacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) {
    return durationCompacted;
  }

  // Preserve bounded Journey structure before falling back to identity-only
  // tabs. Once display text is already compacted, status summaries and full
  // message IDs are less valuable than retaining the phase sequence and the
  // highest-priority duration summaries that still fit.
  const statusCompacted = compactStatusIdentities(displayCompacted);
  if (serializedValueBytes(statusCompacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) {
    return statusCompacted;
  }
  const statusAndDurationCompacted = compactDurationSummariesToByteLimit(statusCompacted);
  if (serializedValueBytes(statusAndDurationCompacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) {
    return statusAndDurationCompacted;
  }

  // Pathological long custom keys can still require nonessential phase/status
  // detail to be shed after display text and duration evidence are compacted.
  return {
    ...statusAndDurationCompacted,
    tabs: statusAndDurationCompacted.tabs.map((tab) => ({
      ...tab,
      title: null,
      boardStatus: null,
      journey: null,
    })),
  };
}

export function buildLeaderThreadTabsProjectionValue(
  session: Session,
  options: CurrentQuestStateOptions = {},
): LeaderThreadTabsProjectionValue {
  const activeBoard = sortedBoardRows(session.board.values());
  const completedBoard = sortedBoardRows(session.completedBoard.values(), true);
  const existingState = normalizeLeaderOpenThreadTabsState(session.state.leaderOpenThreadTabs);
  const visibleNotifications = getUserVisibleSessionNotifications(session);
  const attentionRecords = buildProjectionAttentionRecords({
    leaderSessionId: session.id,
    records: [...session.attentionRecords, ...getLeaderMessageVisualInputs(session).attentionRecords],
    notifications: visibleNotifications,
    boardRows: activeBoard,
    completedBoardRows: completedBoard,
  });
  const attentionVisualInputs = buildAttentionVisualInputs(attentionRecords);
  const activeByKey = boardRowsByKey(activeBoard);
  const completedByKey = boardRowsByKey(completedBoard);
  const relevantCurrentQuestKeys = new Set<string>(existingState?.orderedOpenThreadKeys ?? []);
  for (const threadKey of activeByKey.keys()) relevantCurrentQuestKeys.add(threadKey);
  for (const threadKey of completedByKey.keys()) relevantCurrentQuestKeys.add(threadKey);
  for (const threadKey of attentionVisualInputs.keys()) {
    if (threadKey !== "main") relevantCurrentQuestKeys.add(threadKey);
  }
  for (const threadKey of Object.keys(session.state.leaderThreadStatuses ?? {})) {
    const normalizedThreadKey = normalizeProjectionThreadKey(threadStatusKey(threadKey));
    if (normalizedThreadKey) relevantCurrentQuestKeys.add(normalizedThreadKey);
  }
  const currentQuestRows = currentQuestRowsForSession(session, relevantCurrentQuestKeys, options);
  const orderingRowsByKey = new Map(activeByKey);
  for (const [threadKey, currentQuestRow] of currentQuestRows) {
    orderingRowsByKey.set(threadKey, currentQuestRow.row);
  }
  const orderingRows = sortedBoardRows(orderingRowsByKey.values());
  const orderedOpenThreadKeys = buildEffectiveOpenKeys(existingState, orderingRows, attentionVisualInputs);
  const threadStatuses = relevantThreadStatuses(session.state.leaderThreadStatuses ?? {}, orderedOpenThreadKeys);
  const tabState: LeaderThreadTabsProjectionTabState | null = existingState
    ? { version: LEADER_OPEN_THREAD_TABS_VERSION }
    : null;

  const tabs: LeaderThreadTabsProjectionTab[] = orderedOpenThreadKeys.map((threadKey) => {
    const localActiveRow = activeByKey.get(threadKey);
    const localCompletedRow = localActiveRow ? undefined : completedByKey.get(threadKey);
    const localRow = localActiveRow ?? localCompletedRow;
    const currentQuestRow = currentQuestRows.get(threadKey);
    const row = currentQuestRow?.row ?? localRow;
    const completed = currentQuestRow
      ? currentQuestRow.completed
      : isCompletedRow(row) || (!!localCompletedRow && !localActiveRow);
    const queued = !completed && isQueuedRow(row);
    const proposed = !completed && isProposedRow(row);
    const neverStartedScheduled = (queued || proposed) && isNeverStartedScheduledLeaderThreadTabRow(row);
    const isActive = isInMotionLeaderThreadTabRow(row, { completed });
    const attentionVisualInput = attentionVisualInputs.get(threadKey);
    const tabAttention = attentionVisualInput?.attention ?? EMPTY_ATTENTION;
    const status = threadStatuses[threadKey];
    return {
      threadKey,
      questId: /^q-\d+$/i.test(threadKey) ? threadKey : null,
      title: boundedNullableText(
        row?.title ?? attentionVisualInput?.title,
        LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH,
      ),
      boardStatus: boundedNullableText(row?.status, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH),
      journey: compactJourney(row, completed),
      sourceLeaderSessionId: boundedNullableText(
        currentQuestRow?.sourceLeaderSessionId ?? (localRow ? session.id : null),
        LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH,
      ),
      sourceRowCreatedAt: row ? nonNegativeNumber(row.createdAt) : null,
      workerSessionId: boundedNullableText(row?.worker, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH),
      workerSessionNum: nonNegativeInteger(row?.workerNum),
      active: isActive,
      queued,
      proposed,
      neverStartedScheduled,
      completed,
      canClose: !isActive,
      attention: { ...tabAttention },
      updatedAt: Math.max(
        nonNegativeNumber(row?.completedAt),
        nonNegativeNumber(row?.updatedAt),
        tabAttention.updatedAt,
      ),
    };
  });

  return compactValueToByteLimit({
    currentQuestStateVersion: 1,
    tabState,
    tabs,
    mainAttention: { ...(attentionVisualInputs.get("main")?.attention ?? EMPTY_ATTENTION) },
    threadStatuses,
    activePhaseSummary: compactActivePhaseSummary(activeBoard),
  });
}

export function createLeaderThreadTabsProjectionDefinition<TSubscriber>(
  deps: LeaderThreadTabsProjectionDefinitionDeps<TSubscriber>,
): SyncedProjectionDefinition<Session, LeaderThreadTabsProjectionValue, LeaderThreadTabsProjectionValue, TSubscriber> {
  return createDirectSyncedProjectionDefinition({
    descriptor: SYNCED_PROJECTION_DESCRIPTORS[LEADER_THREAD_TABS_PROJECTION],
    dependencies: [
      "leader-open-thread-tabs",
      "leader-board",
      "leader-current-quest-state",
      "leader-notifications",
      "leader-attention-records",
      "leader-thread-statuses",
      "leader-message-history",
    ],
    resolveSource: (key) => {
      const session = deps.getSession(key);
      return session && deps.isLeaderSession(session) ? session : undefined;
    },
    selectValue: (session) =>
      buildLeaderThreadTabsProjectionValue(session, {
        sessions: deps.listSessions?.(),
        isCurrentQuestSourceSession: deps.isCurrentQuestSourceSession,
        isCurrentQuestLeaderSession: deps.isLeaderSession,
      }),
    authorizeSubscription: (subscriber, _key, session) =>
      deps.isLeaderSession(session) && deps.authorizeSubscription(subscriber, session),
    createPatch: createLeaderThreadTabsProjectionPatch,
  });
}
