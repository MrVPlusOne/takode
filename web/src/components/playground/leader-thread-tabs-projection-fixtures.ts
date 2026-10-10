import { useEffect } from "react";
import type {
  LeaderThreadTabsProjectionJourney,
  LeaderThreadTabsProjectionTab,
} from "../../../shared/leader-thread-tabs-projection.js";
import { useStore } from "../../store.js";
import { summarizeQuestJourneyDurations } from "../../../shared/quest-journey.js";
import type { BoardRowData } from "../BoardTable.js";

/** Build the same compact Journey shape that the synchronized server projection sends to Playground clients. */
export function buildPlaygroundProjectedJourney(
  row: BoardRowData | undefined,
  completed: boolean,
): LeaderThreadTabsProjectionJourney | null {
  if (!row?.journey) return null;
  const phaseIds = row.journey.phaseIds.slice(0, 100);
  const durationSummary = summarizeQuestJourneyDurations(row.journey, row.status, {
    allowActiveElapsed: !completed,
    maxPhaseCount: phaseIds.length,
  });
  return {
    mode: row.journey.mode ?? null,
    phaseIds,
    currentPhaseId: row.journey.currentPhaseId ?? null,
    activePhaseIndex: row.journey.activePhaseIndex ?? null,
    phaseCount: phaseIds.length,
    durationSummary,
  };
}

/** Leader that Playground handoff tabs name as now running their quests. */
export const PLAYGROUND_HANDOFF_LEADER_SESSION_ID = "playground-handoff-leader";
export const PLAYGROUND_HANDOFF_LEADER_SESSION_NUM = 2851;

/**
 * Tabs a leader keeps after handing quests away: one another leader now runs in
 * Work, one no leader's board holds. Shapes match the server projection.
 */
export function buildPlaygroundHandoffTabs(updatedAt: number): LeaderThreadTabsProjectionTab[] {
  const tab = (threadKey: string, title: string): LeaderThreadTabsProjectionTab => ({
    threadKey,
    questId: threadKey,
    title,
    boardStatus: null,
    journey: null,
    sourceLeaderSessionId: null,
    sourceRowCreatedAt: null,
    workerSessionId: null,
    workerSessionNum: null,
    ownership: "off-board",
    active: false,
    queued: false,
    proposed: false,
    neverStartedScheduled: false,
    completed: false,
    canClose: true,
    attention: {
      needsInput: false,
      mutedNeedsInput: false,
      reviewUnread: false,
      updatedAt: 0,
    },
    updatedAt,
  });
  return [
    {
      ...tab("q-9010", "Restart must not hang on accepted work"),
      boardStatus: "WORKING",
      journey: {
        mode: "active",
        phaseIds: ["work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 0,
        phaseCount: 2,
        durationSummary: null,
      },
      sourceLeaderSessionId: PLAYGROUND_HANDOFF_LEADER_SESSION_ID,
      sourceRowCreatedAt: updatedAt,
      workerSessionId: "playground-handoff-worker",
      workerSessionNum: 2919,
      ownership: "other-leader",
    },
    tab("q-9011", "Investigate the stale worker preview"),
  ];
}

/** Other Playground sections replace sdkSessions when they mount, so re-seed the handoff leader whenever it goes missing. */
export function usePlaygroundHandoffLeaderSession(): void {
  const seeded = useStore((state) =>
    state.sdkSessions.some((session) => session.sessionId === PLAYGROUND_HANDOFF_LEADER_SESSION_ID),
  );
  useEffect(() => {
    if (seeded) return;
    useStore.setState((state) => ({
      sdkSessions: [
        ...state.sdkSessions,
        {
          sessionId: PLAYGROUND_HANDOFF_LEADER_SESSION_ID,
          state: "connected" as const,
          cwd: "/home/coder/code/takode",
          createdAt: Date.now() - 600_000,
          sessionNum: PLAYGROUND_HANDOFF_LEADER_SESSION_NUM,
          name: "DevBox Takode",
          isOrchestrator: true,
        },
      ],
    }));
  }, [seeded]);
}
