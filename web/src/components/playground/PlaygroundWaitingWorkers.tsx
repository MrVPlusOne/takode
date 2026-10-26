import { useEffect } from "react";
import { LEADER_PROFILE_PORTRAITS } from "../../../shared/leader-profile-portraits.js";
import { useStore } from "../../store.js";
import type { SdkSessionInfo } from "../../types.js";
import { toSidebarSessionItem } from "../../utils/sidebar-session-item.js";
import { BoardBlock } from "../BoardBlock.js";
import { SessionItem } from "../SessionItem.js";
import { Section } from "./shared.js";

/**
 * Idle workers that are waiting on something: the server lists each wait in
 * `waits` (the user's answer, background jobs, landing runs, lease queues) next to
 * the timer count. Sidebar rows and the work board name it instead of showing idle,
 * with the icon of the leading wait's kind. A leader with a portrait carries that
 * icon on the portrait's corner.
 */
const NOW = Date.now();
const WORKERS: Array<{ quest: string; title: string; session: SdkSessionInfo }> = [
  {
    quest: "q-701",
    title: "Background gate run",
    session: worker(7101, "Background gate worker", {
      waits: [{ kind: "job", description: "Run full gate", startedAt: NOW - 7 * 60_000 }],
    }),
  },
  {
    quest: "q-702",
    title: "Queued for a test slot",
    session: worker(7102, "Queued test worker", {
      waits: [{ kind: "queue", resource: "full-suite:takode@devbox", position: 2 }],
    }),
  },
  {
    quest: "q-703",
    title: "Change in a landing run",
    session: worker(7103, "Landing worker", { waits: [{ kind: "landing" }] }),
  },
  {
    quest: "q-704",
    title: "Timer and two background jobs",
    session: worker(7104, "Timer worker", {
      pendingTimerCount: 1,
      waits: [
        { kind: "job", description: "Run full gate", startedAt: NOW - 4 * 60_000 },
        { kind: "job", description: "Dev server", startedAt: NOW - 50 * 60_000 },
      ],
    }),
  },
  {
    quest: "q-705",
    title: "User Checkpoint",
    session: worker(7105, "Checkpoint worker", { waits: [{ kind: "answer", questId: "q-705" }] }),
  },
  { quest: "q-706", title: "Waiting on nothing", session: worker(7106, "Idle worker", {}) },
];

const LEADER: SdkSessionInfo = {
  ...worker(7100, "Leader on a timer", { pendingTimerCount: 1 }),
  sessionId: "playground-waiting-leader",
  herdedBy: undefined,
  isOrchestrator: true,
  leaderProfilePortraitId: LEADER_PROFILE_PORTRAITS[0].id,
  leaderProfilePortrait: LEADER_PROFILE_PORTRAITS[0],
};

function worker(sessionNum: number, name: string, wait: Partial<SdkSessionInfo>): SdkSessionInfo {
  return {
    sessionId: `playground-waiting-${sessionNum}`,
    sessionNum,
    name,
    state: "connected",
    cliConnected: true,
    status: "idle",
    cwd: "/repo/takode",
    createdAt: NOW - 3_600_000,
    backendType: "claude-sdk",
    herdedBy: "playground-waiting-leader",
    ...wait,
  };
}

const noop = () => {};
const itemProps = {
  isActive: false,
  isRecentlyRenamed: false,
  onSelect: noop,
  onUnarchive: noop,
  onDelete: noop,
  onClearRecentlyRenamed: noop,
  editingSessionId: null,
  editingName: "",
  setEditingName: noop,
  onConfirmRename: noop,
  onCancelRename: noop,
  editInputRef: { current: null },
};

export function PlaygroundWaitingWorkers() {
  // Board rows resolve worker status from sdkSessions. Other Playground sections
  // replace sdkSessions when they mount, so re-seed whenever these go missing.
  const seeded = useStore((state) =>
    WORKERS.every(({ session }) => state.sdkSessions.some((candidate) => candidate.sessionId === session.sessionId)),
  );
  useEffect(() => {
    if (seeded) return;
    useStore.setState((state) => ({
      sdkSessions: [
        ...state.sdkSessions.filter((session) => !session.sessionId.startsWith("playground-waiting-")),
        ...WORKERS.map(({ session }) => session),
      ],
    }));
  }, [seeded]);

  return (
    <Section
      title="Waiting Workers"
      description="Idle sessions that wait on the user's answer, a background job, a lease line, a landing run or a timer show that wait's icon (the leading one when there are several); sidebar rows and the work board's worker column name non-timer waits, while timers need no text. A leader's icon sits on its portrait corner. A worker waiting on nothing stays a grey idle dot."
    >
      <div className="grid gap-3 md:grid-cols-2" data-testid="playground-waiting-workers">
        <div className="rounded-xl bg-cc-sidebar p-2">
          <SessionItem
            {...itemProps}
            session={toSidebarSessionItem(LEADER)}
            sessionName={LEADER.name ?? ""}
            permCount={0}
            attention={null}
            hasUnread={false}
          />
          {WORKERS.map(({ session }) => (
            <SessionItem
              key={session.sessionId}
              {...itemProps}
              session={toSidebarSessionItem(session)}
              sessionName={session.name ?? ""}
              permCount={0}
              attention={null}
              hasUnread={false}
              compact
            />
          ))}
        </div>
        <BoardBlock
          defaultOpen
          board={WORKERS.map(({ quest, title, session }, index) => ({
            questId: quest,
            title,
            worker: session.sessionId,
            workerNum: session.sessionNum ?? undefined,
            status: "WORKING",
            updatedAt: NOW - index * 60_000,
          }))}
        />
      </div>
    </Section>
  );
}
