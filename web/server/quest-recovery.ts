import type { QuestRecoveryEvent, QuestRecoveryEventDraft } from "./quest-types.js";

export const QUEST_LEADER_RECOVERY_WARNING_HEADER = "X-Companion-Quest-Leader-Recovery-Warning";

export function appendQuestRecoveryEvent(
  existing: readonly QuestRecoveryEvent[] | undefined,
  input: QuestRecoveryEventDraft | undefined,
  now: number,
): QuestRecoveryEvent[] | undefined {
  const normalizedExisting = normalizeQuestRecoveryEvents(existing);
  if (!input) return normalizedExisting.length > 0 ? normalizedExisting : undefined;
  return [...normalizedExisting, buildQuestRecoveryEvent(input, now)];
}

export function formatLeaderRecoveryWarning(event: QuestRecoveryEvent | QuestRecoveryEventDraft): string {
  const bypassedCount = event.bypassedChecks.length;
  return (
    `Leader recovery used by ${event.actorSessionId}; audit recorded ${bypassedCount} ` +
    `bypassed/unavailable check${bypassedCount === 1 ? "" : "s"}. Reason: ${event.reason}`
  );
}

export function normalizeQuestRecoveryEvents(raw: unknown): QuestRecoveryEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: QuestRecoveryEvent[] = [];
  for (const value of raw) {
    const event = normalizeQuestRecoveryEvent(value);
    if (event) events.push(event);
  }
  return events;
}

function buildQuestRecoveryEvent(input: QuestRecoveryEventDraft, now: number): QuestRecoveryEvent {
  const event = normalizeQuestRecoveryEvent({ ...input, ts: now });
  if (!event) throw new Error("Invalid quest recovery audit event");
  return event;
}

function normalizeQuestRecoveryEvent(raw: unknown): QuestRecoveryEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Partial<QuestRecoveryEvent>;
  if (value.operation !== "leader_complete") return null;
  const actorSessionId = optionalSessionId(value.actorSessionId);
  const reason = typeof value.reason === "string" ? value.reason.trim() : "";
  const previousStatus =
    value.previousStatus === "idea" ||
    value.previousStatus === "refined" ||
    value.previousStatus === "in_progress" ||
    value.previousStatus === "done"
      ? value.previousStatus
      : undefined;
  const ts = typeof value.ts === "number" && Number.isFinite(value.ts) && value.ts > 0 ? value.ts : 0;
  if (!actorSessionId || !reason || !previousStatus || !ts) return null;
  const bypassedChecks = stringList(value.bypassedChecks);
  if (bypassedChecks.length === 0) return null;
  const supplied = value.supplied;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) return null;
  const workerState = normalizeWorkerState(value.workerState);
  return {
    operation: "leader_complete",
    actorSessionId,
    reason,
    ts,
    previousStatus,
    ...(optionalSessionId(value.previousOwnerSessionId)
      ? { previousOwnerSessionId: optionalSessionId(value.previousOwnerSessionId) }
      : {}),
    ...(optionalSessionId(value.previousLeaderSessionId)
      ? { previousLeaderSessionId: optionalSessionId(value.previousLeaderSessionId) }
      : {}),
    boardRows: normalizeBoardRows(value.boardRows),
    ...(workerState ? { workerState } : {}),
    supplied: {
      verificationItemCount: nonnegativeInt(supplied.verificationItemCount),
      commitShas: stringList(supplied.commitShas),
      memoryCommitShas: stringList(supplied.memoryCommitShas),
      hasDebrief: supplied.hasDebrief === true,
      hasDebriefTldr: supplied.hasDebriefTldr === true,
    },
    bypassedChecks,
  };
}

function normalizeBoardRows(raw: unknown): QuestRecoveryEvent["boardRows"] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const value = row as QuestRecoveryEvent["boardRows"][number];
    const leaderSessionId = optionalSessionId(value.leaderSessionId);
    if (!leaderSessionId) return [];
    const activePhaseIndex = nonnegativeIntOrUndefined(value.activePhaseIndex);
    const waitForInputCount = nonnegativeIntOrUndefined(value.waitForInputCount);
    return [
      {
        leaderSessionId,
        ...(typeof value.status === "string" && value.status.trim() ? { status: value.status.trim() } : {}),
        ...(optionalSessionId(value.workerSessionId)
          ? { workerSessionId: optionalSessionId(value.workerSessionId) }
          : {}),
        ...(Array.isArray(value.phaseIds)
          ? { phaseIds: stringList(value.phaseIds) as QuestRecoveryEvent["boardRows"][number]["phaseIds"] }
          : {}),
        ...(activePhaseIndex !== undefined ? { activePhaseIndex } : {}),
        ...(waitForInputCount !== undefined ? { waitForInputCount } : {}),
      },
    ];
  });
}

function normalizeWorkerState(raw: unknown): QuestRecoveryEvent["workerState"] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as QuestRecoveryEvent["workerState"];
  const sessionId = optionalSessionId(value?.sessionId);
  if (!sessionId) return undefined;
  return {
    sessionId,
    known: value?.known === true,
    ...(value?.archived === true ? { archived: true } : {}),
    ...(value?.hasBridgeSession === true ? { hasBridgeSession: true } : {}),
    ...(value?.hasCwd === true ? { hasCwd: true } : {}),
    ...(value?.gitStatusKnown === true ? { gitStatusKnown: true } : {}),
  };
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => (typeof value === "string" && value.trim() ? [value.trim()] : []));
}

function nonnegativeInt(raw: unknown): number {
  return nonnegativeIntOrUndefined(raw) ?? 0;
}

function nonnegativeIntOrUndefined(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

function optionalSessionId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
