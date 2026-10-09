import type { LandingEntry } from "../../shared/landing-queue.js";
import type { QuestJourneyPhaseId } from "../../shared/quest-journey.js";
import type { LandingQueueManager } from "../landing-queue-manager.js";
import { LandingQuestHandoff } from "../landing-quest-handoff.js";
import { upsertBoardRow } from "../bridge/board-watchdog-controller.js";
import type { BoardRow, BoardRowLanding } from "../session-types.js";
import type { RouteContext } from "./context.js";
import { recordLandedDelivery } from "./landed-delivery.js";

/**
 * The landing-queue entry a worker hands its quest to Memory with: its own,
 * submitted for this quest, and not bounced or withdrawn.
 */
export async function resolveSubmittedLandingEntry(
  queue: LandingQueueManager | null,
  entryId: string,
  workerSessionId: string,
  questId: string,
): Promise<{ entry: LandingEntry } | { error: string }> {
  if (!queue) return { error: "This Takode server has no landing queue." };
  const entry = await queue.getEntry(entryId);
  if (!entry) return { error: `No landing entry ${entryId}.` };
  if (entry.sessionId !== workerSessionId)
    return { error: `Landing entry ${entryId} was submitted by another session.` };
  if (entry.questId?.toLowerCase() !== questId.toLowerCase())
    return {
      error: `Landing entry ${entryId} was submitted for ${entry.questId ?? "no quest"}, not ${questId}. Submit with \`takode land submit ${questId}\`.`,
    };
  if (entry.state === "bounced" || entry.state === "withdrawn")
    return {
      error: `Landing entry ${entryId} ${entry.state === "bounced" ? "bounced" : "was withdrawn"}: ${entry.reason ?? "no reason recorded"} Fix it, test and submit again, then hand the new entry to Memory.`,
    };
  return { entry };
}

/** The Journey with a Landing phase right after the Memory occurrence that the hand-off enters. */
export function withLandingAfterMemory(phaseIds: QuestJourneyPhaseId[], memoryIndex: number): QuestJourneyPhaseId[] {
  if (phaseIds[memoryIndex + 1] === "landing") return [...phaseIds];
  return [...phaseIds.slice(0, memoryIndex + 1), "landing", ...phaseIds.slice(memoryIndex + 1)];
}

export function boardRowLanding(
  entry: LandingEntry,
  workerSessionId: string,
  workPhaseOccurrenceId: string,
): BoardRowLanding {
  return {
    entryId: entry.id,
    workerSessionId,
    workPhaseOccurrenceId,
    ...(entry.preparationId ? { preparationId: entry.preparationId } : {}),
    branch: entry.target.branch,
    tip: entry.tip,
  };
}

/** The landing hand-off, wired to the live boards, quest store and session messages. */
export function createLandingQuestHandoff(deps: {
  launcher: RouteContext["launcher"];
  wsBridge: RouteContext["wsBridge"];
  workBoardStateDeps: Parameters<typeof upsertBoardRow>[2];
}): LandingQuestHandoff {
  const { launcher, wsBridge } = deps;
  return new LandingQuestHandoff({
    activeRows: () =>
      launcher.listSessions().flatMap((session) => {
        const bridgeSession = wsBridge.getSession(session.sessionId);
        return bridgeSession?.board
          ? [...bridgeSession.board.values()].map((row: BoardRow) => ({ leaderSessionId: session.sessionId, row }))
          : [];
      }),
    updateRow: (leaderSessionId, row) => {
      const session = wsBridge.getSession(leaderSessionId);
      if (session) upsertBoardRow(session as never, row, deps.workBoardStateDeps);
    },
    getEntry: async (entryId) => wsBridge.landingQueue?.getEntry(entryId),
    recordDelivery: (input) => recordLandedDelivery({ launcher, wsBridge }, input),
    completeQuest: async (questId, completion, workerSessionId) => {
      if (!wsBridge.completeLandedQuest) throw new Error("quest completion is not available");
      await wsBridge.completeLandedQuest(questId, completion, workerSessionId);
    },
    notify: (sessionId, text) =>
      void wsBridge.injectUserMessage(sessionId, text, { sessionId: "landing-queue", sessionLabel: "Landing Queue" }),
  });
}
