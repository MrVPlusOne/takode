import { useEffect, useMemo, useState } from "react";
import type { QuestListPreview } from "../../types.js";
import type { QuestJourneyPhaseId } from "../../../shared/quest-journey.js";
import { useStore } from "../../store.js";
import { buildQuestJourneyContextByQuestId } from "../../utils/quest-journey-context.js";
import { QuestmasterPage } from "../QuestmasterPage.js";
import { QuestmasterQuestRow } from "../QuestmasterQuestList.js";

const JOURNEY_PHASE_CYCLE: QuestJourneyPhaseId[] = ["alignment", "work", "user-checkpoint", "work", "memory"];

function buildLongJourneyPhaseIds(): QuestJourneyPhaseId[] {
  return Array.from({ length: 38 }, (_, index) => JOURNEY_PHASE_CYCLE[index % JOURNEY_PHASE_CYCLE.length]);
}

/** Seeds the demo quests and board once; returns true after they are in the store. */
function usePlaygroundQuestmasterState(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    useStore.setState((state) => {
      const now = Date.now();
      const longJourneyPhaseIds = buildLongJourneyPhaseIds();
      const quests = state.quests.filter((quest) => !["q-901", "q-902"].includes(quest.questId));
      const sessionBoards = new Map(state.sessionBoards);
      const leaderBoard = (sessionBoards.get("playground-questmaster-leader") ?? []).filter(
        (row) => row.questId !== "q-902",
      );
      sessionBoards.set("playground-questmaster-leader", [
        {
          questId: "q-902",
          title: "Simplify Questmaster compact status",
          worker: "playground-questmaster-worker",
          workerNum: 902,
          status: "WORKING",
          updatedAt: now - 15_000,
          journey: {
            mode: "active",
            phaseIds: longJourneyPhaseIds,
            currentPhaseId: longJourneyPhaseIds[20],
            activePhaseIndex: 20,
            phaseNotes: {
              "15": "Visible clamp boundary note in the default hover window.",
              "31": "Later phase note appears after expanding omitted phases.",
            },
          },
        },
        ...leaderBoard,
      ]);

      return {
        quests: [
          {
            id: "q-901-v3",
            questId: "q-901",
            version: 3,
            title: "Completed quest keeps rows calm",
            status: "done" as const,
            description: "Keep completed rows focused on the title and one summary line.",
            tldr: "Completed row references [q-986](quest:q-986) while omitting the old review-check progress column, even when this TLDR wraps across authoring lines.",
            createdAt: now - 300_000,
            statusChangedAt: now - 200_000,
            updatedAt: now - 10_000,
            sessionId: "playground-questmaster-worker",
            claimedAt: now - 260_000,
            completedAt: now - 120_000,
            verificationInboxUnread: true,
            verificationItems: [
              { text: "Review completed status copy", checked: false },
              { text: "Review TLDR links render", checked: true },
            ],
            relatedQuests: [
              { questId: "q-801", kind: "follow_up_of" as const, explicit: true },
              { questId: "q-803", kind: "has_follow_up" as const, explicit: true },
              { questId: "q-804", kind: "referenced_by" as const, explicit: false },
            ],
            debriefTldr: "This debrief is intentionally absent from rows.",
            feedbackSummary: { humanTotal: 2, humanUnaddressed: 1, humanAddressed: 1 },
            tags: ["ui", "questmaster"],
          },
          {
            id: "q-902-v1",
            questId: "q-902",
            version: 1,
            title: "Active Journey phase appears in Status",
            status: "in_progress" as const,
            description: "Active Journey rows show the current phase in Status.",
            tldr: "Hover the active status to inspect a long Quest Journey preview clamped around the current phase.",
            createdAt: now - 240_000,
            statusChangedAt: now - 180_000,
            updatedAt: now - 15_000,
            sessionId: "playground-questmaster-worker",
            leaderSessionId: "playground-questmaster-leader",
            claimedAt: now - 180_000,
            tags: ["ui", "quest-journey"],
          },
          ...quests,
        ],
        sessionBoards,
        sdkSessions: [
          ...state.sdkSessions.filter(
            (session) =>
              !["playground-questmaster-worker", "playground-questmaster-leader"].includes(session.sessionId),
          ),
          {
            sessionId: "playground-questmaster-worker",
            sessionNum: 902,
            state: "connected" as const,
            cwd: "/tmp/playground",
            createdAt: now - 240_000,
            archived: false,
          },
          {
            sessionId: "playground-questmaster-leader",
            sessionNum: 1286,
            state: "connected" as const,
            cwd: "/tmp/playground",
            createdAt: now - 300_000,
            archived: false,
          },
        ],
        questmasterCompactSort: { column: "updated" as const, direction: "desc" as const },
        questmasterSearchQuery: "",
        questmasterSelectedTags: [],
      };
    });
    setReady(true);
  }, []);
  return ready;
}

/** The whole page, laid out for this window's width (phone below 768 px, desktop above). */
export function PlaygroundQuestmasterDemo() {
  // The page takes its first rows from the store when it mounts, so it waits for the seeded quests.
  const ready = usePlaygroundQuestmasterState();
  return (
    <div className="h-[520px] overflow-hidden rounded-xl border border-cc-border bg-cc-bg">
      {ready && <QuestmasterPage isActive={false} />}
    </div>
  );
}

/** Phone rows at phone width, whatever this window's width, so both layouts can be compared. */
export function PlaygroundQuestmasterPhoneRows() {
  usePlaygroundQuestmasterState();
  const allQuests = useStore((state) => state.quests);
  const sessionBoards = useStore((state) => state.sessionBoards);
  const sessionCompletedBoards = useStore((state) => state.sessionCompletedBoards);
  const quests = useMemo(
    () => allQuests.filter((quest) => ["q-901", "q-902"].includes(quest.questId)) as unknown as QuestListPreview[],
    [allQuests],
  );
  const journeyContexts = useMemo(
    () => buildQuestJourneyContextByQuestId(quests, sessionBoards, sessionCompletedBoards),
    [quests, sessionBoards, sessionCompletedBoards],
  );
  return (
    <div className="w-full max-w-[430px] overflow-hidden rounded-xl border border-cc-border bg-cc-card divide-y divide-cc-border/60">
      {quests.map((quest) => (
        <QuestmasterQuestRow
          key={quest.id}
          quest={quest}
          layout="phone"
          journeyContext={journeyContexts.get(quest.questId.toLowerCase())}
          searchText=""
          onOpenQuest={() => undefined}
        />
      ))}
    </div>
  );
}
