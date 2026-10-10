/**
 * Diff access through the quest banner chip: the chip label states (commits, changes, both, none), the
 * chip in a leader quest thread, a worker's quest banner, a session without a quest, the leader Main
 * banner, and the diff view's back button and sections. The top bar has no Diff button any more.
 */
import { useEffect } from "react";
import { useStore } from "../../store.js";
import type { BoardRowData } from "../BoardTable.js";
import { DiffChipButton, SessionDiffBanner } from "../DiffChip.js";
import { DiffTabView } from "../DiffTabView.js";
import { QuestThreadBanner, type QuestThreadBannerRow } from "../QuestThreadBanner.js";
import { WorkBoardBar } from "../WorkBoardBar.js";
import type { SdkSessionInfo } from "../../types.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.UTC(2026, 9, 10, 9, 0);
const LEADER_ID = "playground-diff-leader";
const WORKER_ID = "playground-diff-worker";
const CHANGES_WORKER_ID = "playground-diff-worker-2";
const SOLO_ID = "playground-diff-solo";
const CLEAN_WORKER_ID = "playground-diff-clean-worker";
const noop = () => {};

const BOARD_ROWS: BoardRowData[] = [
  {
    questId: "q-9428",
    title: "Move diff access into the quest banner chip",
    worker: WORKER_ID,
    workerNum: 9927,
    status: "WORKING",
    updatedAt: NOW,
    journey: { mode: "active", phaseIds: ["work", "memory"], currentPhaseId: "work", activePhaseIndex: 0 },
  },
  {
    questId: "q-9430",
    title: "Uncommitted work, no commits yet",
    worker: CHANGES_WORKER_ID,
    workerNum: 9931,
    status: "WORKING",
    updatedAt: NOW,
    journey: { mode: "active", phaseIds: ["work", "memory"], currentPhaseId: "work", activePhaseIndex: 0 },
  },
  {
    questId: "q-9431",
    title: "Queued quest with nothing yet",
    status: "QUEUED",
    updatedAt: NOW,
    journey: { mode: "proposed", phaseIds: ["work", "memory"] },
  },
];

const SESSIONS: SdkSessionInfo[] = [
  {
    sessionId: LEADER_ID,
    sessionNum: 9900,
    state: "connected",
    cwd: "/playground/leader",
    createdAt: NOW,
    name: "Diff access leader",
    isOrchestrator: true,
  },
  {
    sessionId: WORKER_ID,
    sessionNum: 9927,
    state: "connected",
    cwd: "/playground/wt/diff-worker",
    createdAt: NOW,
    name: "Diff chip worker",
    isWorktree: true,
    totalLinesAdded: 86,
    totalLinesRemoved: 12,
    herdedBy: LEADER_ID,
    claimedQuestId: "q-9428",
    claimedQuestTitle: "Move diff access into the quest banner chip",
    claimedQuestStatus: "in_progress",
    claimedQuestLeaderSessionId: LEADER_ID,
  },
  {
    sessionId: CHANGES_WORKER_ID,
    sessionNum: 9931,
    state: "connected",
    cwd: "/playground/wt/diff-worker-2",
    createdAt: NOW,
    name: "Changes-only worker",
    isWorktree: true,
    totalLinesAdded: 15,
    totalLinesRemoved: 0,
  },
  {
    sessionId: CLEAN_WORKER_ID,
    sessionNum: 9935,
    state: "connected",
    cwd: "/playground/wt/clean",
    createdAt: NOW,
    name: "Worker with a clean checkout",
    isWorktree: true,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
  },
  {
    sessionId: SOLO_ID,
    sessionNum: 9940,
    state: "connected",
    cwd: "/playground/wt/solo",
    createdAt: NOW,
    name: "Session without a quest",
    isWorktree: true,
    totalLinesAdded: 40,
    totalLinesRemoved: 3,
  },
];

function bannerRow(row: BoardRowData): QuestThreadBannerRow {
  return {
    threadKey: row.questId,
    questId: row.questId,
    title: row.title ?? row.questId,
    boardStatus: row.status,
    journey: row.journey,
    boardRow: row,
    section: "active",
    rowStatus: row.worker
      ? { worker: { sessionId: row.worker, sessionNum: row.workerNum, status: "running" }, reviewer: null }
      : undefined,
  };
}

/** Seeds the sessions, board and commits the chips resolve from; re-seeds if another section replaces them. */
function useDiffAccessSeed(): boolean {
  const seeded = useStore(
    (state) => state.sessionBoards.has(LEADER_ID) && state.sdkSessions.some((session) => session.sessionId === SOLO_ID),
  );
  useEffect(() => {
    if (seeded) return;
    const state = useStore.getState();
    useStore.setState({
      sdkSessions: [
        ...state.sdkSessions.filter((session) => !SESSIONS.some((seed) => seed.sessionId === session.sessionId)),
        ...SESSIONS,
      ],
    });
    state.setSessionBoard(LEADER_ID, BOARD_ROWS);
    state.setSessionBoardRowStatuses(LEADER_ID, {});
    // The leader's own checkout has two edited files, so its Main banner shows a chip.
    state.addChangedFile(LEADER_ID, "/playground/leader/src/App.tsx");
    state.addChangedFile(LEADER_ID, "/playground/leader/src/store.ts");
    for (const [questId, commitShas] of [
      ["q-9428", ["a1b2c3d4e5f6", "b2c3d4e5f6a1"]],
      ["q-9430", []],
      ["q-9431", []],
    ] as const) {
      state.upsertQuestTitlePreview({
        questId,
        title: questId,
        version: 1,
        updatedAt: NOW,
        commitShas: [...commitShas],
      });
    }
  }, [seeded]);
  return seeded;
}

function Framed({ label, phone, children }: { label: string; phone?: boolean; children: React.ReactNode }) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-cc-border bg-cc-card ${phone ? "w-[430px] max-w-full" : ""}`}
    >
      <div className="border-b border-cc-border/70 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/70">
        {label}
      </div>
      {children}
    </div>
  );
}

export function PlaygroundDiffAccessSection() {
  const seeded = useDiffAccessSeed();
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Diff Access from the Quest Banner"
        description="The top bar has no Diff button. The quest banner chip is the one place to open a quest's code: its recorded commits plus the worker's changes, with a short plain-text label that says whether there are commits, changes, both or nothing. A session without a quest shows a slim banner with the chip only while it has changes, and the leader's Main banner shows a chip only while the leader's own checkout has changes. The diff view has its own back button and, for quests with a worker, a Commits / Worker changes switch."
      >
        <div className="space-y-4" data-testid="playground-diff-access">
          <Card label="Chip labels">
            <div className="flex flex-wrap items-center gap-3" data-testid="playground-diff-chip-labels">
              <DiffChipButton
                commitCount={2}
                changes={{ linesAdded: 0, linesRemoved: 0, changedFiles: 0 }}
                title="Commits only"
                onOpen={noop}
              />
              <DiffChipButton
                commitCount={2}
                changes={{ linesAdded: 86, linesRemoved: 12, changedFiles: 0 }}
                title="Commits and changes"
                onOpen={noop}
              />
              <DiffChipButton
                commitCount={0}
                changes={{ linesAdded: 1234, linesRemoved: 56, changedFiles: 0 }}
                title="Changes only"
                onOpen={noop}
              />
              <DiffChipButton
                commitCount={0}
                changes={{ linesAdded: 0, linesRemoved: 0, changedFiles: 0 }}
                title="Nothing yet"
                onOpen={noop}
              />
              <DiffChipButton
                commitCount={null}
                changes={{ linesAdded: 0, linesRemoved: 0, changedFiles: 3 }}
                title="Browser-observed files"
                onOpen={noop}
              />
            </div>
          </Card>
          {seeded && (
            <>
              <Card label="Leader quest threads (desktop and 430px phone)">
                <div className="flex flex-wrap gap-4">
                  <div className="grid min-w-0 flex-1 gap-3">
                    {BOARD_ROWS.map((row) => (
                      <Framed key={row.questId} label={row.title ?? row.questId}>
                        <QuestThreadBanner
                          row={bannerRow(row)}
                          threadKey={row.questId}
                          monitorSessionId={LEADER_ID}
                          diffSessionId={LEADER_ID}
                        />
                      </Framed>
                    ))}
                  </div>
                  <Framed label="Phone" phone>
                    <QuestThreadBanner
                      row={bannerRow(BOARD_ROWS[0]!)}
                      threadKey={BOARD_ROWS[0]!.questId}
                      monitorSessionId={LEADER_ID}
                      diffSessionId={LEADER_ID}
                    />
                  </Framed>
                </div>
              </Card>
              <Card label="Leader Main banner while the leader's checkout has changes">
                <div className="overflow-hidden rounded-lg border border-cc-border" data-testid="playground-diff-main">
                  <WorkBoardBar sessionId={LEADER_ID} currentThreadKey="main" onSelectThread={noop} />
                </div>
              </Card>
              <Card label="Worker session quest banner, and a session without a quest">
                <div className="grid gap-3" data-testid="playground-diff-worker-banners">
                  <Framed label="Worker with a quest">
                    <QuestThreadBanner
                      row={{ ...bannerRow(BOARD_ROWS[0]!), leaderSessionId: LEADER_ID }}
                      threadKey={BOARD_ROWS[0]!.questId}
                      variant="session"
                      currentSessionId={WORKER_ID}
                      diffSessionId={WORKER_ID}
                    />
                  </Framed>
                  <Framed label="Session without a quest">
                    <SessionDiffBanner sessionId={SOLO_ID} />
                  </Framed>
                </div>
              </Card>
              <Card label="Diff view opened from a quest chip">
                <div
                  className="h-56 overflow-hidden rounded-lg border border-cc-border"
                  data-testid="playground-diff-view"
                >
                  <DiffTabView
                    target={{
                      kind: "quest",
                      questId: "q-9431",
                      // A clean worker keeps the fixture on the commits section, which needs no live git lookups.
                      workerSessionId: CLEAN_WORKER_ID,
                      changesOwner: "worker",
                      label: "q-9431 diff",
                      title: "Show q-9431 commits and changes",
                    }}
                    onBack={noop}
                  />
                </div>
              </Card>
            </>
          )}
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
