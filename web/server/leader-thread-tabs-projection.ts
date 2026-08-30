import {
  LEADER_THREAD_TABS_PROJECTION,
  LEADER_THREAD_TABS_PROJECTION_MAX_ACTIVE_PHASE_SEGMENTS,
  LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TABS,
  LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH,
  LEADER_THREAD_TABS_PROJECTION_MAX_TOMBSTONES,
  LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
  leaderThreadTabsProjectionEqual,
  type LeaderThreadTabsProjectionAttention,
  type LeaderThreadTabsProjectionJourney,
  type LeaderThreadTabsProjectionTab,
  type LeaderThreadTabsProjectionTabState,
  type LeaderThreadTabsProjectionValue,
} from "../shared/leader-thread-tabs-projection.js";
import { buildLeaderActivePhaseSummary } from "../shared/leader-active-phase-summary.js";
import {
  LEADER_OPEN_THREAD_TABS_VERSION,
  canServerCandidateOpenThread,
  normalizeLeaderOpenThreadTabsState,
  placeLeaderOpenThreadTabBeforeKeys,
  placeLeaderOpenThreadTabKey,
  shouldPersistLeaderThreadTab,
} from "../shared/leader-open-thread-tabs.js";
import { getQuestJourneyCurrentPhaseId, getQuestJourneyCurrentPhaseIndex } from "../shared/quest-journey.js";
import { threadStatusKey, threadStatusMessageIdHash, type LeaderThreadStatus } from "../shared/thread-status-marker.js";
import { buildProjectionAttentionRecords, collectMessageAttentionRecords } from "../shared/leader-projection.js";
import { getUserVisibleSessionNotifications } from "./bridge/session-notification-controller.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { BoardRow, SessionAttentionRecord } from "./session-types.js";
import type { SyncedProjectionDefinition } from "./synced-projection-runtime.js";

const ACTIVE_ATTENTION_STATES = new Set<SessionAttentionRecord["state"]>(["unresolved", "seen", "reopened"]);
const COMPLETED_STATUSES = new Set(["done", "completed", "needs_verification"]);
const EMPTY_ATTENTION: LeaderThreadTabsProjectionAttention = {
  needsInput: false,
  mutedNeedsInput: false,
  reviewUnread: false,
  updatedAt: 0,
};

type MessageAttentionCacheEntry = {
  history: Session["messageHistory"];
  historyLength: number;
  tail: Session["messageHistory"][number] | undefined;
  tailContent: unknown;
  tailMetadata: unknown;
  records: SessionAttentionRecord[];
};

const messageAttentionCache = new WeakMap<Session, MessageAttentionCacheEntry>();

function messageAttentionRecords(session: Session): SessionAttentionRecord[] {
  const history = session.messageHistory;
  const tail = history[history.length - 1];
  const tailContent = (tail as { content?: unknown } | undefined)?.content;
  const tailMetadata = (tail as { metadata?: unknown } | undefined)?.metadata;
  const cached = messageAttentionCache.get(session);
  if (
    cached?.history === history &&
    cached.historyLength === history.length &&
    cached.tail === tail &&
    cached.tailContent === tailContent &&
    cached.tailMetadata === tailMetadata
  ) {
    return cached.records;
  }
  const records = collectMessageAttentionRecords(session.id, history);
  messageAttentionCache.set(session, {
    history,
    historyLength: history.length,
    tail,
    tailContent,
    tailMetadata,
    records,
  });
  return records;
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

function normalizeProjectionThreadKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key || key === "main" || key === "all") return null;
  if (key.length > LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) return null;
  return shouldPersistLeaderThreadTab(key) ? key : null;
}

function normalizeStatusThreadKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = threadStatusKey(value);
  if (!key || key.length > LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) return null;
  return key === "main" || /^q-\d+$/i.test(key) ? key : null;
}

function normalizeAttentionThreadKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = threadStatusKey(value);
  if (key === "main") return key;
  return normalizeProjectionThreadKey(key);
}

function sortedBoardRows(rows: Iterable<BoardRow>): BoardRow[] {
  return [...rows].sort((left, right) => left.createdAt - right.createdAt || left.questId.localeCompare(right.questId));
}

function sortedCompletedBoardRows(rows: Iterable<BoardRow>): BoardRow[] {
  return [...rows].sort(
    (left, right) => (right.completedAt ?? 0) - (left.completedAt ?? 0) || left.questId.localeCompare(right.questId),
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

function isActiveBoardCandidate(row: BoardRow): boolean {
  return (
    !isQueuedRow(row) &&
    !isProposedRow(row) &&
    !isCompletedRow(row) &&
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
    const matchingClaims = claims.filter((claim) => row.worker === claim.workerSessionId);
    const exactClaims = matchingClaims.filter((claim) => claim.leaderSessionId === session.id);
    const legacyClaims = matchingClaims.filter((claim) => !claim.leaderSessionId);
    const completed = completedBoard || isCompletedRow(row);
    const claimRank = !completed
      ? exactClaims.some((claim) => claim.active)
        ? 4
        : legacyClaims.some((claim) => claim.active)
          ? 3
          : exactClaims.length > 0
            ? 2
            : legacyClaims.length > 0
              ? 1
              : 0
      : exactClaims.length > 0
        ? 2
        : legacyClaims.length > 0
          ? 1
          : 0;
    const candidate: CurrentQuestRow = {
      row,
      sourceLeaderSessionId: session.id,
      completed,
      claimRank,
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

type ProjectionTabCandidateKind = "needs-input" | "primary" | "review";

interface ProjectionTabCandidate {
  threadKey: string;
  eventAt: number;
  kind: ProjectionTabCandidateKind;
}

function isMutedNeedsInputRecord(record: SessionAttentionRecord): boolean {
  return record.state === "muted" && record.type === "needs_input" && record.priority === "needs_input";
}

function isBlueReviewRecord(record: SessionAttentionRecord): boolean {
  return (
    isAttentionActive(record) &&
    record.source.kind === "notification" &&
    (record.type === "review_ready" || record.priority === "review" || record.priority === "completed")
  );
}

function isPrimaryThreadTabRecord(record: SessionAttentionRecord): boolean {
  return (
    isAttentionActive(record) &&
    record.priority !== "review" &&
    record.priority !== "completed" &&
    record.type !== "review_ready" &&
    record.type !== "quest_completed_recent"
  );
}

function projectionTabCandidateKind(record: SessionAttentionRecord): ProjectionTabCandidateKind | null {
  if (record.type === "needs_input" && record.priority === "needs_input") {
    return isAttentionActive(record) || isMutedNeedsInputRecord(record) ? "needs-input" : null;
  }
  if (isBlueReviewRecord(record)) return "review";
  return isPrimaryThreadTabRecord(record) ? "primary" : null;
}

function projectionTabCandidates(records: ReadonlyArray<SessionAttentionRecord>): ProjectionTabCandidate[] {
  const byKey = new Map<string, ProjectionTabCandidate>();
  for (const record of records) {
    const kind = projectionTabCandidateKind(record);
    if (!kind) continue;
    const threadKey = normalizeAttentionThreadKey(
      record.route.threadKey || record.threadKey || record.questId || "main",
    );
    if (!threadKey || threadKey === "main" || !normalizeProjectionThreadKey(threadKey)) continue;
    const eventAt = nonNegativeNumber(record.updatedAt);
    const existing = byKey.get(threadKey);
    const rank = kind === "primary" ? 3 : kind === "needs-input" ? 2 : 1;
    const existingRank = existing?.kind === "primary" ? 3 : existing?.kind === "needs-input" ? 2 : 1;
    if (existing && (existing.eventAt > eventAt || (existing.eventAt === eventAt && existingRank >= rank))) continue;
    byKey.set(threadKey, { threadKey, eventAt, kind });
  }
  return [...byKey.values()];
}

function shouldRepositionServerCandidate(
  existingState: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
  eventAt: number,
): boolean {
  return existingState?.explicitOrderUpdatedAt === undefined || eventAt > existingState.explicitOrderUpdatedAt;
}

function buildEffectiveOpenKeys(
  existingState: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
  boardRows: ReadonlyArray<BoardRow>,
  attentionRecords: ReadonlyArray<SessionAttentionRecord>,
): { orderedOpenThreadKeys: string[]; candidateUpdatedAt: number } {
  let orderedOpenThreadKeys = (existingState?.orderedOpenThreadKeys ?? [])
    .map(normalizeProjectionThreadKey)
    .filter((key): key is string => !!key)
    .slice(0, LEADER_THREAD_TABS_PROJECTION_MAX_TABS);
  let candidateUpdatedAt = 0;

  const candidates = projectionTabCandidates(attentionRecords);
  const candidatesByKind = (kind: ProjectionTabCandidateKind) =>
    candidates
      .filter((candidate) => candidate.kind === kind)
      .sort((left, right) => left.eventAt - right.eventAt || left.threadKey.localeCompare(right.threadKey));

  const placeFirst = (threadKey: string, eventAt: number, repositionExisting: boolean) => {
    const alreadyOpen = orderedOpenThreadKeys.includes(threadKey);
    if (!alreadyOpen && !canServerCandidateOpenThread(existingState, threadKey, eventAt)) return;
    if (alreadyOpen && !repositionExisting) return;
    const next = placeLeaderOpenThreadTabKey(orderedOpenThreadKeys, threadKey, "first").slice(
      0,
      LEADER_THREAD_TABS_PROJECTION_MAX_TABS,
    );
    if (next.every((key, index) => key === orderedOpenThreadKeys[index])) return;
    orderedOpenThreadKeys = next;
    candidateUpdatedAt = Math.max(candidateUpdatedAt, eventAt);
  };

  const placeLast = (threadKey: string, eventAt: number) => {
    if (orderedOpenThreadKeys.includes(threadKey)) return;
    if (!canServerCandidateOpenThread(existingState, threadKey, eventAt)) return;
    if (orderedOpenThreadKeys.length >= LEADER_THREAD_TABS_PROJECTION_MAX_TABS) return;
    orderedOpenThreadKeys = [...orderedOpenThreadKeys, threadKey];
    candidateUpdatedAt = Math.max(candidateUpdatedAt, eventAt);
  };

  const needsInputCandidates = candidatesByKind("needs-input");
  const activeBoardCandidates = boardRows.filter(isActiveBoardCandidate).map((row) => ({
    threadKey: normalizeProjectionThreadKey(row.questId)!,
    eventAt: nonNegativeNumber(row.threadTabActivatedAt ?? row.createdAt),
  }));

  // Durable order already records every accepted edge-triggered promotion.
  // Derivation may insert genuinely missing candidates, but it must never sort
  // or reposition an existing tab from its current visual state.

  // Missing needs-input candidates retain the established first-position
  // behavior, except when a newer explicit user ordering already owns the rail.
  for (const candidate of needsInputCandidates) {
    if (orderedOpenThreadKeys.includes(candidate.threadKey)) continue;
    if (shouldRepositionServerCandidate(existingState, candidate.eventAt)) {
      placeFirst(candidate.threadKey, candidate.eventAt, false);
    } else {
      placeLast(candidate.threadKey, candidate.eventAt);
    }
  }

  // Cold/missing active work is the durable left prefix in board order. Existing
  // candidates keep the producer-authored order preserved by the group above.
  for (const candidate of [...activeBoardCandidates].reverse()) {
    if (orderedOpenThreadKeys.includes(candidate.threadKey)) continue;
    if (shouldRepositionServerCandidate(existingState, candidate.eventAt)) {
      placeFirst(candidate.threadKey, candidate.eventAt, false);
    } else {
      placeLast(candidate.threadKey, candidate.eventAt);
    }
  }

  // Queued and proposed rows remain visual tabs but are not authoritative open
  // operations. Keep them after active work unless already ordered explicitly.
  const deferredKeys = new Set<string>();
  for (const row of boardRows) {
    if (isCompletedRow(row) || (!isQueuedRow(row) && !isProposedRow(row))) continue;
    const threadKey = normalizeProjectionThreadKey(row.questId);
    if (!threadKey) continue;
    deferredKeys.add(threadKey);
    placeLast(threadKey, nonNegativeNumber(row.threadTabActivatedAt ?? row.createdAt));
  }

  // Review-only tabs sit ahead of synthetic queued/proposed rows without
  // disturbing already-open user order.
  for (const candidate of candidatesByKind("review")) {
    if (orderedOpenThreadKeys.includes(candidate.threadKey)) continue;
    if (!canServerCandidateOpenThread(existingState, candidate.threadKey, candidate.eventAt)) continue;
    if (shouldRepositionServerCandidate(existingState, candidate.eventAt)) {
      orderedOpenThreadKeys = placeLeaderOpenThreadTabBeforeKeys(
        orderedOpenThreadKeys,
        candidate.threadKey,
        deferredKeys,
      );
    } else {
      placeLast(candidate.threadKey, candidate.eventAt);
      continue;
    }
    candidateUpdatedAt = Math.max(candidateUpdatedAt, candidate.eventAt);
  }

  // Rework, blocked, created, and other primary attention edges are the
  // leading transient candidates. Older restored records respect newer user
  // order and append instead of unexpectedly reshuffling it.
  for (const candidate of candidatesByKind("primary")) {
    if (orderedOpenThreadKeys.includes(candidate.threadKey)) continue;
    if (shouldRepositionServerCandidate(existingState, candidate.eventAt)) {
      placeFirst(candidate.threadKey, candidate.eventAt, false);
    } else {
      placeLast(candidate.threadKey, candidate.eventAt);
    }
  }

  return { orderedOpenThreadKeys, candidateUpdatedAt };
}

function projectedTombstones(
  existingState: ReturnType<typeof normalizeLeaderOpenThreadTabsState>,
  relevantKeys: ReadonlySet<string>,
): LeaderThreadTabsProjectionTabState["closedThreadTombstones"] {
  if (!existingState) return [];
  const eligible = existingState.closedThreadTombstones.filter(
    (entry) => normalizeProjectionThreadKey(entry.threadKey) !== null,
  );
  const relevant = eligible.filter((entry) => relevantKeys.has(entry.threadKey));
  const recent = eligible.filter((entry) => !relevantKeys.has(entry.threadKey));
  return [...relevant, ...recent].slice(0, LEADER_THREAD_TABS_PROJECTION_MAX_TOMBSTONES).map((entry) => ({
    threadKey: entry.threadKey,
    closedAt: nonNegativeNumber(entry.closedAt),
  }));
}

function isAttentionActive(record: SessionAttentionRecord): boolean {
  return ACTIVE_ATTENTION_STATES.has(record.state);
}

function isQuestIdFallbackTitle(title: string, threadKey: string, questId?: string): boolean {
  const normalized = title.trim().toLowerCase();
  const ids = new Set([threadKey, questId?.trim().toLowerCase()].filter((value): value is string => !!value));
  if (ids.has(normalized)) return true;
  for (const id of ids) {
    if (normalized === `${id}: ${id}` || normalized === `${id} ${id}`) return true;
  }
  return false;
}

function attentionTitleInputs(records: ReadonlyArray<SessionAttentionRecord>): Map<string, string> {
  const result = new Map<string, { title: string; rank: number; updatedAt: number }>();
  for (const record of records) {
    const key = normalizeAttentionThreadKey(record.route.threadKey || record.threadKey || record.questId || "main");
    if (!key || key === "main") continue;
    const title = boundedText(record.title, LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH).trim();
    if (!title || isQuestIdFallbackTitle(title, key, record.questId)) continue;
    const rank =
      record.source.kind === "quest" || record.source.kind === "board" || record.source.kind === "message"
        ? 3
        : record.type === "needs_input"
          ? 2
          : 1;
    const updatedAt = nonNegativeNumber(record.updatedAt);
    const existing = result.get(key);
    if (existing && (existing.rank > rank || (existing.rank === rank && existing.updatedAt >= updatedAt))) continue;
    result.set(key, { title, rank, updatedAt });
  }
  return new Map([...result].map(([key, value]) => [key, value.title]));
}

function attentionByThread(
  records: ReadonlyArray<SessionAttentionRecord>,
): Map<string, LeaderThreadTabsProjectionAttention> {
  const result = new Map<string, LeaderThreadTabsProjectionAttention>();
  for (const record of records) {
    const key = normalizeAttentionThreadKey(record.route.threadKey || record.threadKey || record.questId || "main");
    if (!key) continue;
    const current = result.get(key) ?? EMPTY_ATTENTION;
    const active = isAttentionActive(record);
    const needsInput =
      current.needsInput ||
      (active && record.type === "needs_input" && record.priority === "needs_input" && record.state !== "muted");
    const mutedNeedsInput =
      current.mutedNeedsInput ||
      (record.state === "muted" && record.type === "needs_input" && record.priority === "needs_input");
    const reviewUnread =
      current.reviewUnread ||
      (active &&
        record.source.kind === "notification" &&
        (record.type === "review_ready" || record.priority === "review" || record.priority === "completed"));
    result.set(key, {
      needsInput,
      mutedNeedsInput,
      reviewUnread,
      updatedAt: Math.max(current.updatedAt, nonNegativeNumber(record.updatedAt)),
    });
  }
  return result;
}

function compactJourney(row: BoardRow | undefined): LeaderThreadTabsProjectionJourney | null {
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
  };
}

function compactStatus(source: LeaderThreadStatus, key: string): LeaderThreadStatus {
  const kind = source.kind === "waiting" ? "waiting" : "ready";
  const questId = boundedNullableText(source.questId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH);
  return {
    kind,
    label: kind === "waiting" ? "Thread Waiting" : "Thread Ready",
    threadKey: key,
    ...(questId ? { questId } : {}),
    summary: boundedText(source.summary, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH),
    messageId: boundedText(source.messageId, LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH),
    ...(source.messageIdHash ? { messageIdHash: source.messageIdHash } : {}),
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
      ...(segment.color ? { color: boundedText(segment.color, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) } : {}),
      ...(segment.colorName
        ? { colorName: boundedText(segment.colorName, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) }
        : {}),
    }));
}

function serializedValueBytes(value: LeaderThreadTabsProjectionValue): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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

function compactValueToByteLimit(value: LeaderThreadTabsProjectionValue): LeaderThreadTabsProjectionValue {
  if (serializedValueBytes(value) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) return value;
  const compacted: LeaderThreadTabsProjectionValue = {
    ...value,
    tabs: value.tabs.map((tab) => ({ ...tab, title: tab.title?.slice(0, 80) || null })),
    threadStatuses: Object.fromEntries(
      Object.entries(value.threadStatuses).map(([key, status]) => [
        key,
        { ...status, summary: status.summary.slice(0, 100) },
      ]),
    ),
  };
  if (serializedValueBytes(compacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) return compacted;

  const displayCompacted: LeaderThreadTabsProjectionValue = {
    ...compacted,
    tabs: compacted.tabs.map((tab) => ({ ...tab, title: null })),
    threadStatuses: Object.fromEntries(
      Object.entries(compacted.threadStatuses).map(([key, status]) => [
        key,
        { ...status, summary: status.summary.slice(0, 48) },
      ]),
    ),
    activePhaseSummary: [],
  };
  if (serializedValueBytes(displayCompacted) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES) {
    return displayCompacted;
  }

  // Pathological long custom keys can still exceed the cap after all
  // display-only text is removed. Preserve Ready correlation through a stable
  // full-ID fingerprint, then shed nonessential phase/status detail and the
  // oldest projected tombstones. Raw server state retains every tombstone.
  let minimal: LeaderThreadTabsProjectionValue = {
    ...displayCompacted,
    tabs: displayCompacted.tabs.map((tab) => ({
      ...tab,
      title: null,
      boardStatus: null,
      journey: null,
    })),
    threadStatuses: Object.fromEntries(
      Object.entries(displayCompacted.threadStatuses).map(([key, status]) => [key, minimalStatusIdentity(status)]),
    ),
  };
  while (
    serializedValueBytes(minimal) > LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES &&
    (minimal.tabState?.closedThreadTombstones.length ?? 0) > 0
  ) {
    minimal = {
      ...minimal,
      tabState: minimal.tabState
        ? {
            ...minimal.tabState,
            closedThreadTombstones: minimal.tabState.closedThreadTombstones.slice(0, -1),
          }
        : null,
    };
  }
  return minimal;
}

export function buildLeaderThreadTabsProjectionValue(
  session: Session,
  options: {
    sessions?: Iterable<Session>;
    isCurrentQuestSourceSession?: (session: Session) => boolean;
    isCurrentQuestLeaderSession?: (session: Session) => boolean;
  } = {},
): LeaderThreadTabsProjectionValue {
  const activeBoard = sortedBoardRows(session.board.values());
  const completedBoard = sortedCompletedBoardRows(session.completedBoard.values());
  const existingState = normalizeLeaderOpenThreadTabsState(session.state.leaderOpenThreadTabs);
  const visibleNotifications = getUserVisibleSessionNotifications(session);
  const attentionRecords = buildProjectionAttentionRecords({
    leaderSessionId: session.id,
    records: [...session.attentionRecords, ...messageAttentionRecords(session)],
    notifications: visibleNotifications,
    boardRows: activeBoard,
    completedBoardRows: completedBoard,
  });
  const attention = attentionByThread(attentionRecords);
  const attentionTitles = attentionTitleInputs(attentionRecords);
  const { orderedOpenThreadKeys, candidateUpdatedAt } = buildEffectiveOpenKeys(
    existingState,
    activeBoard,
    attentionRecords,
  );
  const activeByKey = boardRowsByKey(activeBoard);
  const completedByKey = boardRowsByKey(completedBoard);
  const allSessions = new Map<string, Session>([[session.id, session]]);
  const isCurrentQuestSourceSession =
    options.isCurrentQuestSourceSession ??
    ((candidate: Session) => candidate.searchDataOnly !== true && candidate.state.hidden !== true);
  for (const candidate of options.sessions ?? []) {
    if (candidate.id === session.id || isCurrentQuestSourceSession(candidate)) allSessions.set(candidate.id, candidate);
  }
  const isCurrentQuestLeaderSession =
    options.isCurrentQuestLeaderSession ?? ((candidate: Session) => candidate.state.isOrchestrator === true);
  const currentQuestRows = currentQuestRowsByKey(
    [...allSessions.values()],
    new Set(orderedOpenThreadKeys),
    isCurrentQuestLeaderSession,
  );
  const threadStatuses = relevantThreadStatuses(session.state.leaderThreadStatuses ?? {}, orderedOpenThreadKeys);
  const relevantTombstoneKeys = new Set<string>([
    ...activeByKey.keys(),
    ...Object.keys(session.state.leaderThreadStatuses ?? {}).map(threadStatusKey),
    ...attention.keys(),
  ]);
  const tombstones = projectedTombstones(existingState, relevantTombstoneKeys);
  const tabState: LeaderThreadTabsProjectionTabState | null = existingState
    ? {
        version: LEADER_OPEN_THREAD_TABS_VERSION,
        orderedOpenThreadKeys,
        closedThreadTombstones: tombstones,
        updatedAt: Math.max(nonNegativeNumber(existingState?.updatedAt), candidateUpdatedAt),
        ...(existingState?.migratedFromLocalStorageAt !== undefined
          ? { migratedFromLocalStorageAt: nonNegativeNumber(existingState.migratedFromLocalStorageAt) }
          : {}),
        ...(existingState?.explicitOrderUpdatedAt !== undefined
          ? { explicitOrderUpdatedAt: nonNegativeNumber(existingState.explicitOrderUpdatedAt) }
          : {}),
      }
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
    const isActive = !!row && !completed && !queued && !proposed;
    const tabAttention = attention.get(threadKey) ?? EMPTY_ATTENTION;
    const status = threadStatuses[threadKey];
    return {
      threadKey,
      questId: /^q-\d+$/i.test(threadKey) ? threadKey : null,
      title: boundedNullableText(
        row?.title ?? attentionTitles.get(threadKey),
        LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH,
      ),
      boardStatus: boundedNullableText(row?.status, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH),
      journey: compactJourney(row),
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
      completed,
      canClose: !localActiveRow,
      attention: { ...tabAttention },
      updatedAt: Math.max(
        nonNegativeNumber(row?.completedAt),
        nonNegativeNumber(row?.updatedAt),
        tabAttention.updatedAt,
        nonNegativeNumber(status?.updatedAt),
      ),
    };
  });

  return compactValueToByteLimit({
    currentQuestStateVersion: 1,
    tabState,
    tabs,
    mainAttention: { ...(attention.get("main") ?? EMPTY_ATTENTION) },
    threadStatuses,
    activePhaseSummary: compactActivePhaseSummary(activeBoard),
  });
}

export function createLeaderThreadTabsProjectionDefinition<TSubscriber>(
  deps: LeaderThreadTabsProjectionDefinitionDeps<TSubscriber>,
): SyncedProjectionDefinition<Session, LeaderThreadTabsProjectionValue, LeaderThreadTabsProjectionValue, TSubscriber> {
  return {
    projection: LEADER_THREAD_TABS_PROJECTION,
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
    selectDependencies: (session) =>
      buildLeaderThreadTabsProjectionValue(session, {
        sessions: deps.listSessions?.(),
        isCurrentQuestSourceSession: deps.isCurrentQuestSourceSession,
        isCurrentQuestLeaderSession: deps.isLeaderSession,
      }),
    dependenciesEqual: leaderThreadTabsProjectionEqual,
    derive: (_session, _key, dependencies) => dependencies,
    valueEqual: leaderThreadTabsProjectionEqual,
    authorizeSubscription: (subscriber, _key, session) =>
      deps.isLeaderSession(session) && deps.authorizeSubscription(subscriber, session),
    maxValueBytes: LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
  };
}
