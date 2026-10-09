import { useEffect } from "react";
import { useStore } from "../../store.js";
import type { SdkSessionInfo } from "../../types.js";
import { toSidebarSessionItem } from "../../utils/sidebar-session-item.js";
import { BoardBlock } from "../BoardBlock.js";
import { SessionItem } from "../SessionItem.js";
import { Section } from "./shared.js";

/**
 * Idle workers that are waiting on something: the server describes each wait in
 * `waitingFor` (background jobs, landing runs, lease queues) next to the timer
 * count, and sidebar rows and the work board name it instead of showing idle.
 */
const NOW = Date.now();
const WORKERS: Array<{ quest: string; title: string; session: SdkSessionInfo }> = [
  {
    quest: "q-701",
    title: "Background gate run",
    session: worker(7101, "Background gate worker", { waitingFor: 'background job "Run full gate"' }),
  },
  {
    quest: "q-702",
    title: "Queued for a test slot",
    session: worker(7102, "Queued test worker", { waitingFor: "full-suite:takode@devbox (#2 in line)" }),
  },
  {
    quest: "q-703",
    title: "Change in a landing run",
    session: worker(7103, "Landing worker", { waitingFor: "landing run" }),
  },
  {
    quest: "q-704",
    title: "Timer and two background jobs",
    session: worker(7104, "Timer worker", {
      pendingTimerCount: 1,
      waitingFor: '2 background jobs: "Run full gate", "Dev server"',
    }),
  },
  { quest: "q-705", title: "Waiting on nothing", session: worker(7105, "Idle worker", {}) },
];

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
  onStartRename: noop,
  onArchive: noop,
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
      description="Idle workers that wait on a background job, a lease line, a landing run or a timer show a timer icon and name the wait in sidebar rows and the work board's worker column; a worker waiting on nothing stays a grey idle dot."
    >
      <div className="grid gap-3 md:grid-cols-2" data-testid="playground-waiting-workers">
        <div className="rounded-xl bg-cc-sidebar p-2">
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
