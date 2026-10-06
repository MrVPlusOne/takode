import { createHash } from "node:crypto";
import { getTakodeQuestOwnerSessionId } from "../shared/quest-owner.js";
import { getQuestJourneyCurrentPhaseId, getQuestJourneyCurrentPhaseIndex } from "../shared/quest-journey.js";
import { resolveQuestFeedbackDocumentation } from "./quest-phase-docs.js";
import * as questStore from "./quest-store.js";
import type { QuestFeedbackEntry } from "./quest-types.js";
import type { RouteContext } from "./routes/context.js";
import { broadcastQuestUpdate } from "./routes/quest-helpers.js";
import type { WorkerReportReference } from "../shared/worker-report.js";

/** Record an exact authored report for the caller's current Work, then notify its leader.
 * Identical text within the same worker/occurrence reuses its durable feedback identity.
 */
export async function publishWorkerReport(
  { launcher, wsBridge }: Pick<RouteContext, "launcher" | "wsBridge">,
  workerId: string,
  text: string,
) {
  const resolveAssignment = () => {
    const worker = launcher.getSession(workerId);
    const leaderId = worker?.herdedBy;
    const session = wsBridge.getSession(workerId);
    if (!leaderId || worker?.isOrchestrator || !session?.isGenerating) {
      throw new Error("Reports require a generating, herded worker with an active Work assignment");
    }
    const leader = wsBridge.getSession(leaderId);
    const rows = [...(leader?.board.values() ?? [])].filter(
      (row) => row.worker === workerId && row.status === "WORKING",
    );
    const routeQuest = session.activeTurnRoute?.questId;
    const candidates = routeQuest ? rows.filter((row) => row.questId === routeQuest) : rows;
    if (candidates.length !== 1) throw new Error("Report requires one unambiguous current Work assignment");
    const row = candidates[0]!;
    if (session.activeTurnRoute?.threadKey && session.activeTurnRoute.threadKey !== row.questId) {
      throw new Error("Report route does not match the current Work assignment");
    }
    if (getQuestJourneyCurrentPhaseId(row.journey, row.status) !== "work") {
      throw new Error("Reports require the current Work occurrence");
    }
    return {
      leaderId,
      row: structuredClone(row),
      phaseIndex: getQuestJourneyCurrentPhaseIndex(row.journey, row.status),
    };
  };

  const assignment = resolveAssignment();
  let entryId = "";
  let reused = false;
  const quest = await questStore.patchQuestForOwner(
    assignment.row.questId,
    { kind: "takode", sessionId: workerId },
    (current) => {
      const latest = resolveAssignment();
      if (
        latest.leaderId !== assignment.leaderId ||
        latest.row.questId !== assignment.row.questId ||
        latest.phaseIndex !== assignment.phaseIndex ||
        latest.row.createdAt !== assignment.row.createdAt ||
        current.status !== "in_progress" ||
        getTakodeQuestOwnerSessionId(current) !== workerId ||
        current.leaderSessionId !== assignment.leaderId
      ) {
        throw new Error("Report assignment changed before it could be recorded");
      }
      const scope = resolveQuestFeedbackDocumentation({
        quest: current,
        authorSessionId: workerId,
        request: { phase: "work", kind: "phase-finding" },
        boardRows: [{ leaderSessionId: latest.leaderId, row: latest.row }],
      });
      if (scope.error || !scope.entryPatch.phaseOccurrenceId || !scope.entryPatch.journeyRunId) {
        throw new Error(scope.error ?? "Report requires a durable Work occurrence");
      }
      entryId = `worker-report:${createHash("sha256")
        .update(JSON.stringify([current.questId, workerId, scope.entryPatch.phaseOccurrenceId, text]))
        .digest("hex")}`;
      const feedback = current.feedback ?? [];
      reused = feedback.some((entry) => entry.entryId === entryId);
      if (reused) return null;
      const entry: QuestFeedbackEntry = {
        ...scope.entryPatch,
        entryId,
        author: "agent",
        authorSessionId: workerId,
        text,
        ts: Date.now(),
      };
      return { feedback: [...feedback, entry], ...(scope.journeyRuns ? { journeyRuns: scope.journeyRuns } : {}) };
    },
  );
  if (!quest) throw new Error("Quest not found");
  const feedbackIndex = (quest.feedback ?? []).findIndex((entry) => entry.entryId === entryId);
  const entry = quest.feedback![feedbackIndex]!;
  if (entry.deletedAt) throw new Error("This report was deleted; it cannot be resent");
  const report: WorkerReportReference = {
    id: entryId,
    leaderSessionId: assignment.leaderId,
    journeyRunId: entry.journeyRunId!,
    phaseOccurrenceId: entry.phaseOccurrenceId!,
    phasePosition: entry.phasePosition!,
    boardCreatedAt: assignment.row.createdAt,
    feedbackIndex,
    preview: text.trim().replace(/\s+/g, " ").slice(0, 240),
  };
  const currentRow = wsBridge.getSession(assignment.leaderId)?.board.get(assignment.row.questId);
  const stillAssigned =
    launcher.getSession(workerId)?.herdedBy === assignment.leaderId &&
    currentRow?.worker === workerId &&
    currentRow.status === "WORKING" &&
    currentRow.createdAt === report.boardCreatedAt &&
    getQuestJourneyCurrentPhaseIndex(currentRow.journey, currentRow.status) === report.phasePosition - 1;
  const queued = !!stillAssigned && wsBridge.emitWorkerReportCheckpoint(workerId, assignment.row.questId, report);
  if (!reused) broadcastQuestUpdate(wsBridge, quest);
  return { ok: true, recorded: true, queued, reused, questId: quest.questId, feedbackIndex, reportId: entryId };
}
