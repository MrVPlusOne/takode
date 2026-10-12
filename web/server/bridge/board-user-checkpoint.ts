/**
 * Automatic User Checkpoints: a quest on a leader's board is in User Checkpoint while the
 * leader has an open, blocking question to the user about it.
 *
 * The row's `waitForInput` links are the blocking questions. A link on a row in Work moves the
 * row into a User Checkpoint: the planned one when it comes next, otherwise one Takode adds
 * (with a later Work occurrence) right after the current Work. When the last link of a checkpoint
 * Takode added is resolved, the row returns to that later Work; a question soon after reopens the
 * same checkpoint, so a back-and-forth with the user stays one checkpoint. Planned checkpoints keep
 * leader-driven resumption. Each checkpoint has its own phase timing, so Work time excludes the wait.
 */
import { normalizeKnownQuestJourneyPhaseIds, normalizeQuestJourneyPlan } from "../../shared/quest-journey.js";
import type { QuestJourneyPhaseId, QuestJourneyPhaseTiming } from "../../shared/quest-journey.js";
import type { BoardRow } from "../session-types.js";

/** A question within this long after Takode resumed Work rejoins the checkpoint it just left. */
export const AUTO_CHECKPOINT_REOPEN_WINDOW_MS = 10 * 60_000;

const AUTO_CHECKPOINT_NOTE = "Added by Takode while the leader's questions to the user were open.";
const AUTO_CHECKPOINT_REVISION_REASON = "Takode added a User Checkpoint for the leader's open question to the user.";

type Journey = NonNullable<BoardRow["journey"]>;

/**
 * Records a new leader question to the user about this row's quest. A blocking question on a row
 * in Work or User Checkpoint becomes a link (and moves Work into the checkpoint); any other question
 * is kept as an open, non-blocking question. Returns whether the row changed.
 */
export function addLeaderQuestionToBoardRow(
  row: BoardRow,
  notificationId: string,
  options: { blocking: boolean; now: number },
): boolean {
  const status = normalizedStatus(row);
  if (status === "QUEUED" || status === "PROPOSED" || !status) return false;
  if (options.blocking && (status === "WORKING" || status === "USER_CHECKPOINTING")) {
    row.waitForInput = addId(row.waitForInput, notificationId);
    row.openQuestions = removeIds(row.openQuestions, [notificationId]);
    syncAutomaticUserCheckpoint(row, options.now);
    return true;
  }
  row.openQuestions = addId(row.openQuestions, notificationId);
  return true;
}

/**
 * Forgets a resolved question: removes it from the row's links and open questions, then lets an
 * automatic checkpoint with no links left return to Work. Returns whether the row changed.
 */
export function removeResolvedQuestionFromBoardRow(row: BoardRow, notificationId: string, now: number): boolean {
  const id = notificationId.trim().toLowerCase();
  const links = row.waitForInput ?? [];
  const open = row.openQuestions ?? [];
  if (!links.includes(id) && !open.includes(id)) return false;
  row.waitForInput = removeIds(row.waitForInput, [id]);
  row.openQuestions = removeIds(row.openQuestions, [id]);
  syncAutomaticUserCheckpoint(row, now);
  return true;
}

/**
 * Brings the row's phase in line with its links: Work with links enters a User Checkpoint, and a
 * checkpoint Takode added with no links left resumes the Work after it. Returns whether it moved.
 */
export function syncAutomaticUserCheckpoint(row: BoardRow, now: number): boolean {
  const journey = row.journey;
  if (!journey || journey.mode === "proposed" || typeof journey.activePhaseIndex !== "number") return false;
  const phaseIds = normalizeKnownQuestJourneyPhaseIds(journey.phaseIds);
  const index = journey.activePhaseIndex;
  const status = normalizedStatus(row);
  const hasLinks = (row.waitForInput ?? []).length > 0;

  if (status === "WORKING" && phaseIds[index] === "work" && hasLinks) {
    enterUserCheckpoint(row, phaseIds, index, now);
    return true;
  }
  if (status === "USER_CHECKPOINTING" && isAutomaticCheckpointCurrent(row) && !hasLinks) {
    if (phaseIds[index + 1] !== "work") return false;
    moveToPhase(row, phaseIds, index, index + 1, "WORKING", now);
    row.autoCheckpoint = { checkpointIndex: index, resumedAt: now };
    return true;
  }
  return false;
}

/**
 * Applies a leader's manual end of a checkpoint Takode added (`board set --status WORKING`): its
 * links stay open as non-blocking questions and the row continues in the Work after it.
 * Returns the journey position to resume at, or undefined when the row is not in such a checkpoint.
 */
export function endAutomaticUserCheckpointByHand(row: BoardRow): number | undefined {
  if (normalizedStatus(row) !== "USER_CHECKPOINTING" || !isAutomaticCheckpointCurrent(row)) return undefined;
  const checkpointIndex = row.autoCheckpoint!.checkpointIndex;
  row.openQuestions = addIds(row.openQuestions, row.waitForInput ?? []);
  row.waitForInput = undefined;
  row.autoCheckpoint = { checkpointIndex };
  return checkpointIndex + 1;
}

/** Whether the row is in the Work occurrence that follows a checkpoint Takode added. */
export function isWorkAfterAutomaticCheckpoint(row: Pick<BoardRow, "status" | "journey" | "autoCheckpoint">): boolean {
  return (
    normalizedStatus(row) === "WORKING" &&
    row.autoCheckpoint !== undefined &&
    row.journey?.activePhaseIndex === row.autoCheckpoint.checkpointIndex + 1
  );
}

/** Quest IDs whose rows, on any of these boards, hold this worker in a User Checkpoint with open questions. */
export function findUserCheckpointQuestsForWorker(
  boards: Iterable<{ board?: Map<string, BoardRow> }>,
  workerSessionId: string,
): string[] {
  const questIds: string[] = [];
  for (const session of boards) {
    for (const row of session.board?.values() ?? []) {
      if (row.worker !== workerSessionId || normalizedStatus(row) !== "USER_CHECKPOINTING") continue;
      if ((row.waitForInput ?? []).length > 0) questIds.push(row.questId);
    }
  }
  return questIds;
}

function enterUserCheckpoint(row: BoardRow, phaseIds: QuestJourneyPhaseId[], workIndex: number, now: number): void {
  const previous = row.autoCheckpoint;
  if (
    previous?.resumedAt !== undefined &&
    now - previous.resumedAt <= AUTO_CHECKPOINT_REOPEN_WINDOW_MS &&
    previous.checkpointIndex + 1 === workIndex &&
    phaseIds[previous.checkpointIndex] === "user-checkpoint"
  ) {
    // Reopen: the short Work since the resume becomes checkpoint time, and that Work occurrence
    // stays the one the checkpoint resumes into.
    const timings = { ...(row.journey!.phaseTimings ?? {}) };
    delete timings[String(workIndex)];
    const checkpointTiming = { ...timings[String(previous.checkpointIndex)] };
    delete checkpointTiming.endedAt;
    timings[String(previous.checkpointIndex)] = { ...checkpointTiming, startedAt: checkpointTiming.startedAt ?? now };
    setJourney(
      row,
      { ...row.journey!, phaseTimings: timings },
      phaseIds,
      previous.checkpointIndex,
      "USER_CHECKPOINTING",
    );
    row.autoCheckpoint = { checkpointIndex: previous.checkpointIndex };
    return;
  }

  if (phaseIds[workIndex + 1] === "user-checkpoint") {
    // A planned checkpoint comes next: take it, keeping its leader-driven resumption, and make sure
    // a later Work occurrence follows it.
    if (phaseIds[workIndex + 2] !== "work") insertPhases(row, phaseIds, workIndex + 2, ["work"], now);
    moveToPhase(
      row,
      normalizeKnownQuestJourneyPhaseIds(row.journey!.phaseIds),
      workIndex,
      workIndex + 1,
      "USER_CHECKPOINTING",
      now,
    );
    row.autoCheckpoint = undefined;
    return;
  }

  insertPhases(row, phaseIds, workIndex + 1, ["user-checkpoint", "work"], now);
  row.journey = {
    ...row.journey!,
    phaseNotes: { ...(row.journey!.phaseNotes ?? {}), [String(workIndex + 1)]: AUTO_CHECKPOINT_NOTE },
  };
  moveToPhase(
    row,
    normalizeKnownQuestJourneyPhaseIds(row.journey!.phaseIds),
    workIndex,
    workIndex + 1,
    "USER_CHECKPOINTING",
    now,
  );
  row.autoCheckpoint = { checkpointIndex: workIndex + 1 };
}

/** Inserts phases at `at`, shifting the keyed notes, skip reasons and timings of later positions. */
function insertPhases(
  row: BoardRow,
  phaseIds: QuestJourneyPhaseId[],
  at: number,
  inserted: QuestJourneyPhaseId[],
  now: number,
): void {
  const journey = row.journey!;
  const shift = <T>(record: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!record) return undefined;
    const shifted: Record<string, T> = {};
    for (const [key, value] of Object.entries(record)) {
      const position = Number(key);
      shifted[String(position >= at ? position + inserted.length : position)] = value;
    }
    return shifted;
  };
  row.journey = {
    ...journey,
    phaseIds: [...phaseIds.slice(0, at), ...inserted, ...phaseIds.slice(at)],
    phaseNotes: shift(journey.phaseNotes),
    phaseSkipReasons: shift(journey.phaseSkipReasons),
    phaseTimings: shift(journey.phaseTimings),
    revisionReason: AUTO_CHECKPOINT_REVISION_REASON,
    revisedAt: now,
    revisionCount: (journey.revisionCount ?? 0) + 1,
  };
}

function moveToPhase(
  row: BoardRow,
  phaseIds: QuestJourneyPhaseId[],
  fromIndex: number,
  toIndex: number,
  status: "WORKING" | "USER_CHECKPOINTING",
  now: number,
): void {
  const timings: Record<string, QuestJourneyPhaseTiming> = { ...(row.journey!.phaseTimings ?? {}) };
  const from = timings[String(fromIndex)];
  if (from?.startedAt && !from.endedAt) timings[String(fromIndex)] = { ...from, endedAt: now };
  timings[String(toIndex)] = { startedAt: now };
  setJourney(row, { ...row.journey!, phaseTimings: timings }, phaseIds, toIndex, status);
}

function setJourney(
  row: BoardRow,
  journey: Journey,
  phaseIds: QuestJourneyPhaseId[],
  activePhaseIndex: number,
  status: "WORKING" | "USER_CHECKPOINTING",
): void {
  row.status = status;
  row.journey = normalizeQuestJourneyPlan(
    { ...journey, phaseIds, activePhaseIndex, currentPhaseId: phaseIds[activePhaseIndex] },
    status,
  );
}

function isAutomaticCheckpointCurrent(row: Pick<BoardRow, "journey" | "autoCheckpoint">): boolean {
  return row.autoCheckpoint !== undefined && row.journey?.activePhaseIndex === row.autoCheckpoint.checkpointIndex;
}

function normalizedStatus(row: Pick<BoardRow, "status">): string {
  return (row.status ?? "").trim().toUpperCase();
}

function addId(ids: string[] | undefined, id: string): string[] {
  return addIds(ids, [id]) ?? [];
}

function addIds(ids: string[] | undefined, added: string[]): string[] | undefined {
  return sortIds([...new Set([...(ids ?? []), ...added.map((id) => id.trim().toLowerCase())])]);
}

function removeIds(ids: string[] | undefined, removed: string[]): string[] | undefined {
  const drop = new Set(removed.map((id) => id.trim().toLowerCase()));
  return sortIds((ids ?? []).filter((id) => !drop.has(id)));
}

function sortIds(ids: string[]): string[] | undefined {
  const sorted = ids
    .filter((id) => /^n-\d+$/.test(id))
    .sort((a, b) => Number.parseInt(a.slice(2), 10) - Number.parseInt(b.slice(2), 10));
  return sorted.length > 0 ? sorted : undefined;
}
