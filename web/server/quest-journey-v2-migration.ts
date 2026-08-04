import {
  DEFAULT_QUEST_JOURNEY_PHASE_IDS,
  FREE_WORKER_WAIT_FOR_TOKEN,
  canonicalizeKnownQuestJourneyPhaseId,
  canonicalizeKnownQuestJourneyState,
  isLegacyQuestJourneyPhaseId,
  normalizeQuestJourneyPlan,
  type QuestJourneyV2LegacyPhaseRecord,
  type QuestJourneyPhaseTiming,
  type QuestJourneyPhaseId,
  type QuestJourneyState,
} from "../shared/quest-journey.js";
import type { BoardRow } from "./session-types.js";

export interface QuestJourneyV2MigrationSessionLike {
  id: string;
  board: Map<string, BoardRow>;
}

export interface QuestJourneyV2MigrationSessionInfo {
  archived?: boolean;
  reviewerOf?: number;
}

export interface QuestJourneyV2MigrationDeps {
  getSessionInfo: (sessionId: string) => QuestJourneyV2MigrationSessionInfo | undefined;
  persistSession: (session: QuestJourneyV2MigrationSessionLike) => void;
  now?: number;
}

export interface QuestJourneyV2MigratedRowSummary {
  leaderSessionId: string;
  questId: string;
  fromStatus?: string;
  toStatus?: string;
  pausedReason?: string;
}

export interface QuestJourneyV2MigrationSummary {
  migratedRows: QuestJourneyV2MigratedRowSummary[];
  pausedRows: QuestJourneyV2MigratedRowSummary[];
  changedSessions: string[];
}

const DEFAULT_V2_PHASE_IDS = [...DEFAULT_QUEST_JOURNEY_PHASE_IDS] as QuestJourneyPhaseId[];
const ALIGNMENT_INDEX = DEFAULT_V2_PHASE_IDS.indexOf("alignment");
const WORK_INDEX = DEFAULT_V2_PHASE_IDS.indexOf("work");
const MEMORY_INDEX = DEFAULT_V2_PHASE_IDS.indexOf("memory");

export function migrateQuestJourneyV2BoardRows(
  sessions: Iterable<QuestJourneyV2MigrationSessionLike>,
  deps: QuestJourneyV2MigrationDeps,
): QuestJourneyV2MigrationSummary {
  const migratedRows: QuestJourneyV2MigratedRowSummary[] = [];
  const pausedRows: QuestJourneyV2MigratedRowSummary[] = [];
  const changedSessions: string[] = [];
  const now = deps.now ?? Date.now();

  for (const session of sessions) {
    let changed = false;
    for (const [questId, row] of session.board.entries()) {
      const migrated = migrateQuestJourneyV2BoardRow(session.id, row, deps, now);
      if (!migrated) continue;
      session.board.set(questId, migrated.row);
      changed = true;
      migratedRows.push(migrated.summary);
      if (migrated.summary.pausedReason) pausedRows.push(migrated.summary);
    }
    if (!changed) continue;
    deps.persistSession(session);
    changedSessions.push(session.id);
  }

  return { migratedRows, pausedRows, changedSessions };
}

function migrateQuestJourneyV2BoardRow(
  leaderSessionId: string,
  row: BoardRow,
  deps: QuestJourneyV2MigrationDeps,
  now: number,
): { row: BoardRow; summary: QuestJourneyV2MigratedRowSummary } | null {
  const status = row.status?.trim().toUpperCase();
  const normalizedStatus = canonicalizeKnownQuestJourneyState(status);
  const phaseAnalysis = analyzePersistedPhaseIds(row.journey?.phaseIds);
  const existingPhaseIds = phaseAnalysis.validPhaseIds;
  const legacyPhaseIdsComplete = phaseAnalysis.phaseIdsByPosition.every((phaseId) => phaseId !== undefined);
  const alreadyV2 =
    row.journey?.v2Migration?.version === 2 ||
    (!!normalizedStatus &&
      ["PROPOSED", "QUEUED", "PLANNING", "WORKING", "USER_CHECKPOINTING", "MEMORY"].includes(normalizedStatus) &&
      legacyPhaseIdsComplete &&
      existingPhaseIds.length > 0 &&
      existingPhaseIds.every((phaseId) => !isLegacyQuestJourneyPhaseId(phaseId)));
  if (alreadyV2) return null;

  const rawActivePhaseIndex = row.journey?.activePhaseIndex;
  const fromActivePhaseIndex =
    typeof rawActivePhaseIndex === "number" &&
    Number.isInteger(rawActivePhaseIndex) &&
    rawActivePhaseIndex >= 0 &&
    rawActivePhaseIndex < phaseAnalysis.phaseIdsByPosition.length
      ? rawActivePhaseIndex
      : undefined;
  const fromCurrentPhaseId =
    fromActivePhaseIndex !== undefined
      ? phaseAnalysis.phaseIdsByPosition[fromActivePhaseIndex]
      : canonicalizeKnownQuestJourneyPhaseId(row.journey?.currentPhaseId);
  const malformedReason = getMalformedRowReason(status, normalizedStatus, phaseAnalysis);
  const workerSafety =
    normalizedStatus === "PROPOSED" || normalizedStatus === "QUEUED" || malformedReason
      ? {}
      : getWorkerSafety(row.worker, deps);
  const pausedReason = malformedReason ?? workerSafety.pausedReason;
  const target = resolveMigratedTarget(normalizedStatus, fromCurrentPhaseId, pausedReason);
  const legacyPhases = buildLegacyPhaseRecords(row, phaseAnalysis.rawPhaseIds, phaseAnalysis.phaseIdsByPosition);
  const phaseNotes = buildMigratedPhaseNotes(row, target.activePhaseIndex, fromActivePhaseIndex, target.pausedReason);
  const phaseTimings = buildMigratedPhaseTimings(row, target.activePhaseIndex, fromActivePhaseIndex, now);

  const migratedRow: BoardRow = {
    ...row,
    status: target.status,
    waitFor:
      target.status === "QUEUED" ? (target.pausedReason ? [FREE_WORKER_WAIT_FOR_TOKEN] : row.waitFor) : undefined,
    waitForInput: target.status === "QUEUED" ? undefined : row.waitForInput,
    updatedAt: now,
    journey: normalizeQuestJourneyPlan(
      {
        presetId: "v2-migrated",
        mode: target.status === "PROPOSED" ? "proposed" : "active",
        phaseIds: DEFAULT_V2_PHASE_IDS,
        ...(target.activePhaseIndex !== undefined ? { activePhaseIndex: target.activePhaseIndex } : {}),
        ...(target.activePhaseIndex !== undefined
          ? { currentPhaseId: DEFAULT_V2_PHASE_IDS[target.activePhaseIndex] }
          : {}),
        ...(phaseNotes ? { phaseNotes } : {}),
        ...(phaseTimings ? { phaseTimings } : {}),
        v2Migration: {
          version: 2,
          migratedAt: now,
          ...(row.status ? { fromStatus: row.status } : {}),
          ...(existingPhaseIds.length > 0 ? { fromPhaseIds: existingPhaseIds } : {}),
          ...(fromActivePhaseIndex !== undefined ? { fromActivePhaseIndex } : {}),
          ...(fromCurrentPhaseId ? { fromCurrentPhaseId } : {}),
          ...(row.journey?.phaseNotes ? { fromPhaseNotes: row.journey.phaseNotes } : {}),
          ...(row.journey?.phaseTimings ? { fromPhaseTimings: row.journey.phaseTimings } : {}),
          ...(legacyPhases.length > 0 ? { legacyPhases } : {}),
          ...(malformedReason ? { diagnostic: malformedReason } : {}),
          ...(target.pausedReason ? { pausedReason: target.pausedReason } : {}),
        },
      },
      target.status,
    ),
  };

  return {
    row: migratedRow,
    summary: {
      leaderSessionId,
      questId: row.questId,
      ...(row.status ? { fromStatus: row.status } : {}),
      toStatus: target.status,
      ...(target.pausedReason ? { pausedReason: target.pausedReason } : {}),
    },
  };
}

function getWorkerSafety(workerId: string | undefined, deps: QuestJourneyV2MigrationDeps): { pausedReason?: string } {
  if (!workerId) return { pausedReason: "no assigned primary worker" };
  const info = deps.getSessionInfo(workerId);
  if (!info) return { pausedReason: "assigned worker session is unavailable" };
  if (info.archived) return { pausedReason: "assigned worker session is archived" };
  if (info.reviewerOf !== undefined) return { pausedReason: "assigned session is reviewer-only" };
  return {};
}

function analyzePersistedPhaseIds(value: unknown): {
  validPhaseIds: QuestJourneyPhaseId[];
  phaseIdsByPosition: Array<QuestJourneyPhaseId | undefined>;
  rawPhaseIds: string[];
  invalidReason?: string;
} {
  if (value === undefined) return { validPhaseIds: [], phaseIdsByPosition: [], rawPhaseIds: [] };
  if (!Array.isArray(value)) {
    return {
      validPhaseIds: [],
      phaseIdsByPosition: [],
      rawPhaseIds: [],
      invalidReason: "legacy Journey phase list is not an array",
    };
  }
  const rawPhaseIds = value.map((entry) => (typeof entry === "string" ? entry.trim() : ""));
  const phaseIdsByPosition = rawPhaseIds.map((entry) => canonicalizeKnownQuestJourneyPhaseId(entry) ?? undefined);
  const validPhaseIds = phaseIdsByPosition.filter((phaseId): phaseId is QuestJourneyPhaseId => phaseId !== undefined);
  if (rawPhaseIds.some((entry) => !entry) || validPhaseIds.length !== rawPhaseIds.length) {
    return {
      validPhaseIds,
      phaseIdsByPosition,
      rawPhaseIds,
      invalidReason: "legacy Journey phase list contains unknown or malformed phases",
    };
  }
  return { validPhaseIds, phaseIdsByPosition, rawPhaseIds };
}

function getMalformedRowReason(
  status: string | undefined,
  normalizedStatus: string | null,
  phaseAnalysis: ReturnType<typeof analyzePersistedPhaseIds>,
): string | undefined {
  if (phaseAnalysis.invalidReason) return phaseAnalysis.invalidReason;
  if (status && !normalizedStatus) return `unknown legacy board state: ${status}`;
  return undefined;
}

function resolveMigratedTarget(
  status: string | null,
  currentPhaseId: QuestJourneyPhaseId | undefined,
  pausedReason: string | undefined,
): { status: QuestJourneyState; activePhaseIndex?: number; pausedReason?: string } {
  if (status === "PROPOSED") return { status: "PROPOSED" };
  if (status === "QUEUED") return { status: "QUEUED" };
  if (pausedReason) return { status: "QUEUED", activePhaseIndex: WORK_INDEX, pausedReason };
  if (status === "PLANNING" || currentPhaseId === "alignment") {
    return { status: "PLANNING", activePhaseIndex: ALIGNMENT_INDEX };
  }
  if (status === "USER_CHECKPOINTING") {
    return { status: "USER_CHECKPOINTING", activePhaseIndex: WORK_INDEX };
  }
  if (status === "MEMORY" || currentPhaseId === "memory") {
    return { status: "MEMORY", activePhaseIndex: MEMORY_INDEX };
  }
  return { status: "WORKING", activePhaseIndex: WORK_INDEX };
}

function buildMigratedPhaseNotes(
  row: BoardRow,
  activePhaseIndex: number | undefined,
  fromActivePhaseIndex: number | undefined,
  pausedReason: string | undefined,
): Record<string, string> | undefined {
  if (activePhaseIndex === undefined) return undefined;
  const mappedLegacyNote = getSemanticallyMappedActiveNote(row, activePhaseIndex, fromActivePhaseIndex);
  const summary = [
    "Migrated to Quest Journey v2. Legacy phase history is preserved in journey.v2Migration; continue with the active v2 Work/Memory flow.",
    pausedReason ? `Paused for leader attention: ${pausedReason}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    [String(activePhaseIndex)]: mappedLegacyNote ? `${mappedLegacyNote}\n\n${summary}` : summary,
  };
}

function buildMigratedPhaseTimings(
  row: BoardRow,
  activePhaseIndex: number | undefined,
  fromActivePhaseIndex: number | undefined,
  now: number,
): Record<string, QuestJourneyPhaseTiming> | undefined {
  if (activePhaseIndex === undefined) return undefined;
  const mappedLegacyTiming = getSemanticallyMappedActiveTiming(row, activePhaseIndex, fromActivePhaseIndex);
  const timings: Record<string, QuestJourneyPhaseTiming> = {};
  const activeKey = String(activePhaseIndex);
  timings[activeKey] = {
    startedAt: mappedLegacyTiming?.startedAt ?? now,
    ...(mappedLegacyTiming?.endedAt ? { endedAt: mappedLegacyTiming.endedAt } : {}),
  };
  return timings;
}

function getSemanticallyMappedActiveNote(
  row: BoardRow,
  activePhaseIndex: number,
  fromActivePhaseIndex: number | undefined,
): string | undefined {
  if (fromActivePhaseIndex === undefined) return undefined;
  const activePhaseId = DEFAULT_V2_PHASE_IDS[activePhaseIndex];
  const fromPhaseId = canonicalizeKnownQuestJourneyPhaseId(row.journey?.phaseIds?.[fromActivePhaseIndex]);
  if (activePhaseId !== "alignment" && activePhaseId !== "memory") return undefined;
  if (activePhaseId !== fromPhaseId) return undefined;
  return row.journey?.phaseNotes?.[String(fromActivePhaseIndex)]?.trim() || undefined;
}

function getSemanticallyMappedActiveTiming(
  row: BoardRow,
  activePhaseIndex: number,
  fromActivePhaseIndex: number | undefined,
): QuestJourneyPhaseTiming | undefined {
  if (fromActivePhaseIndex === undefined) return undefined;
  const activePhaseId = DEFAULT_V2_PHASE_IDS[activePhaseIndex];
  const fromPhaseId = canonicalizeKnownQuestJourneyPhaseId(row.journey?.phaseIds?.[fromActivePhaseIndex]);
  if (activePhaseId !== "alignment" && activePhaseId !== "memory") return undefined;
  if (activePhaseId !== fromPhaseId) return undefined;
  return row.journey?.phaseTimings?.[String(fromActivePhaseIndex)];
}

function buildLegacyPhaseRecords(
  row: BoardRow,
  rawPhaseIds: readonly string[],
  phaseIdsByPosition: readonly (QuestJourneyPhaseId | undefined)[],
): QuestJourneyV2LegacyPhaseRecord[] {
  const maxIndex = Math.max(
    rawPhaseIds.length,
    phaseIdsByPosition.length,
    ...Object.keys(row.journey?.phaseNotes ?? {})
      .map((key) => Number.parseInt(key, 10) + 1)
      .filter(Number.isFinite),
    ...Object.keys(row.journey?.phaseTimings ?? {})
      .map((key) => Number.parseInt(key, 10) + 1)
      .filter(Number.isFinite),
  );
  const occurrences = new Map<string, number>();
  const records: QuestJourneyV2LegacyPhaseRecord[] = [];
  for (let index = 0; index < maxIndex; index += 1) {
    const phaseId = phaseIdsByPosition[index];
    const rawPhaseId = rawPhaseIds[index];
    const occurrenceKey = phaseId ?? rawPhaseId ?? "unknown";
    const phaseOccurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, phaseOccurrence);
    const note = row.journey?.phaseNotes?.[String(index)]?.trim();
    const timing = row.journey?.phaseTimings?.[String(index)];
    records.push({
      index,
      phasePosition: index + 1,
      phaseOccurrence,
      ...(phaseId ? { phaseId } : {}),
      ...(rawPhaseId ? { rawPhaseId } : {}),
      ...(!phaseId && rawPhaseId ? { diagnostic: "unknown or malformed legacy phase id" } : {}),
      ...(!phaseId && !rawPhaseId ? { diagnostic: "missing legacy phase id" } : {}),
      ...(note ? { note } : {}),
      ...(timing ? { timing } : {}),
    });
  }
  return records;
}

export function hasLegacyQuestJourneyBoardRow(row: Pick<BoardRow, "status" | "journey">): boolean {
  const status = canonicalizeKnownQuestJourneyState(row.status);
  if (status && !["PROPOSED", "QUEUED", "PLANNING", "WORKING", "USER_CHECKPOINTING", "MEMORY"].includes(status)) {
    return true;
  }
  return normalizeKnownQuestJourneyPhaseIds(row.journey?.phaseIds).some((phaseId) =>
    isLegacyQuestJourneyPhaseId(phaseId),
  );
}

export function mapLegacyQuestJourneyPhaseToV2Work(phaseId: string | undefined): "alignment" | "work" | "memory" {
  const canonical = canonicalizeKnownQuestJourneyPhaseId(phaseId);
  if (canonical === "alignment") return "alignment";
  if (canonical === "memory") return "memory";
  return "work";
}
