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
 * A leader can end any checkpoint by hand; its questions stay open for the user without blocking.
 * A planned checkpoint left that way is not used up: Takode puts it back after the resumed Work.
 */
import { normalizeKnownQuestJourneyPhaseIds, normalizeQuestJourneyPlan } from "../../shared/quest-journey.js";
import type { QuestJourneyPhaseId, QuestJourneyPhaseTiming } from "../../shared/quest-journey.js";
import type { BoardRow } from "../session-types.js";

/** A question within this long after Takode resumed Work rejoins the checkpoint it just left. */
export const AUTO_CHECKPOINT_REOPEN_WINDOW_MS = 10 * 60_000;

const AUTO_CHECKPOINT_NOTE = "Added by Takode while the leader's questions to the user were open.";
const AUTO_CHECKPOINT_REVISION_REASON = "Takode added a User Checkpoint for the leader's open question to the user.";
const RESTORED_CHECKPOINT_REVISION_REASON =
  "Takode put the planned User Checkpoint back: the leader ended it by hand while its questions were open.";

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
 * Applies a leader's manual end of the current User Checkpoint, planned or added by Takode
 * (`board set --status WORKING`): its links stay open as non-blocking questions, and a checkpoint
 * Takode added does not reopen for the next question. Returns the position of the Work after the
 * checkpoint, or undefined when the row is not in a checkpoint followed by Work.
 */
export function endUserCheckpointByHand(row: BoardRow): number | undefined {
  if (normalizedStatus(row) !== "USER_CHECKPOINTING") return undefined;
  keepQuestionsOpen(row, row.waitForInput ?? []);
  row.waitForInput = undefined;
  const index = row.journey?.activePhaseIndex;
  if (typeof index !== "number") return undefined;
  if (isAutomaticCheckpointCurrent(row)) row.autoCheckpoint = { checkpointIndex: index };
  const phaseIds = normalizeKnownQuestJourneyPhaseIds(row.journey!.phaseIds);
  return phaseIds[index] === "user-checkpoint" && phaseIds[index + 1] === "work" ? index + 1 : undefined;
}

/**
 * A planned User Checkpoint is used up only when it ends with its questions resolved. When a leader's
 * board change leaves one while its questions are still open (`--status WORKING`, or dropping its last
 * links), the pause becomes a checkpoint Takode added, the row resumes the Work after it, and the
 * planned checkpoint, with its phase note, goes back after that Work. This keeps a side question
 * from consuming a planned approval step. `existing` is the row before the change, `row` the row
 * after it. Returns whether the row changed.
 */
export function restorePlannedCheckpointLeftOpen(existing: BoardRow | undefined, row: BoardRow, now: number): boolean {
  const index = existing?.journey?.activePhaseIndex;
  if (!existing || typeof index !== "number" || normalizedStatus(existing) !== "USER_CHECKPOINTING") return false;
  if (isAutomaticCheckpointCurrent(existing) || (existing.waitForInput ?? []).length === 0) return false;
  if (!row.journey || (row.waitForInput ?? []).length > 0) return false;
  const phaseIds = normalizeKnownQuestJourneyPhaseIds(row.journey.phaseIds);
  if (phaseIds[index] !== "user-checkpoint" || phaseIds[index + 1] !== "work") return false;
  const status = normalizedStatus(row);
  const endedByHand = status === "WORKING" && row.journey.activePhaseIndex === index + 1;
  const linksDropped = status === "USER_CHECKPOINTING" && row.journey.activePhaseIndex === index;
  if (!endedByHand && !linksDropped) return false;

  const plannedNote = row.journey.phaseNotes?.[String(index)];
  insertPhases(row, phaseIds, index + 2, ["user-checkpoint", "work"], now, RESTORED_CHECKPOINT_REVISION_REASON);
  const phaseNotes = { ...(row.journey.phaseNotes ?? {}), [String(index)]: AUTO_CHECKPOINT_NOTE };
  if (plannedNote) phaseNotes[String(index + 2)] = plannedNote;
  row.journey = { ...row.journey, phaseNotes };
  const restoredPhaseIds = normalizeKnownQuestJourneyPhaseIds(row.journey.phaseIds);
  if (linksDropped) moveToPhase(row, restoredPhaseIds, index, index + 1, "WORKING", now);
  else setJourney(row, row.journey, restoredPhaseIds, index + 1, "WORKING");
  // Like any manual end, the checkpoint does not reopen for the next question.
  row.autoCheckpoint = { checkpointIndex: index };
  return true;
}

/** Keeps questions open as non-blocking: dropping a question's link never resolves it. */
export function keepQuestionsOpen(row: BoardRow, notificationIds: string[]): void {
  row.openQuestions = addIds(row.openQuestions, notificationIds);
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
  revisionReason = AUTO_CHECKPOINT_REVISION_REASON,
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
    revisionReason,
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
