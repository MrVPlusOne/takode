/**
 * Work board readability and access states: the real board tables, the top-bar
 * Board button that opens the board from any leader thread, and the board as it
 * opens on a quest thread with its own view switch.
 */
import { useEffect } from "react";
import { useStore } from "../../store.js";
import { BoardTable, type BoardRowData } from "../BoardTable.js";
import { LeaderWorkboardTopBarButton } from "../leader-workboard-controls.js";
import { getQuestJourneyPhase } from "../../../shared/quest-journey.js";
import { activeBoardPhaseDots, type BoardPhaseDot } from "../leader-board-summary.js";
import { AttentionListPill } from "../GlobalAttentionMenu.js";
import { WorkBoardBar } from "../WorkBoardBar.js";
import type { BoardRowSessionStatus } from "../../types.js";
import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionTab,
} from "../../../shared/leader-thread-tabs-projection.js";
import { getSyncedProjectionValue } from "../../store-synced-projections.js";
import { buildLeaderActivePhaseSummary } from "../../../shared/leader-active-phase-summary.js";
import { buildPlaygroundProjectedJourney } from "./leader-thread-tabs-projection-fixtures.js";
import { Card, PlaygroundSectionGroup, Section } from "./shared.js";

const NOW = Date.UTC(2026, 9, 9, 18, 30);
const MINUTE = 60_000;

const ACTIVE_ROWS: BoardRowData[] = [
  {
    questId: "q-2420",
    title: "Phone shows empty session lists after relay restart",
    worker: "access-worker-1",
    workerNum: 2919,
    status: "WORKING",
    updatedAt: NOW - 4 * MINUTE,
    journey: {
      mode: "active",
      phaseIds: ["work", "memory"],
      currentPhaseId: "work",
      activePhaseIndex: 0,
    },
  },
  {
    questId: "q-2409",
    title: "Put newer Git first on the Condor host PATH",
    worker: "access-worker-2",
    workerNum: 2903,
    status: "USER_CHECKPOINTING",
    waitForInput: ["n-7"],
    updatedAt: NOW - 9 * MINUTE,
    journey: {
      mode: "active",
      phaseIds: ["work", "user-checkpoint", "work", "memory"],
      currentPhaseId: "user-checkpoint",
      activePhaseIndex: 1,
    },
  },
  {
    questId: "q-2421",
    title: "Relay proxy: forward host link compression",
    status: "QUEUED",
    waitFor: ["q-2420"],
    updatedAt: NOW - 12 * MINUTE,
    journey: { mode: "proposed", phaseIds: ["work", "memory"] },
  },
];

const COMPLETED_ROWS: BoardRowData[] = [
  {
    questId: "q-2412",
    title: "Fix login-shell PATH capture on remote hosts",
    worker: "access-worker-3",
    workerNum: 2906,
    status: "DONE",
    updatedAt: NOW - 140 * MINUTE,
    completedAt: NOW - 137 * MINUTE,
    journey: {
      mode: "active",
      phaseIds: ["work", "user-checkpoint", "work", "memory", "landing"],
    },
  },
  {
    questId: "q-2408",
    title: "Let Condor-hosted leaders land through the queue",
    worker: "access-worker-4",
    workerNum: 2904,
    status: "DONE",
    updatedAt: NOW - 165 * MINUTE,
    completedAt: NOW - 161 * MINUTE,
    journey: { mode: "active", phaseIds: ["work", "memory"] },
  },
];

const ROW_STATUSES: Record<string, BoardRowSessionStatus> = {
  "q-2420": {
    worker: {
      sessionId: "access-worker-1",
      sessionNum: 2919,
      name: "Relay fix",
      status: "running",
    },
    reviewer: null,
  },
  "q-2409": {
    worker: {
      sessionId: "access-worker-2",
      sessionNum: 2903,
      name: "Git PATH",
      status: "idle",
    },
    reviewer: null,
  },
  "q-2412": {
    worker: {
      sessionId: "access-worker-3",
      sessionNum: 2906,
      name: "PATH capture",
      status: "archived",
    },
    reviewer: null,
  },
  "q-2408": {
    worker: {
      sessionId: "access-worker-4",
      sessionNum: 2904,
      name: "Landing",
      status: "archived",
    },
    reviewer: null,
  },
};

const ACCESS_SESSION_ID = "playground-workboard-access";
const ACTIVE_DOTS = activeBoardPhaseDots(ACTIVE_ROWS);

/** Board button samples with 0, 1, 3, 5 and 7 quests in a Journey phase (seven overflows to "+N"). */
const DOT_SAMPLES: Array<{ label: string; dots: BoardPhaseDot[] }> = [
  [],
  ["work"],
  ["work", "user-checkpoint", "memory"],
  ["work", "work", "user-checkpoint", "memory", "landing"],
  ["work", "work", "work", "user-checkpoint", "memory", "landing", "work"],
].map((phaseIds) => ({
  label: `${phaseIds.length} active`,
  dots: phaseIds.map((phaseId, index) => ({ questId: `q-${900 + index}`, phase: getQuestJourneyPhase(phaseId)! })),
}));
const noop = () => {};

function projectedTab(row: BoardRowData, completed: boolean): LeaderThreadTabsProjectionTab {
  const queued = row.status === "QUEUED";
  return {
    threadKey: row.questId,
    questId: row.questId,
    title: row.title ?? row.questId,
    boardStatus: row.status ?? null,
    journey: buildPlaygroundProjectedJourney(row, completed),
    sourceLeaderSessionId: ACCESS_SESSION_ID,
    sourceRowCreatedAt: null,
    workerSessionId: row.worker ?? null,
    workerSessionNum: row.workerNum ?? null,
    ownership: "own",
    active: !queued && !completed,
    queued,
    proposed: false,
    neverStartedScheduled: queued,
    completed,
    canClose: completed,
    attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: row.updatedAt },
    updatedAt: row.updatedAt,
  };
}

/** Seeds a leader whose board is open on a quest thread; re-seeds if another section replaces its state. */
function useAccessLeaderSeed(): boolean {
  const seeded = useStore(
    (state) =>
      state.sessionBoards.has(ACCESS_SESSION_ID) &&
      state.leaderWorkboardViews.get(ACCESS_SESSION_ID) !== undefined &&
      getSyncedProjectionValue(state, LEADER_THREAD_TABS_PROJECTION, ACCESS_SESSION_ID) !== undefined,
  );
  useEffect(() => {
    if (seeded) return;
    const state = useStore.getState();
    state.setSessionBoard(ACCESS_SESSION_ID, ACTIVE_ROWS);
    state.setSessionCompletedBoard(ACCESS_SESSION_ID, COMPLETED_ROWS);
    state.setSessionBoardRowStatuses(ACCESS_SESSION_ID, ROW_STATUSES);
    state.applySyncedProjectionSnapshot({
      type: "synced_projection_snapshot",
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: ACCESS_SESSION_ID,
      generation: "playground-workboard-access",
      revision: 1,
      value: {
        currentQuestStateVersion: 1,
        tabState: { version: 1 },
        tabs: [...ACTIVE_ROWS.map((row) => projectedTab(row, false)), projectedTab(COMPLETED_ROWS[0]!, true)],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: NOW },
        threadStatuses: {},
        activePhaseSummary: buildLeaderActivePhaseSummary(ACTIVE_ROWS),
      },
    });
    state.setLeaderWorkboardView(ACCESS_SESSION_ID, "active");
  }, [seeded]);
  return seeded;
}

/** Phone top bar as the app draws it below 768px: ≡, identity, Board and the attention list. */
function PhoneLeaderTopBar({ boardOpen }: { boardOpen: boolean }) {
  return (
    <div className="flex w-full items-center gap-1.5 border-b border-cc-border bg-cc-card px-2 py-1.5">
      <span className="h-9 w-9 shrink-0 rounded-lg bg-cc-hover/60" aria-hidden="true" />
      <span className="h-8 w-8 shrink-0 rounded-full bg-cc-hover" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13px] font-semibold leading-tight text-cc-fg">Condor Takode</span>
        <span className="text-[11px] leading-tight text-cc-muted">#2902</span>
      </span>
      <LeaderWorkboardTopBarButton open={boardOpen} dots={ACTIVE_DOTS} compact onToggle={noop} />
      <AttentionListPill count={3} topKind="needs-input" compact />
    </div>
  );
}

function BoardOpenOnQuestThread({ phone }: { phone: boolean }) {
  return (
    <div
      className={`overflow-hidden rounded-lg border border-cc-border ${phone ? "w-[430px] shrink-0" : "w-full"}`}
      data-testid={`workboard-access-open-${phone ? "phone" : "desktop"}`}
    >
      {phone && <PhoneLeaderTopBar boardOpen />}
      <WorkBoardBar sessionId={ACCESS_SESSION_ID} currentThreadKey="q-2420" onSelectThread={noop} />
    </div>
  );
}

export function PlaygroundWorkboardAccessSection() {
  const seeded = useAccessLeaderSeed();
  return (
    <PlaygroundSectionGroup groupId="interactive">
      <Section
        title="Work Board Access and Readability"
        description="Board tables at full contrast with the quest title next to its ID. Leaders open the board from any thread with the Board button in the top bar, next to Next: a small square board holding one dot per quest in a Journey phase, in its phase color (three per row; past five, three dots and +N), never a count or a notification-style badge. The width never changes; desktop adds Board, and the count and phase breakdown are in the tooltip and accessible label. The board opens under the tabs without leaving the thread; outside Main it brings its own Active, Completed and Other switch and a close button."
      >
        <div className="space-y-4" data-testid="playground-workboard-access">
          <Card label="Board table: active">
            <BoardTable
              board={ACTIVE_ROWS}
              rowSessionStatuses={ROW_STATUSES}
              selectedThreadKey="q-2420"
              onSelectQuestThread={noop}
            />
          </Card>
          <Card label="Board table: completed">
            <BoardTable
              board={COMPLETED_ROWS}
              mode="completed"
              rowSessionStatuses={ROW_STATUSES}
              onSelectQuestThread={noop}
            />
          </Card>
          <Card label="Board button states">
            <table className="text-[11px] text-cc-muted" data-testid="workboard-access-buttons">
              <thead>
                <tr>
                  <th className="pb-1 pr-4 text-left font-medium">Quests in a phase</th>
                  <th className="pb-1 pr-4 text-left font-medium">Phone</th>
                  <th className="pb-1 pr-4 text-left font-medium">Phone, open</th>
                  <th className="pb-1 pr-4 text-left font-medium">Desktop</th>
                  <th className="pb-1 text-left font-medium">Desktop, open</th>
                </tr>
              </thead>
              <tbody>
                {DOT_SAMPLES.map((sample) => (
                  <tr key={sample.label}>
                    <td className="py-1 pr-4 whitespace-nowrap">{sample.label}</td>
                    <td className="py-1 pr-4">
                      <LeaderWorkboardTopBarButton open={false} dots={sample.dots} compact onToggle={noop} />
                    </td>
                    <td className="py-1 pr-4">
                      <LeaderWorkboardTopBarButton open dots={sample.dots} compact onToggle={noop} />
                    </td>
                    <td className="py-1 pr-4">
                      <LeaderWorkboardTopBarButton open={false} dots={sample.dots} compact={false} onToggle={noop} />
                    </td>
                    <td className="py-1">
                      <LeaderWorkboardTopBarButton open dots={sample.dots} compact={false} onToggle={noop} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card label="Phone top bar with the Board button">
            <div
              className="w-[430px] overflow-hidden rounded-lg border border-cc-border"
              data-testid="workboard-access-phone-top-bar"
            >
              <PhoneLeaderTopBar boardOpen={false} />
            </div>
          </Card>
          {seeded && (
            <Card label="Board opened from a quest thread (desktop and 430px phone)">
              <div className="space-y-4">
                <BoardOpenOnQuestThread phone={false} />
                <BoardOpenOnQuestThread phone />
              </div>
            </Card>
          )}
        </div>
      </Section>
    </PlaygroundSectionGroup>
  );
}
