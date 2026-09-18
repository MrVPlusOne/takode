import { useState } from "react";
import { QuestThreadBanner, type QuestThreadBannerRow } from "../ChatView.js";

export function PlaygroundQuestBannerExamples() {
  const compactQuestThreadBannerRows: Array<{ label: string; threadKey: string; row: QuestThreadBannerRow }> = [
    {
      label: "Active Work phase",
      threadKey: "q-9001",
      row: {
        threadKey: "q-9001",
        questId: "q-9001",
        title: "Finish data-flow cleanup",
        boardStatus: "WORKING",
        commitShas: ["abc1234def5678", "def5678abc1234"],
        section: "active" as const,
        journey: {
          mode: "active" as const,
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
          phaseNotes: { "1": "Work owns implementation, validation, and sync evidence." },
        },
        journeyDurationSummary: {
          phaseDurationsMs: [60_000],
          activePhaseStartedAt: Date.now() - 180_000,
        },
        rowStatus: {
          worker: { sessionId: "playground-thread-worker", sessionNum: 1321, name: "Clear Mesa", status: "running" },
        },
        boardRow: {
          questId: "q-9001",
          title: "Finish data-flow cleanup",
          worker: "playground-thread-worker",
          workerNum: 1321,
          status: "WORKING",
          createdAt: 1,
          updatedAt: 2,
        },
      },
    },
    {
      label: "Queued wait",
      threadKey: "q-968",
      row: {
        threadKey: "q-968",
        questId: "q-968",
        title: "Show wait target in thread banner",
        boardStatus: "QUEUED",
        commitShas: [],
        section: "active" as const,
        journey: {
          mode: "active" as const,
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
        },
        boardRow: {
          questId: "q-968",
          title: "Show wait target in thread banner",
          status: "QUEUED",
          waitFor: ["#1801", "q-1367", "free-worker"],
          updatedAt: 1,
        },
      },
    },
    {
      label: "Stale queued after done",
      threadKey: "q-1812",
      row: {
        threadKey: "q-1812",
        questId: "q-1812",
        title: "Clear stale queued thread header",
        status: "done",
        boardStatus: "QUEUED",
        commitShas: [],
        section: "done" as const,
        journey: {
          mode: "active" as const,
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
        },
        boardRow: {
          questId: "q-1812",
          title: "Clear stale queued thread header",
          status: "QUEUED",
          waitFor: ["free-worker"],
          updatedAt: 1,
        },
      },
    },
    {
      label: "Completed Journey",
      threadKey: "q-9004",
      row: {
        threadKey: "q-9004",
        questId: "q-9004",
        title: "Finish completed Journey display",
        boardStatus: "DONE",
        section: "done" as const,
        journey: {
          mode: "active" as const,
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "memory",
          phaseNotes: { "1": "Work completed with verification evidence.", "2": "Memory closed durable state." },
        },
        journeyDurationSummary: {
          phaseDurationsMs: [60_000, null, 120_000],
          activePhaseStartedAt: null,
        },
        boardRow: { questId: "q-9004", title: "Finish completed Journey display", worker: "worker-964", updatedAt: 1 },
        rowStatus: {
          worker: { sessionId: "playground-thread-worker-done", sessionNum: 1321, status: "idle" },
          reviewer: { sessionId: "playground-thread-reviewer-done", sessionNum: 1323, status: "idle" },
        },
      },
    },
    {
      label: "Quiet header during a user checkpoint",
      threadKey: "q-9005",
      row: {
        threadKey: "q-9005",
        questId: "q-9005",
        title: "Review the navigation comparison and next steps",
        boardStatus: "USER_CHECKPOINTING",
        commitShas: ["abc1234def5678", "def5678abc1234"],
        section: "active",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
          currentPhaseId: "user-checkpoint",
          activePhaseIndex: 2,
        },
        boardRow: {
          questId: "q-9005",
          title: "Review the navigation comparison and next steps",
          status: "USER_CHECKPOINTING",
          waitForInput: ["n-430"],
          worker: "playground-thread-worker",
          workerNum: 1321,
          updatedAt: 1,
        },
        rowStatus: {
          worker: { sessionId: "playground-thread-worker", sessionNum: 1321, name: "Clear Mesa", status: "idle" },
        },
      },
    },
    {
      label: "Worker session banner with timer",
      threadKey: "q-966",
      row: {
        threadKey: "q-966",
        questId: "q-966",
        title: "Polish current quest banner chips",
        status: "in_progress",
        boardStatus: "WORKING",
        section: "active" as const,
        leaderSessionId: "playground-thread-panel-wait-for",
        leaderSessionNum: 1286,
        journey: {
          mode: "active" as const,
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
        },
        rowStatus: {
          worker: { sessionId: "playground-worker-banner", sessionNum: 1364, status: "idle" },
        },
      },
    },
  ];
  const [checkpoint, setCheckpoint] = useState(false);
  const checkpointRow = compactQuestThreadBannerRows[4].row;
  const mobileRow: QuestThreadBannerRow = {
    ...checkpointRow,
    boardStatus: checkpoint ? "USER_CHECKPOINTING" : "WORKING",
    journey: {
      ...checkpointRow.journey!,
      currentPhaseId: checkpoint ? "user-checkpoint" : "work",
      activePhaseIndex: checkpoint ? 2 : 1,
    },
    rowStatus: {
      ...checkpointRow.rowStatus,
      reviewer: { sessionId: "playground-older-reviewer", sessionNum: 1450, status: "disconnected" },
    },
  };
  return (
    <>
      <div className="grid max-w-5xl gap-3 lg:grid-cols-2">
        {compactQuestThreadBannerRows.map(({ label, row, threadKey }) => (
          <div key={threadKey} className="overflow-hidden rounded-lg border border-cc-border bg-cc-card">
            <div className="border-b border-cc-border/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/70">
              {label}
            </div>
            <QuestThreadBanner
              row={row}
              threadKey={threadKey}
              variant={label === "Worker session banner with timer" ? "session" : "thread"}
              currentSessionId={label === "Worker session banner with timer" ? "playground-worker-banner" : undefined}
            />
          </div>
        ))}
      </div>
      <div
        data-testid="playground-mobile-participant-labels"
        className="w-[320px] max-w-full overflow-hidden rounded-lg border border-cc-border bg-cc-card"
      >
        <div className="border-b border-cc-border/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/70">
          Mobile 320px full role labels
        </div>
        <QuestThreadBanner
          row={compactQuestThreadBannerRows[0].row}
          threadKey={compactQuestThreadBannerRows[0].threadKey}
        />
        <QuestThreadBanner
          row={compactQuestThreadBannerRows[compactQuestThreadBannerRows.length - 1].row}
          threadKey={compactQuestThreadBannerRows[compactQuestThreadBannerRows.length - 1].threadKey}
          variant="session"
          currentSessionId="playground-worker-banner"
        />
      </div>

      <div
        data-testid="playground-mobile-quest-banner"
        className="w-full max-w-[430px] overflow-hidden rounded-lg border border-cc-border bg-cc-card"
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-cc-border/70 px-3 py-1.5 text-xs">
          <span>Mobile banner: collapse, then change phase</span>
          <button
            type="button"
            className="rounded px-2 py-1 text-cc-primary hover:bg-cc-hover"
            onClick={() => setCheckpoint((value) => !value)}
          >
            {checkpoint ? "Show Work" : "Show User Checkpoint"}
          </button>
        </div>
        <QuestThreadBanner
          row={mobileRow}
          threadKey={mobileRow.threadKey}
          monitorSessionId="playground-mobile-banner"
        />
      </div>
    </>
  );
}
