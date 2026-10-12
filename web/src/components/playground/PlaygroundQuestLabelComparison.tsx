import { useStore } from "../../store.js";
import type { QuestmasterTask, SdkSessionInfo } from "../../types.js";
import { QuestPreviewCardContent } from "../QuestPreviewCardContent.js";
import { Card } from "./shared.js";

const HOUR = 3_600_000;
const WORKER_ID = "playground-label-worker";
const LEADER_ID = "playground-label-leader";

/**
 * One quest per lifecycle state, shown as its preview card next to a button that opens the same
 * quest in the full quest view, so the two views' status and section labels can be compared.
 */
export function PlaygroundQuestLabelComparison() {
  const quests = buildLabelComparisonQuests(Date.now());
  return (
    <Card label="Preview and quest view labels">
      <div className="grid gap-3 sm:grid-cols-2">
        {quests.map((quest) => (
          <div key={quest.questId} className="min-w-0 space-y-2">
            <div
              data-testid={`playground-label-preview-${quest.questId}`}
              className="rounded-xl border border-cc-border bg-cc-card p-4 shadow-sm"
            >
              <QuestPreviewCardContent quest={quest} />
            </div>
            <button
              type="button"
              onClick={() => openLabelComparisonQuest(quest)}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-cc-border hover:bg-cc-hover cursor-pointer"
            >
              Open {quest.questId} in the quest view
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

function openLabelComparisonQuest(quest: QuestmasterTask) {
  const now = Date.now();
  const sessions = [
    { sessionId: WORKER_ID, sessionNum: 2970, name: "Label worker" },
    { sessionId: LEADER_ID, sessionNum: 2851, name: "Label leader", isOrchestrator: true },
  ].map((session) => ({ ...session, state: "connected", cwd: "/repo/takode", createdAt: now }) as SdkSessionInfo);
  useStore.setState((state) => ({
    questDetails: new Map(state.questDetails).set(quest.questId, quest),
    sdkSessions: [
      ...state.sdkSessions.filter((s) => s.sessionId !== WORKER_ID && s.sessionId !== LEADER_ID),
      ...sessions,
    ],
  }));
  useStore.getState().openQuestOverlay(quest.questId);
}

function buildLabelComparisonQuests(now: number): QuestmasterTask[] {
  const base = {
    version: 3,
    createdAt: now - 6 * HOUR,
    updatedAt: now - HOUR,
    sessionId: WORKER_ID,
    leaderSessionId: LEADER_ID,
    claimedAt: now - 5 * HOUR,
    tags: ["ui", "bugfix"],
  };
  const description = "The tab group bar briefly flashes when a viewed quest tab moves from In progress to Done.";
  return [
    {
      ...base,
      id: "q-8801-v3",
      questId: "q-8801",
      title: "Quest in its Work phase",
      status: "in_progress",
      description,
      tldr: "Find why the tab bar flashes and make the move smooth.",
      journeyRuns: [labelJourneyRun("q-8801", now, 0, "active")],
    },
    {
      ...base,
      id: "q-8802-v3",
      questId: "q-8802",
      title: "Finished quest",
      status: "done",
      description,
      tldr: "Find why the tab bar flashes and make the move smooth.",
      completedAt: now - HOUR,
      debrief: "The tab now moves between groups without an intermediate unread group.",
      debriefTldr: "Tabs move between groups without flashing.",
      journeyRuns: [labelJourneyRun("q-8802", now, 3, "completed")],
    },
    {
      ...base,
      id: "q-8803-v3",
      questId: "q-8803",
      title: "Cancelled quest",
      status: "done",
      cancelled: true,
      description,
      completedAt: now - 2 * HOUR,
      notes: "Superseded by a broader tab redesign.",
    },
    {
      id: "q-8804-v1",
      questId: "q-8804",
      version: 1,
      title: "Refined quest waiting for dispatch",
      status: "refined",
      description: `## Problem\n\n${description}`,
      createdAt: now - 3 * HOUR,
      tags: ["ui", "improvement"],
    },
  ] as QuestmasterTask[];
}

function labelJourneyRun(questId: string, now: number, activeIndex: number, status: "active" | "completed") {
  const phaseIds = ["work", "user-checkpoint", "work", "memory"] as const;
  return {
    runId: `${questId}-run`,
    leaderSessionId: LEADER_ID,
    workerSessionId: WORKER_ID,
    workerSessionNum: 2970,
    source: "board" as const,
    phaseIds: [...phaseIds],
    status,
    createdAt: now - 5 * HOUR,
    updatedAt: now - HOUR,
    ...(status === "completed" ? { completedAt: now - HOUR } : {}),
    phaseOccurrences: phaseIds.map((phaseId, phaseIndex) => ({
      occurrenceId: `${questId}-run:p${phaseIndex + 1}`,
      phaseId,
      phaseIndex,
      phasePosition: phaseIndex + 1,
      phaseOccurrence: phaseIds.slice(0, phaseIndex + 1).filter((candidate) => candidate === phaseId).length,
      status:
        status === "completed" || phaseIndex < activeIndex
          ? ("completed" as const)
          : phaseIndex === activeIndex
            ? ("active" as const)
            : ("pending" as const),
      ...(phaseIndex === activeIndex && status === "active" ? { boardState: "WORKING" } : {}),
      startedAt: now - (5 - phaseIndex) * HOUR,
    })),
  };
}
