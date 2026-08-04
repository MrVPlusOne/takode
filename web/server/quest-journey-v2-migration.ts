import {
  DEFAULT_QUEST_JOURNEY_PHASE_IDS,
  FREE_WORKER_WAIT_FOR_TOKEN,
  canonicalizeKnownQuestJourneyPhaseId,
  canonicalizeKnownQuestJourneyState,
  getQuestJourneyCurrentPhaseIndex,
  isLegacyQuestJourneyPhaseId,
  normalizeKnownQuestJourneyPhaseIds,
  normalizeQuestJourneyPlan,
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
  const existingPhaseIds = normalizeKnownQuestJourneyPhaseIds(row.journey?.phaseIds);
  const alreadyV2 =
    row.journey?.v2Migration?.version === 2 ||
    (!!normalizedStatus &&
      ["PROPOSED", "QUEUED", "PLANNING", "WORKING", "USER_CHECKPOINTING", "MEMORY"].includes(normalizedStatus) &&
      existingPhaseIds.length > 0 &&
      existingPhaseIds.every((phaseId) => !isLegacyQuestJourneyPhaseId(phaseId)));
  if (alreadyV2) return null;

  const phaseIds = existingPhaseIds.length > 0 ? existingPhaseIds : DEFAULT_V2_PHASE_IDS;
  const rawActivePhaseIndex = row.journey?.activePhaseIndex;
  const fromActivePhaseIndex =
    typeof rawActivePhaseIndex === "number" &&
    Number.isInteger(rawActivePhaseIndex) &&
    rawActivePhaseIndex >= 0 &&
    rawActivePhaseIndex < phaseIds.length
      ? rawActivePhaseIndex
      : getQuestJourneyCurrentPhaseIndex(row.journey, row.status);
  const fromCurrentPhaseId =
    fromActivePhaseIndex !== undefined ? phaseIds[fromActivePhaseIndex] : row.journey?.currentPhaseId;
  const workerSafety =
    normalizedStatus === "PROPOSED" || normalizedStatus === "QUEUED" ? {} : getWorkerSafety(row.worker, deps);
  const target = resolveMigratedTarget(normalizedStatus, fromCurrentPhaseId, workerSafety.pausedReason);
  const phaseNotes = buildMigratedPhaseNotes(row, target.activePhaseIndex, target.pausedReason);
  const phaseTimings = buildMigratedPhaseTimings(row, target.activePhaseIndex, now);

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
        mode: "active",
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
          ...(phaseIds.length > 0 ? { fromPhaseIds: phaseIds } : {}),
          ...(fromActivePhaseIndex !== undefined ? { fromActivePhaseIndex } : {}),
          ...(fromCurrentPhaseId ? { fromCurrentPhaseId } : {}),
          ...(row.journey?.phaseNotes ? { fromPhaseNotes: row.journey.phaseNotes } : {}),
          ...(row.journey?.phaseTimings ? { fromPhaseTimings: row.journey.phaseTimings } : {}),
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
  pausedReason: string | undefined,
): Record<string, string> | undefined {
  if (activePhaseIndex === undefined) return row.journey?.phaseNotes;
  const existing = row.journey?.phaseNotes?.[String(activePhaseIndex)]?.trim();
  const summary = [
    "Migrated to Quest Journey v2. Legacy phase history is preserved in journey.v2Migration; continue with the active v2 Work/Memory flow.",
    pausedReason ? `Paused for leader attention: ${pausedReason}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    ...(row.journey?.phaseNotes ?? {}),
    [String(activePhaseIndex)]: existing ? `${existing}\n\n${summary}` : summary,
  };
}

function buildMigratedPhaseTimings(
  row: BoardRow,
  activePhaseIndex: number | undefined,
  now: number,
): Record<string, QuestJourneyPhaseTiming> | undefined {
  if (activePhaseIndex === undefined) return row.journey?.phaseTimings;
  const timings = { ...(row.journey?.phaseTimings ?? {}) };
  const activeKey = String(activePhaseIndex);
  const activeTiming = timings[activeKey];
  timings[activeKey] = {
    startedAt: activeTiming?.startedAt ?? now,
    ...(activeTiming?.endedAt ? { endedAt: activeTiming.endedAt } : {}),
  };
  return timings;
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
