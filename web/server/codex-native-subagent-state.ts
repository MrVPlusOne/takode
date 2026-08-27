import { createHash } from "node:crypto";
import type {
  CodexNativeSubagentCoverage,
  CodexNativeSubagentOwnership,
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatus,
  CodexNativeSubagentStatusCounts,
  CodexNativeSubagentTranscriptAvailability,
  CodexNativeSubagentTurnAggregate,
} from "../shared/codex-native-subagent-types.js";

const REGISTRY_VERSION = 1 as const;
const MAX_AGENT_PATH_LENGTH = 512;
const MAX_LABEL_LENGTH = 160;
const MAX_ACTIVITY_EVENT_IDS = 256;

const ACTIVE_STATUSES = new Set<CodexNativeSubagentStatus>(["starting", "working", "waiting"]);
const TERMINAL_STATUSES = new Set<CodexNativeSubagentStatus>(["done", "failed", "interrupted"]);
const TRANSCRIPT_AVAILABILITIES = new Set<CodexNativeSubagentTranscriptAvailability>([
  "available",
  "partial",
  "unavailable",
]);

type NormalizedThreadStatus = "active" | "waiting" | "idle" | "not_loaded" | "closed" | "system_error" | "unknown";

type FirstTaskOutcome = "done" | "failed" | "interrupted" | "unknown";

interface EvidenceStamp {
  observedAt: number;
  sequence: number;
}

interface ThreadStatusEvidence extends EvidenceStamp {
  status: NormalizedThreadStatus;
}

interface TurnEvidence extends EvidenceStamp {
  providerTurnId: string;
  startedAt?: number;
  completedAt?: number;
  outcome?: FirstTaskOutcome;
  outcomeConflict?: boolean;
}

/**
 * Persisted server-only child record. Provider IDs deliberately stay out of the
 * shared/browser contracts.
 */
export interface CodexNativeSubagentRecord {
  publicChildId: string;
  providerParentThreadId?: string;
  spawnRootProviderTurnId?: string;
  feedRootTurnKey?: string;
  agentPath: string;
  nickname?: string;
  role?: string;
  depth?: number;
  spawnOrder: number;
  startedAt?: number;
  lastActivityAt?: number;
  status: CodexNativeSubagentStatus;
  statusObservedAt: number;
  endedAt?: number;
  transcriptAvailability: CodexNativeSubagentTranscriptAvailability;
  followUpAvailable?: boolean;
  spawnEvidence?: EvidenceStamp;
  interruptedEvidence?: EvidenceStamp;
  threadStatusEvidence?: ThreadStatusEvidence;
  turnsByProviderTurnId: Record<string, TurnEvidence>;
  firstTaskProviderTurnId?: string;
  firstTaskOutcome?: FirstTaskOutcome;
  restoreUnknownSequence?: number;
  seenActivityEventIds: string[];
}

/** JSON-serializable, persisted server authority keyed by provider thread ID. */
export interface CodexNativeSubagentRegistry {
  version: typeof REGISTRY_VERSION;
  sessionId: string;
  revision: number;
  coverage: CodexNativeSubagentCoverage;
  nextSpawnOrder: number;
  nextEvidenceSequence: number;
  childrenByProviderThreadId: Record<string, CodexNativeSubagentRecord>;
  turnCoverageByRootTurnId: Record<string, CodexNativeSubagentCoverage>;
}

interface ProviderEventBase {
  /** Provider/event receipt timestamp in milliseconds. */
  observedAt?: number;
}

export interface CodexNativeSubagentActivityEvent extends ProviderEventBase {
  type: "activity";
  kind: "started" | "interacted" | "interrupted";
  providerThreadId: string;
  providerParentThreadId?: string;
  /** Stable provider item/call ID used to make live/replay application idempotent. */
  providerEventId?: string;
  /** Root provider turn that caused the spawn. Used only for kind=started. */
  rootProviderTurnId?: string;
  agentPath?: string;
  nickname?: string;
  role?: string;
  depth?: number;
  startedAt?: number;
}

export interface CodexNativeSubagentThreadMetadataEvent extends ProviderEventBase {
  type: "thread_metadata";
  /** Raw provider Thread-shaped metadata. Only a verified subAgent thread_spawn source is accepted. */
  thread: Record<string, unknown>;
  /** Optional spawn-turn association supplied by a bounded discovery caller. */
  rootProviderTurnId?: string;
}

export interface CodexNativeSubagentThreadStatusEvent extends ProviderEventBase {
  type: "thread_status";
  providerThreadId: string;
  status: unknown;
}

export interface CodexNativeSubagentTurnStartedEvent extends ProviderEventBase {
  type: "turn_started";
  providerThreadId: string;
  providerTurnId: string;
  startedAt?: number;
}

export interface CodexNativeSubagentTurnCompletedEvent extends ProviderEventBase {
  type: "turn_completed";
  providerThreadId: string;
  providerTurnId: string;
  status: unknown;
  startedAt?: number;
  completedAt?: number;
}

export interface CodexNativeSubagentChildErrorEvent extends ProviderEventBase {
  type: "child_error";
  providerThreadId: string;
  providerTurnId?: string;
}

export interface CodexNativeSubagentDiscoveryCompleteEvent extends ProviderEventBase {
  type: "discovery_complete";
}

export interface CodexNativeSubagentDiscoveryPartialEvent extends ProviderEventBase {
  type: "discovery_partial";
}

export interface CodexNativeSubagentOwnedMessageObservedEvent extends ProviderEventBase {
  type: "owned_message_observed";
  providerThreadId: string;
  providerMessageId?: string;
  transcriptAvailability?: Exclude<CodexNativeSubagentTranscriptAvailability, "unavailable">;
}

/** Normalized server-only provider events consumed by the registry. */
export type CodexNativeSubagentProviderEvent =
  | CodexNativeSubagentActivityEvent
  | CodexNativeSubagentThreadMetadataEvent
  | CodexNativeSubagentThreadStatusEvent
  | CodexNativeSubagentTurnStartedEvent
  | CodexNativeSubagentTurnCompletedEvent
  | CodexNativeSubagentChildErrorEvent
  | CodexNativeSubagentDiscoveryCompleteEvent
  | CodexNativeSubagentDiscoveryPartialEvent
  | CodexNativeSubagentOwnedMessageObservedEvent;

export type CodexNativeSubagentRootTurnResolver = (rootProviderTurnId: string) => string | undefined;

export interface ApplyCodexNativeSubagentEventOptions {
  resolveFeedRootTurnKey?: CodexNativeSubagentRootTurnResolver;
  now?: number | (() => number);
}

export interface ApplyCodexNativeSubagentEventResult {
  changed: boolean;
  revision: number;
  childId?: string;
}

/** Server-only adapter lookup value; the map key remains the provider thread ID. */
export interface CodexNativeSubagentAdapterOwnership extends CodexNativeSubagentOwnership {
  rootProviderTurnId?: string;
}

export function createCodexNativeSubagentRegistry(
  sessionId: string,
  options: { coverage?: CodexNativeSubagentCoverage } = {},
): CodexNativeSubagentRegistry {
  return {
    version: REGISTRY_VERSION,
    sessionId,
    revision: 0,
    coverage: options.coverage ?? "partial",
    nextSpawnOrder: 1,
    nextEvidenceSequence: 1,
    childrenByProviderThreadId: {},
    turnCoverageByRootTurnId: {},
  };
}

/**
 * Rebuilds a persisted registry into the current shape and drops all unknown
 * fields. The caller-provided session ID is authoritative, and opaque IDs are
 * always recomputed so copied/corrupt records cannot cross session boundaries.
 */
export function normalizeCodexNativeSubagentRegistry(value: unknown, sessionId: string): CodexNativeSubagentRegistry {
  const input = asRecord(value);
  const registry = createCodexNativeSubagentRegistry(sessionId, {
    coverage: normalizeCoverage(input?.coverage),
  });
  if (!input) return registry;

  registry.revision = nonNegativeInteger(input.revision) ?? 0;
  registry.nextSpawnOrder = positiveInteger(input.nextSpawnOrder) ?? 1;
  registry.nextEvidenceSequence = positiveInteger(input.nextEvidenceSequence) ?? 1;

  const children = asRecord(input.childrenByProviderThreadId);
  if (children) {
    for (const [providerThreadId, rawRecord] of Object.entries(children)) {
      if (!providerThreadId.trim()) continue;
      const record = normalizeRecord(rawRecord, sessionId, providerThreadId);
      if (!record) continue;
      registry.childrenByProviderThreadId[providerThreadId] = record;
      registry.nextSpawnOrder = Math.max(registry.nextSpawnOrder, record.spawnOrder + 1);
      registry.nextEvidenceSequence = Math.max(registry.nextEvidenceSequence, maxRecordSequence(record) + 1);
    }
  }

  const turnCoverage = asRecord(input.turnCoverageByRootTurnId);
  if (turnCoverage) {
    for (const [rootTurnId, rawCoverage] of Object.entries(turnCoverage)) {
      const normalizedRootTurnId = boundedString(rootTurnId, MAX_LABEL_LENGTH);
      if (!normalizedRootTurnId) continue;
      registry.turnCoverageByRootTurnId[normalizedRootTurnId] = normalizeCoverage(rawCoverage);
    }
  }

  return registry;
}

export function applyCodexNativeSubagentEvent(
  registry: CodexNativeSubagentRegistry,
  event: CodexNativeSubagentProviderEvent,
  options: ApplyCodexNativeSubagentEventOptions = {},
): ApplyCodexNativeSubagentEventResult {
  const observedAt = normalizeTimestamp(event.observedAt) ?? readNow(options.now);
  let changed = false;
  let record: CodexNativeSubagentRecord | undefined;

  if (event.type === "discovery_complete" || event.type === "discovery_partial") {
    const coverage = event.type === "discovery_complete" ? "complete" : "partial";
    if (registry.coverage !== coverage) {
      registry.coverage = coverage;
      changed = true;
    }
    return finishApply(registry, changed);
  }

  if (event.type === "activity") {
    const providerThreadId = cleanProviderId(event.providerThreadId);
    if (!providerThreadId) return finishApply(registry, false);
    const rootProviderTurnId = event.kind === "started" ? cleanProviderId(event.rootProviderTurnId) : undefined;
    const parentProviderThreadId = cleanProviderId(event.providerParentThreadId);
    ({ record, changed } = getOrCreateRecord(registry, providerThreadId, observedAt, {
      parentProviderThreadId,
      rootProviderTurnId,
      resolveFeedRootTurnKey: options.resolveFeedRootTurnKey,
    }));

    changed =
      enrichRecord(registry, record, {
        parentProviderThreadId,
        rootProviderTurnId,
        resolveFeedRootTurnKey: options.resolveFeedRootTurnKey,
        agentPath: event.agentPath,
        nickname: event.nickname,
        role: event.role,
        depth: event.depth,
        startedAt: event.startedAt,
        authoritativeRoot: event.kind === "started" && !!rootProviderTurnId,
      }) || changed;

    const eventId = boundedString(event.providerEventId, MAX_LABEL_LENGTH);
    const eventKey = eventId ? `${event.kind}:${eventId}` : undefined;
    const duplicate = eventKey ? record.seenActivityEventIds.includes(eventKey) : false;
    if (!duplicate) {
      if (eventKey) {
        record.seenActivityEventIds = [...record.seenActivityEventIds, eventKey].slice(-MAX_ACTIVITY_EVENT_IDS);
        changed = true;
      }
      if (event.kind === "started" && !record.spawnEvidence) {
        record.spawnEvidence = makeStamp(registry, normalizeTimestamp(event.startedAt) ?? observedAt);
        changed = true;
      }
      if (event.kind === "interrupted") {
        if (isNewerEvidence(record.interruptedEvidence, observedAt)) {
          record.interruptedEvidence = makeStamp(registry, observedAt);
          changed = true;
        }
        if (!record.firstTaskOutcome) {
          record.firstTaskOutcome = "interrupted";
          changed = true;
        }
      }
      if (updateMaxTimestamp(record, "lastActivityAt", observedAt)) changed = true;
    }
  } else if (event.type === "thread_metadata") {
    const metadata = extractVerifiedSpawnMetadata(event.thread);
    if (!metadata) return finishApply(registry, false);
    const rootProviderTurnId = cleanProviderId(event.rootProviderTurnId);
    ({ record, changed } = getOrCreateRecord(registry, metadata.providerThreadId, observedAt, {
      parentProviderThreadId: metadata.parentProviderThreadId,
      rootProviderTurnId,
      resolveFeedRootTurnKey: options.resolveFeedRootTurnKey,
    }));
    changed =
      enrichRecord(registry, record, {
        parentProviderThreadId: metadata.parentProviderThreadId,
        rootProviderTurnId,
        resolveFeedRootTurnKey: options.resolveFeedRootTurnKey,
        agentPath: metadata.agentPath,
        nickname: metadata.nickname,
        role: metadata.role,
        depth: metadata.depth,
        startedAt: metadata.startedAt,
        followUpAvailable: metadata.followUpAvailable,
        transcriptAvailability: metadata.transcriptAvailability,
      }) || changed;
    if (metadata.status !== undefined) {
      changed = applyThreadStatusEvidence(registry, record, metadata.status, observedAt) || changed;
    }
  } else {
    const providerThreadId = cleanProviderId(event.providerThreadId);
    if (!providerThreadId) return finishApply(registry, false);
    record = registry.childrenByProviderThreadId[providerThreadId];
    // Child-only notifications do not establish a native spawn relationship.
    if (!record) return finishApply(registry, false);
    changed = refreshFeedRootTurnKey(record, options.resolveFeedRootTurnKey) || changed;

    switch (event.type) {
      case "thread_status":
        changed = applyThreadStatusEvidence(registry, record, event.status, observedAt) || changed;
        break;
      case "turn_started":
        changed = applyTurnStarted(registry, record, event, observedAt) || changed;
        break;
      case "turn_completed":
        changed = applyTurnCompleted(registry, record, event, observedAt) || changed;
        break;
      case "child_error": {
        const providerTurnId = cleanProviderId(event.providerTurnId);
        if (!record.firstTaskProviderTurnId && providerTurnId) {
          record.firstTaskProviderTurnId = providerTurnId;
          changed = true;
        }
        const existing = record.threadStatusEvidence;
        if (
          !(existing?.status === "system_error" && existing.observedAt >= observedAt) &&
          !(existing && existing.observedAt > observedAt)
        ) {
          record.threadStatusEvidence = {
            status: "system_error",
            ...makeStamp(registry, observedAt),
          };
          changed = true;
        }
        if (!record.firstTaskOutcome) {
          record.firstTaskOutcome = "failed";
          changed = true;
        }
        break;
      }
      case "owned_message_observed": {
        const availability = event.transcriptAvailability ?? "available";
        if (transcriptRank(availability) > transcriptRank(record.transcriptAvailability)) {
          record.transcriptAvailability = availability;
          changed = true;
        }
        if (updateMaxTimestamp(record, "lastActivityAt", observedAt)) changed = true;
        break;
      }
    }
  }

  if (record && recomputeChildStatus(record)) changed = true;
  return finishApply(registry, changed, record?.publicChildId);
}

export function deriveCodexNativeSubagentSnapshot(registry: CodexNativeSubagentRegistry): CodexNativeSubagentSnapshot {
  const allRecords = Object.values(registry.childrenByProviderThreadId).sort(
    (left, right) => left.spawnOrder - right.spawnOrder || left.publicChildId.localeCompare(right.publicChildId),
  );
  const records = allRecords.filter(
    (record): record is CodexNativeSubagentRecord & { feedRootTurnKey: string } => !!record.feedRootTurnKey,
  );
  const hasUnresolvedRoot = records.length !== allRecords.length;
  const coverage: CodexNativeSubagentCoverage =
    registry.coverage === "complete" && !hasUnresolvedRoot ? "complete" : "partial";
  const statusCounts = createStatusCounts();

  for (const record of records) statusCounts[record.status] += 1;

  const children = records.map((record) => {
    const parent = record.providerParentThreadId
      ? registry.childrenByProviderThreadId[record.providerParentThreadId]
      : undefined;
    const summary = {
      childId: record.publicChildId,
      ...(parent ? { parentChildId: parent.publicChildId } : {}),
      rootTurnId: record.feedRootTurnKey,
      agentPath: record.agentPath,
      displayName: displayNameForRecord(record),
      ...(record.nickname ? { nickname: record.nickname } : {}),
      ...(record.role ? { role: record.role } : {}),
      depth: record.depth ?? (parent ? (parent.depth ?? 1) + 1 : 1),
      spawnOrder: record.spawnOrder,
      ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : {}),
      ...(record.endedAt !== undefined ? { endedAt: record.endedAt } : {}),
      ...(record.lastActivityAt !== undefined ? { lastActivityAt: record.lastActivityAt } : {}),
      status: record.status,
      statusObservedAt: record.statusObservedAt,
      transcriptAvailability: record.transcriptAvailability,
      ...(record.followUpAvailable !== undefined ? { followUpAvailable: record.followUpAvailable } : {}),
    };
    return summary;
  });

  const turnRecords = new Map<string, CodexNativeSubagentRecord[]>();
  for (const record of records) {
    if (!record.feedRootTurnKey) continue;
    const existing = turnRecords.get(record.feedRootTurnKey) ?? [];
    existing.push(record);
    turnRecords.set(record.feedRootTurnKey, existing);
  }

  const turns: Record<string, CodexNativeSubagentTurnAggregate> = {};
  for (const [rootTurnId, members] of turnRecords) {
    const turnStatusCounts = createStatusCounts();
    for (const member of members) turnStatusCounts[statusForSpawnAggregate(member)] += 1;
    turns[rootTurnId] = {
      rootTurnId,
      total: members.length,
      statusCounts: turnStatusCounts,
      status: summarizeStatuses(turnStatusCounts),
      coverage: registry.turnCoverageByRootTurnId[rootTurnId] ?? coverage,
    };
  }

  return {
    revision: registry.revision,
    coverage,
    session: {
      total: records.length,
      statusCounts,
      activeCount: statusCounts.starting + statusCounts.working + statusCounts.waiting,
      unresolvedCount: statusCounts.failed + statusCounts.interrupted + statusCounts.unknown,
    },
    children,
    turns,
  };
}

/**
 * Seeds child ownership for the adapter without making provider IDs part of a
 * serializable browser DTO. Records missing an authoritative feed turn key are
 * intentionally omitted until their spawn association can be repaired.
 */
export function seedCodexNativeSubagentAdapterContext(
  registry: CodexNativeSubagentRegistry,
): Map<string, CodexNativeSubagentAdapterOwnership> {
  const result = new Map<string, CodexNativeSubagentAdapterOwnership>();
  for (const [providerThreadId, record] of Object.entries(registry.childrenByProviderThreadId)) {
    if (!record.feedRootTurnKey) continue;
    const parent = record.providerParentThreadId
      ? registry.childrenByProviderThreadId[record.providerParentThreadId]
      : undefined;
    result.set(providerThreadId, {
      childId: record.publicChildId,
      ...(parent ? { parentChildId: parent.publicChildId } : {}),
      rootTurnId: record.feedRootTurnKey,
      ...(record.spawnRootProviderTurnId ? { rootProviderTurnId: record.spawnRootProviderTurnId } : {}),
    });
  }
  return result;
}

export function resolveCodexNativeSubagentProviderThreadId(
  registry: CodexNativeSubagentRegistry,
  publicChildId: string,
): string | undefined {
  for (const [providerThreadId, record] of Object.entries(registry.childrenByProviderThreadId)) {
    if (record.publicChildId === publicChildId) return providerThreadId;
  }
  return undefined;
}

/**
 * Fail closed after restart: persisted coverage is not a fresh descendant scan,
 * and persisted Starting/Working/Waiting is not live lifecycle proof.
 */
export function markRestoredCodexNativeSubagentsUnknown(
  registry: CodexNativeSubagentRegistry,
  restoredAt = Date.now(),
): boolean {
  let changed = false;
  if (registry.coverage !== "partial") {
    registry.coverage = "partial";
    changed = true;
  }
  for (const record of Object.values(registry.childrenByProviderThreadId)) {
    if (!ACTIVE_STATUSES.has(record.status)) continue;
    record.restoreUnknownSequence = nextSequence(registry);
    if (!record.firstTaskOutcome) {
      record.firstTaskOutcome = "unknown";
      record.firstTaskProviderTurnId = latestTurn(record)?.providerTurnId;
    }
    record.status = "unknown";
    record.statusObservedAt = restoredAt;
    record.endedAt = undefined;
    changed = true;
  }
  if (changed) registry.revision += 1;
  return changed;
}

export function setCodexNativeSubagentCoverage(
  registry: CodexNativeSubagentRegistry,
  coverage: CodexNativeSubagentCoverage,
): boolean {
  if (registry.coverage === coverage) return false;
  registry.coverage = coverage;
  registry.revision += 1;
  return true;
}

export function setCodexNativeSubagentTurnCoverage(
  registry: CodexNativeSubagentRegistry,
  rootTurnId: string,
  coverage: CodexNativeSubagentCoverage,
): boolean {
  const safeRootTurnId = boundedString(rootTurnId, MAX_LABEL_LENGTH);
  if (!safeRootTurnId || registry.turnCoverageByRootTurnId[safeRootTurnId] === coverage) return false;
  registry.turnCoverageByRootTurnId[safeRootTurnId] = coverage;
  registry.revision += 1;
  return true;
}

function finishApply(
  registry: CodexNativeSubagentRegistry,
  changed: boolean,
  childId?: string,
): ApplyCodexNativeSubagentEventResult {
  if (changed) registry.revision += 1;
  return {
    changed,
    revision: registry.revision,
    ...(childId ? { childId } : {}),
  };
}

function getOrCreateRecord(
  registry: CodexNativeSubagentRegistry,
  providerThreadId: string,
  observedAt: number,
  input: {
    parentProviderThreadId?: string;
    rootProviderTurnId?: string;
    resolveFeedRootTurnKey?: CodexNativeSubagentRootTurnResolver;
  },
): { record: CodexNativeSubagentRecord; changed: boolean } {
  const existing = registry.childrenByProviderThreadId[providerThreadId];
  if (existing) {
    return {
      record: existing,
      changed: refreshFeedRootTurnKey(existing, input.resolveFeedRootTurnKey),
    };
  }

  const parent = input.parentProviderThreadId
    ? registry.childrenByProviderThreadId[input.parentProviderThreadId]
    : undefined;
  const spawnRootProviderTurnId = input.rootProviderTurnId ?? parent?.spawnRootProviderTurnId;
  const feedRootTurnKey =
    parent?.feedRootTurnKey ??
    (spawnRootProviderTurnId
      ? cleanFeedRootTurnKey(input.resolveFeedRootTurnKey?.(spawnRootProviderTurnId))
      : undefined);
  const spawnOrder = registry.nextSpawnOrder++;
  const record: CodexNativeSubagentRecord = {
    publicChildId: opaqueChildId(registry.sessionId, providerThreadId),
    ...(input.parentProviderThreadId ? { providerParentThreadId: input.parentProviderThreadId } : {}),
    ...(spawnRootProviderTurnId ? { spawnRootProviderTurnId } : {}),
    ...(feedRootTurnKey ? { feedRootTurnKey } : {}),
    agentPath: "",
    ...(parent ? { depth: (parent.depth ?? 1) + 1 } : {}),
    spawnOrder,
    status: "starting",
    statusObservedAt: observedAt,
    transcriptAvailability: "unavailable",
    turnsByProviderTurnId: {},
    seenActivityEventIds: [],
  };
  registry.childrenByProviderThreadId[providerThreadId] = record;
  return { record, changed: true };
}

function enrichRecord(
  registry: CodexNativeSubagentRegistry,
  record: CodexNativeSubagentRecord,
  input: {
    parentProviderThreadId?: string;
    rootProviderTurnId?: string;
    resolveFeedRootTurnKey?: CodexNativeSubagentRootTurnResolver;
    agentPath?: unknown;
    nickname?: unknown;
    role?: unknown;
    depth?: unknown;
    startedAt?: unknown;
    followUpAvailable?: boolean;
    transcriptAvailability?: CodexNativeSubagentTranscriptAvailability;
    authoritativeRoot?: boolean;
  },
): boolean {
  let changed = false;
  if (!record.providerParentThreadId && input.parentProviderThreadId) {
    record.providerParentThreadId = input.parentProviderThreadId;
    changed = true;
  }
  const parent = record.providerParentThreadId
    ? registry.childrenByProviderThreadId[record.providerParentThreadId]
    : undefined;
  const rootProviderTurnId = input.rootProviderTurnId ?? parent?.spawnRootProviderTurnId;
  if (input.authoritativeRoot && rootProviderTurnId && record.spawnRootProviderTurnId !== rootProviderTurnId) {
    record.spawnRootProviderTurnId = rootProviderTurnId;
    const resolved = cleanFeedRootTurnKey(input.resolveFeedRootTurnKey?.(rootProviderTurnId));
    if (resolved) record.feedRootTurnKey = resolved;
    else delete record.feedRootTurnKey;
    changed = true;
  } else if (!record.spawnRootProviderTurnId && rootProviderTurnId) {
    record.spawnRootProviderTurnId = rootProviderTurnId;
    changed = true;
  }
  if (!record.feedRootTurnKey && parent?.feedRootTurnKey) {
    record.feedRootTurnKey = parent.feedRootTurnKey;
    changed = true;
  }
  if (refreshFeedRootTurnKey(record, input.resolveFeedRootTurnKey)) changed = true;

  const agentPath = boundedString(input.agentPath, MAX_AGENT_PATH_LENGTH);
  if (!record.agentPath && agentPath) {
    record.agentPath = agentPath;
    changed = true;
  }
  const nickname = boundedString(input.nickname, MAX_LABEL_LENGTH);
  if (!record.nickname && nickname) {
    record.nickname = nickname;
    changed = true;
  }
  const role = boundedString(input.role, MAX_LABEL_LENGTH);
  if (!record.role && role) {
    record.role = role;
    changed = true;
  }
  const depth = nonNegativeInteger(input.depth);
  const inferredDepth = depth ?? (parent ? (parent.depth ?? 1) + 1 : undefined);
  if (record.depth === undefined && inferredDepth !== undefined) {
    record.depth = inferredDepth;
    changed = true;
  }
  const startedAt = normalizeTimestamp(input.startedAt);
  if (startedAt !== undefined && (record.startedAt === undefined || startedAt < record.startedAt)) {
    record.startedAt = startedAt;
    changed = true;
  }
  if (input.followUpAvailable !== undefined && record.followUpAvailable !== input.followUpAvailable) {
    record.followUpAvailable = input.followUpAvailable;
    changed = true;
  }
  if (
    input.transcriptAvailability &&
    transcriptRank(input.transcriptAvailability) > transcriptRank(record.transcriptAvailability)
  ) {
    record.transcriptAvailability = input.transcriptAvailability;
    changed = true;
  }
  return changed;
}

function refreshFeedRootTurnKey(
  record: CodexNativeSubagentRecord,
  resolver?: CodexNativeSubagentRootTurnResolver,
): boolean {
  if (record.feedRootTurnKey || !record.spawnRootProviderTurnId || !resolver) return false;
  const resolved = cleanFeedRootTurnKey(resolver(record.spawnRootProviderTurnId));
  if (!resolved) return false;
  record.feedRootTurnKey = resolved;
  return true;
}

function applyThreadStatusEvidence(
  registry: CodexNativeSubagentRegistry,
  record: CodexNativeSubagentRecord,
  rawStatus: unknown,
  observedAt: number,
): boolean {
  const status = normalizeThreadStatus(rawStatus);
  const existing = record.threadStatusEvidence;
  if (existing && existing.status === status && existing.observedAt >= observedAt) return false;
  if (existing && existing.observedAt > observedAt) return false;
  record.threadStatusEvidence = { status, ...makeStamp(registry, observedAt) };
  if (status === "system_error" && !record.firstTaskOutcome) record.firstTaskOutcome = "failed";
  if (
    (status === "idle" || status === "not_loaded" || status === "closed" || status === "unknown") &&
    !record.firstTaskOutcome &&
    (record.spawnEvidence || latestTurn(record))
  ) {
    record.firstTaskOutcome = "unknown";
    record.firstTaskProviderTurnId = latestTurn(record)?.providerTurnId;
  }
  return true;
}

function applyTurnStarted(
  registry: CodexNativeSubagentRegistry,
  record: CodexNativeSubagentRecord,
  event: CodexNativeSubagentTurnStartedEvent,
  observedAt: number,
): boolean {
  const providerTurnId = cleanProviderId(event.providerTurnId);
  if (!providerTurnId) return false;
  const startedAt = normalizeTimestamp(event.startedAt) ?? observedAt;
  let changed = false;
  let turn = record.turnsByProviderTurnId[providerTurnId];
  if (!turn) {
    turn = { providerTurnId, startedAt, ...makeStamp(registry, observedAt) };
    record.turnsByProviderTurnId[providerTurnId] = turn;
    changed = true;
  } else if (turn.startedAt === undefined || startedAt < turn.startedAt) {
    turn.startedAt = startedAt;
    turn.observedAt = Math.max(turn.observedAt, observedAt);
    changed = true;
  }
  if (!record.firstTaskProviderTurnId) {
    record.firstTaskProviderTurnId = providerTurnId;
    changed = true;
  }
  if (record.startedAt === undefined || startedAt < record.startedAt) {
    record.startedAt = startedAt;
    changed = true;
  }
  if (updateMaxTimestamp(record, "lastActivityAt", observedAt)) changed = true;
  return changed;
}

function applyTurnCompleted(
  registry: CodexNativeSubagentRegistry,
  record: CodexNativeSubagentRecord,
  event: CodexNativeSubagentTurnCompletedEvent,
  observedAt: number,
): boolean {
  const providerTurnId = cleanProviderId(event.providerTurnId);
  if (!providerTurnId) return false;
  const startedAt = normalizeTimestamp(event.startedAt);
  const completedAt = normalizeTimestamp(event.completedAt) ?? observedAt;
  const outcome = normalizeTurnOutcome(event.status);
  let changed = false;
  let terminalEvidenceChanged = false;
  let turn = record.turnsByProviderTurnId[providerTurnId];
  if (!turn) {
    turn = {
      providerTurnId,
      ...(startedAt !== undefined ? { startedAt } : {}),
      completedAt,
      outcome,
      ...makeStamp(registry, observedAt),
    };
    record.turnsByProviderTurnId[providerTurnId] = turn;
    changed = true;
  } else {
    if (startedAt !== undefined && (turn.startedAt === undefined || startedAt < turn.startedAt)) {
      turn.startedAt = startedAt;
      changed = true;
      terminalEvidenceChanged = true;
    }
    if (turn.completedAt === undefined || completedAt > turn.completedAt) {
      turn.completedAt = completedAt;
      changed = true;
      terminalEvidenceChanged = true;
    }
    if (!turn.outcome || (turn.outcome === "unknown" && outcome !== "unknown" && !turn.outcomeConflict)) {
      turn.outcome = outcome;
      changed = true;
      terminalEvidenceChanged = true;
    } else if (outcome !== "unknown" && turn.outcome !== "unknown" && turn.outcome !== outcome) {
      turn.outcome = "unknown";
      turn.outcomeConflict = true;
      changed = true;
      terminalEvidenceChanged = true;
    }
    if (terminalEvidenceChanged) {
      const stamp = makeStamp(registry, observedAt);
      turn.observedAt = stamp.observedAt;
      turn.sequence = stamp.sequence;
    }
  }

  if (!record.firstTaskProviderTurnId) {
    record.firstTaskProviderTurnId = providerTurnId;
    changed = true;
  }
  if (record.firstTaskProviderTurnId === providerTurnId) {
    const explicitOutcome = turn.outcomeConflict ? "unknown" : (turn.outcome ?? outcome);
    if (turn.outcomeConflict) {
      if (record.firstTaskOutcome !== "unknown") {
        record.firstTaskOutcome = "unknown";
        changed = true;
      }
    } else if (explicitOutcome !== "unknown" && record.firstTaskOutcome !== explicitOutcome) {
      // A terminal event for the child's first turn is stronger evidence than
      // an earlier activity interrupt or thread-scoped error.
      record.firstTaskOutcome = explicitOutcome;
      changed = true;
    } else if (!record.firstTaskOutcome) {
      record.firstTaskOutcome = explicitOutcome;
      changed = true;
    }
  }
  if (updateMaxTimestamp(record, "lastActivityAt", completedAt)) changed = true;
  return changed;
}

function recomputeChildStatus(record: CodexNativeSubagentRecord): boolean {
  const previous = `${record.status}|${record.statusObservedAt}|${record.endedAt ?? ""}`;
  const turn = latestTurn(record);
  let status: CodexNativeSubagentStatus = "starting";
  let observedAt = record.spawnEvidence?.observedAt ?? record.startedAt ?? record.statusObservedAt;
  let sequence = record.spawnEvidence?.sequence ?? 0;
  let endedAt: number | undefined;

  if (turn) {
    const turnObservedAt = Math.max(turn.observedAt, turn.completedAt ?? 0, turn.startedAt ?? 0);
    if (turn.outcome) {
      status = turn.outcome;
      endedAt = turn.completedAt ?? turn.observedAt;
    } else {
      status = "working";
    }
    observedAt = turnObservedAt;
    sequence = turn.sequence;
  }

  const interruption = record.interruptedEvidence;
  if (interruption && evidenceIsLater(interruption, { observedAt, sequence })) {
    status = "interrupted";
    observedAt = interruption.observedAt;
    sequence = interruption.sequence;
    endedAt = interruption.observedAt;
  }

  const thread = record.threadStatusEvidence;
  if (thread) {
    const threadLater = evidenceIsLater(thread, { observedAt, sequence });
    if (thread.status === "system_error" && threadLater) {
      status = "failed";
      observedAt = thread.observedAt;
      sequence = thread.sequence;
      endedAt = thread.observedAt;
    } else if ((thread.status === "active" || thread.status === "waiting") && threadLater) {
      // A strictly later active signal can represent follow-up after a terminal
      // turn. Equal/older replay cannot erase explicit terminal evidence.
      status = thread.status === "waiting" ? "waiting" : "working";
      observedAt = thread.observedAt;
      sequence = thread.sequence;
      endedAt = undefined;
    } else if (
      (thread.status === "idle" ||
        thread.status === "not_loaded" ||
        thread.status === "closed" ||
        thread.status === "unknown") &&
      threadLater &&
      !TERMINAL_STATUSES.has(status)
    ) {
      status = "unknown";
      observedAt = thread.observedAt;
      sequence = thread.sequence;
      endedAt = undefined;
    }
  }

  if (
    record.restoreUnknownSequence !== undefined &&
    ACTIVE_STATUSES.has(status) &&
    sequence <= record.restoreUnknownSequence
  ) {
    status = "unknown";
    sequence = record.restoreUnknownSequence;
    observedAt = Math.max(observedAt, record.statusObservedAt);
    endedAt = undefined;
  }

  record.status = status;
  record.statusObservedAt = observedAt;
  record.endedAt = endedAt;
  return previous !== `${record.status}|${record.statusObservedAt}|${record.endedAt ?? ""}`;
}

function latestTurn(record: CodexNativeSubagentRecord): TurnEvidence | undefined {
  let latest: TurnEvidence | undefined;
  for (const turn of Object.values(record.turnsByProviderTurnId)) {
    if (!latest || compareTurns(turn, latest) > 0) latest = turn;
  }
  return latest;
}

function compareTurns(left: TurnEvidence, right: TurnEvidence): number {
  const leftAt = left.startedAt ?? left.completedAt ?? left.observedAt;
  const rightAt = right.startedAt ?? right.completedAt ?? right.observedAt;
  return leftAt - rightAt || left.sequence - right.sequence || left.providerTurnId.localeCompare(right.providerTurnId);
}

function statusForSpawnAggregate(record: CodexNativeSubagentRecord): CodexNativeSubagentStatus {
  return record.firstTaskOutcome ?? record.status;
}

function summarizeStatuses(counts: CodexNativeSubagentStatusCounts): CodexNativeSubagentStatus {
  if (counts.working > 0) return "working";
  if (counts.waiting > 0) return "waiting";
  if (counts.starting > 0) return "starting";
  if (counts.failed > 0) return "failed";
  if (counts.interrupted > 0) return "interrupted";
  if (counts.unknown > 0) return "unknown";
  return "done";
}

function createStatusCounts(): CodexNativeSubagentStatusCounts {
  return {
    starting: 0,
    working: 0,
    waiting: 0,
    done: 0,
    failed: 0,
    interrupted: 0,
    unknown: 0,
  };
}

function extractVerifiedSpawnMetadata(thread: Record<string, unknown>): {
  providerThreadId: string;
  parentProviderThreadId?: string;
  agentPath?: string;
  nickname?: string;
  role?: string;
  depth?: number;
  startedAt?: number;
  followUpAvailable?: boolean;
  transcriptAvailability?: CodexNativeSubagentTranscriptAvailability;
  status?: unknown;
} | null {
  const source = asRecord(thread.source);
  if (!source) return null;
  const subAgent = asRecord(source.subAgent ?? source.sub_agent);
  if (!subAgent) return null;

  let spawn = asRecord(subAgent.thread_spawn ?? subAgent.threadSpawn);
  if (!spawn) {
    const discriminator = normalizedToken(subAgent.type ?? subAgent.kind);
    if (discriminator === "threadspawn") spawn = subAgent;
  }
  if (!spawn) return null;

  const providerThreadId = cleanProviderId(thread.id ?? thread.threadId ?? thread.thread_id);
  if (!providerThreadId) return null;
  const parentProviderThreadId = cleanProviderId(
    spawn.parentThreadId ?? spawn.parent_thread_id ?? thread.parentThreadId ?? thread.parent_thread_id,
  );
  if (!parentProviderThreadId) return null;

  const agentPath = boundedString(spawn.agentPath ?? spawn.agent_path, MAX_AGENT_PATH_LENGTH);
  const nickname = boundedString(thread.nickname ?? spawn.nickname, MAX_LABEL_LENGTH);
  const role = boundedString(thread.role ?? spawn.role, MAX_LABEL_LENGTH);
  const depth = nonNegativeInteger(spawn.depth ?? thread.depth);
  const startedAt = normalizeTimestamp(thread.createdAt ?? thread.created_at ?? spawn.createdAt ?? spawn.created_at);
  const followUpAvailable = firstBoolean(
    thread.followUpAvailable,
    thread.follow_up_available,
    spawn.followUpAvailable,
    spawn.follow_up_available,
    spawn.open,
  );
  const transcriptAvailability = normalizeTranscriptAvailability(
    thread.transcriptAvailability ?? thread.transcript_availability,
  );

  return {
    providerThreadId,
    parentProviderThreadId,
    ...(agentPath ? { agentPath } : {}),
    ...(nickname ? { nickname } : {}),
    ...(role ? { role } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(followUpAvailable !== undefined ? { followUpAvailable } : {}),
    ...(transcriptAvailability ? { transcriptAvailability } : {}),
    ...(thread.status !== undefined ? { status: thread.status } : {}),
  };
}

function normalizeThreadStatus(value: unknown): NormalizedThreadStatus {
  const record = asRecord(value);
  const token = normalizedToken(
    record?.type ?? record?.status ?? record?.state ?? (typeof value === "string" ? value : undefined),
  );
  const waiting =
    containsWaitingFlag(record) || token.includes("waitingonapproval") || token.includes("waitingonuserinput");
  if (waiting) return "waiting";
  if (token === "active" || token === "inprogress" || token === "running" || token === "working") return "active";
  if (token === "idle" || token === "inactive") return "idle";
  if (token === "notloaded" || token === "unloaded") return "not_loaded";
  if (token === "closed" || token === "shutdown" || token === "notfound") return "closed";
  if (token.includes("systemerror") || token === "error" || token === "failed") return "system_error";
  return "unknown";
}

function containsWaitingFlag(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  if (record.waitingOnApproval === true || record.waiting_on_approval === true) return true;
  if (record.waitingOnUserInput === true || record.waiting_on_user_input === true) return true;
  const flags = record.activeFlags ?? record.active_flags ?? record.flags;
  if (!Array.isArray(flags)) return false;
  return flags.some((flag) => {
    const token = normalizedToken(flag);
    return token === "waitingonapproval" || token === "waitingonuserinput";
  });
}

function normalizeTurnOutcome(status: unknown): FirstTaskOutcome {
  const record = asRecord(status);
  const token = normalizedToken(
    record?.type ?? record?.status ?? record?.state ?? (typeof status === "string" ? status : undefined),
  );
  if (
    token === "completed" ||
    token === "complete" ||
    token === "success" ||
    token === "succeeded" ||
    token === "done"
  ) {
    return "done";
  }
  if (token === "failed" || token === "error" || token === "errored" || token === "declined") return "failed";
  if (token === "interrupted" || token === "cancelled" || token === "canceled" || token === "aborted") {
    return "interrupted";
  }
  return "unknown";
}

function normalizeRecord(
  value: unknown,
  sessionId: string,
  providerThreadId: string,
): CodexNativeSubagentRecord | null {
  const input = asRecord(value);
  if (!input) return null;
  const spawnOrder = positiveInteger(input.spawnOrder);
  if (!spawnOrder) return null;
  const status = normalizePublicStatus(input.status);
  const statusObservedAt = normalizeTimestamp(input.statusObservedAt) ?? 0;
  const record: CodexNativeSubagentRecord = {
    publicChildId: opaqueChildId(sessionId, providerThreadId),
    ...(cleanProviderId(input.providerParentThreadId)
      ? {
          providerParentThreadId: cleanProviderId(input.providerParentThreadId),
        }
      : {}),
    ...(cleanProviderId(input.spawnRootProviderTurnId)
      ? {
          spawnRootProviderTurnId: cleanProviderId(input.spawnRootProviderTurnId),
        }
      : {}),
    ...(cleanFeedRootTurnKey(input.feedRootTurnKey)
      ? { feedRootTurnKey: cleanFeedRootTurnKey(input.feedRootTurnKey) }
      : {}),
    agentPath: boundedString(input.agentPath, MAX_AGENT_PATH_LENGTH) ?? "",
    ...(boundedString(input.nickname, MAX_LABEL_LENGTH)
      ? { nickname: boundedString(input.nickname, MAX_LABEL_LENGTH) }
      : {}),
    ...(boundedString(input.role, MAX_LABEL_LENGTH) ? { role: boundedString(input.role, MAX_LABEL_LENGTH) } : {}),
    ...(nonNegativeInteger(input.depth) !== undefined ? { depth: nonNegativeInteger(input.depth) } : {}),
    spawnOrder,
    ...(normalizeTimestamp(input.startedAt) !== undefined ? { startedAt: normalizeTimestamp(input.startedAt) } : {}),
    ...(normalizeTimestamp(input.lastActivityAt) !== undefined
      ? { lastActivityAt: normalizeTimestamp(input.lastActivityAt) }
      : {}),
    status,
    statusObservedAt,
    ...(normalizeTimestamp(input.endedAt) !== undefined ? { endedAt: normalizeTimestamp(input.endedAt) } : {}),
    transcriptAvailability: normalizeTranscriptAvailability(input.transcriptAvailability) ?? "unavailable",
    ...(typeof input.followUpAvailable === "boolean" ? { followUpAvailable: input.followUpAvailable } : {}),
    ...(normalizeStamp(input.spawnEvidence) ? { spawnEvidence: normalizeStamp(input.spawnEvidence) } : {}),
    ...(normalizeStamp(input.interruptedEvidence)
      ? { interruptedEvidence: normalizeStamp(input.interruptedEvidence) }
      : {}),
    ...(normalizeThreadStatusEvidence(input.threadStatusEvidence)
      ? {
          threadStatusEvidence: normalizeThreadStatusEvidence(input.threadStatusEvidence),
        }
      : {}),
    turnsByProviderTurnId: {},
    ...(cleanProviderId(input.firstTaskProviderTurnId)
      ? {
          firstTaskProviderTurnId: cleanProviderId(input.firstTaskProviderTurnId),
        }
      : {}),
    ...(normalizeFirstTaskOutcome(input.firstTaskOutcome)
      ? { firstTaskOutcome: normalizeFirstTaskOutcome(input.firstTaskOutcome) }
      : {}),
    ...(positiveInteger(input.restoreUnknownSequence)
      ? {
          restoreUnknownSequence: positiveInteger(input.restoreUnknownSequence),
        }
      : {}),
    seenActivityEventIds: Array.isArray(input.seenActivityEventIds)
      ? input.seenActivityEventIds
          .map((item) => boundedString(item, MAX_LABEL_LENGTH))
          .filter((item): item is string => !!item)
          .slice(-MAX_ACTIVITY_EVENT_IDS)
      : [],
  };

  const turns = asRecord(input.turnsByProviderTurnId);
  if (turns) {
    for (const [providerTurnId, rawTurn] of Object.entries(turns)) {
      const turn = normalizeTurnEvidence(rawTurn, providerTurnId);
      if (turn) record.turnsByProviderTurnId[providerTurnId] = turn;
    }
  }
  return record;
}

function normalizeTurnEvidence(value: unknown, providerTurnId: string): TurnEvidence | null {
  const input = asRecord(value);
  if (!input || !cleanProviderId(providerTurnId)) return null;
  const stamp = normalizeStamp(input);
  if (!stamp) return null;
  const outcome = normalizeFirstTaskOutcome(input.outcome);
  return {
    providerTurnId,
    ...stamp,
    ...(normalizeTimestamp(input.startedAt) !== undefined ? { startedAt: normalizeTimestamp(input.startedAt) } : {}),
    ...(normalizeTimestamp(input.completedAt) !== undefined
      ? { completedAt: normalizeTimestamp(input.completedAt) }
      : {}),
    ...(outcome ? { outcome } : {}),
    ...(input.outcomeConflict === true ? { outcomeConflict: true } : {}),
  };
}

function normalizeStamp(value: unknown): EvidenceStamp | undefined {
  const input = asRecord(value);
  if (!input) return undefined;
  const observedAt = normalizeTimestamp(input.observedAt);
  const sequence = positiveInteger(input.sequence);
  if (observedAt === undefined || sequence === undefined) return undefined;
  return { observedAt, sequence };
}

function normalizeThreadStatusEvidence(value: unknown): ThreadStatusEvidence | undefined {
  const input = asRecord(value);
  const stamp = normalizeStamp(input);
  if (!input || !stamp) return undefined;
  const status = normalizeStoredThreadStatus(input.status);
  return { status, ...stamp };
}

function normalizeStoredThreadStatus(value: unknown): NormalizedThreadStatus {
  const token = normalizedToken(value);
  if (token === "active") return "active";
  if (token === "waiting") return "waiting";
  if (token === "idle") return "idle";
  if (token === "notloaded") return "not_loaded";
  if (token === "closed") return "closed";
  if (token === "systemerror") return "system_error";
  return "unknown";
}

function maxRecordSequence(record: CodexNativeSubagentRecord): number {
  return Math.max(
    record.spawnEvidence?.sequence ?? 0,
    record.interruptedEvidence?.sequence ?? 0,
    record.threadStatusEvidence?.sequence ?? 0,
    record.restoreUnknownSequence ?? 0,
    ...Object.values(record.turnsByProviderTurnId).map((turn) => turn.sequence),
  );
}

function opaqueChildId(sessionId: string, providerThreadId: string): string {
  const digest = createHash("sha256")
    .update("takode:codex-native-subagent:v1\0")
    .update(sessionId)
    .update("\0")
    .update(providerThreadId)
    .digest("base64url")
    .slice(0, 22);
  return `codex-child-${digest}`;
}

function displayNameForRecord(record: CodexNativeSubagentRecord): string {
  const segments = record.agentPath.split("/").filter(Boolean);
  return segments.at(-1) || record.nickname || record.role || `Subagent ${record.spawnOrder}`;
}

function makeStamp(registry: CodexNativeSubagentRegistry, observedAt: number): EvidenceStamp {
  return { observedAt, sequence: nextSequence(registry) };
}

function nextSequence(registry: CodexNativeSubagentRegistry): number {
  return registry.nextEvidenceSequence++;
}

function isNewerEvidence(existing: EvidenceStamp | undefined, observedAt: number): boolean {
  return !existing || observedAt > existing.observedAt;
}

function evidenceIsLater(candidate: EvidenceStamp, baseline: EvidenceStamp): boolean {
  return (
    candidate.observedAt > baseline.observedAt ||
    (candidate.observedAt === baseline.observedAt && candidate.sequence > baseline.sequence)
  );
}

function updateMaxTimestamp(record: CodexNativeSubagentRecord, key: "lastActivityAt", value: number): boolean {
  if (record[key] !== undefined && record[key]! >= value) return false;
  record[key] = value;
  return true;
}

function transcriptRank(value: CodexNativeSubagentTranscriptAvailability): number {
  if (value === "available") return 2;
  if (value === "partial") return 1;
  return 0;
}

function readNow(now: ApplyCodexNativeSubagentEventOptions["now"]): number {
  const value = typeof now === "function" ? now() : now;
  return normalizeTimestamp(value) ?? Date.now();
}

function cleanProviderId(value: unknown): string | undefined {
  return boundedString(value, MAX_AGENT_PATH_LENGTH);
}

function cleanFeedRootTurnKey(value: unknown): string | undefined {
  return boundedString(value, MAX_LABEL_LENGTH);
}

function boundedString(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return value;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) return undefined;
  return value;
}

function nonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return undefined;
  return value;
}

function normalizeCoverage(value: unknown): CodexNativeSubagentCoverage {
  return value === "complete" ? "complete" : "partial";
}

function normalizeTranscriptAvailability(value: unknown): CodexNativeSubagentTranscriptAvailability | undefined {
  return TRANSCRIPT_AVAILABILITIES.has(value as CodexNativeSubagentTranscriptAvailability)
    ? (value as CodexNativeSubagentTranscriptAvailability)
    : undefined;
}

function normalizePublicStatus(value: unknown): CodexNativeSubagentStatus {
  if (value === "starting" || value === "working" || value === "waiting") return value;
  if (value === "done" || value === "failed" || value === "interrupted" || value === "unknown") return value;
  return "unknown";
}

function normalizeFirstTaskOutcome(value: unknown): FirstTaskOutcome | undefined {
  if (value === "done" || value === "failed" || value === "interrupted" || value === "unknown") return value;
  return undefined;
}

function normalizedToken(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]/g, "") : "";
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === "boolean");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
