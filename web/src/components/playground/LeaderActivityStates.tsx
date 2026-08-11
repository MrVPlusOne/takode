import { useEffect } from "react";
import { useStore } from "../../store.js";
import type { ChatMessage, SessionState } from "../../types.js";
import { CodexReasoningDetail } from "../CodexReasoningDetail.js";
import { ElapsedTimer } from "../MessageFeedStatus.js";

const IDLE_LEADER_ID = "playground-leader-activity-idle";
const RUNNING_LEADER_ID = "playground-leader-activity-running";
const RUNNING_WORKER_ID = "playground-worker-activity-running";
const QUEST_ID = "q-9901";

function sessionState(sessionId: string, isOrchestrator: boolean): SessionState {
  return {
    session_id: sessionId,
    model: "gpt-5.6-sol",
    cwd: "/repo",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/repo",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    backend_type: "codex",
    isOrchestrator,
  };
}

const projectedWorkerReasoning: ChatMessage = {
  id: "playground-worker-reasoning-detail",
  role: "assistant",
  content:
    "**Worker activity stays attributed**\n\nThe worker detail remains visible without marking the idle leader active.",
  timestamp: Date.now(),
  metadata: { codexReasoningDetail: { status: "complete" } },
};

export function PlaygroundLeaderActivityStates() {
  useEffect(() => {
    const now = Date.now();
    useStore.setState((state) => {
      const sessions = new Map(state.sessions);
      const sessionStatus = new Map(state.sessionStatus);
      const streamingStartedAt = new Map(state.streamingStartedAt);
      const activeTurnRoutes = new Map(state.activeTurnRoutes);
      const sessionBoards = new Map(state.sessionBoards);
      const sessionBoardRowStatuses = new Map(state.sessionBoardRowStatuses);

      sessions.set(IDLE_LEADER_ID, sessionState(IDLE_LEADER_ID, true));
      sessions.set(RUNNING_LEADER_ID, sessionState(RUNNING_LEADER_ID, true));
      sessions.set(RUNNING_WORKER_ID, sessionState(RUNNING_WORKER_ID, false));

      sessionStatus.set(IDLE_LEADER_ID, "idle");
      activeTurnRoutes.set(IDLE_LEADER_ID, null);
      sessionBoards.set(IDLE_LEADER_ID, [
        {
          questId: QUEST_ID,
          worker: RUNNING_WORKER_ID,
          workerNum: 42,
          status: "WORKING",
          updatedAt: now,
        },
      ]);
      sessionBoardRowStatuses.set(IDLE_LEADER_ID, {
        [QUEST_ID]: {
          worker: {
            sessionId: RUNNING_WORKER_ID,
            sessionNum: 42,
            status: "running",
            activeTurnRoute: { threadKey: QUEST_ID, questId: QUEST_ID },
            generationStartedAt: now - 196_000,
          },
          reviewer: null,
        },
      });

      sessionStatus.set(RUNNING_LEADER_ID, "running");
      streamingStartedAt.set(RUNNING_LEADER_ID, now - 196_000);
      activeTurnRoutes.set(RUNNING_LEADER_ID, { threadKey: QUEST_ID, questId: QUEST_ID });

      sessionStatus.set(RUNNING_WORKER_ID, "running");
      streamingStartedAt.set(RUNNING_WORKER_ID, now - 196_000);
      activeTurnRoutes.set(RUNNING_WORKER_ID, { threadKey: QUEST_ID, questId: QUEST_ID });

      return {
        sessions,
        sessionStatus,
        streamingStartedAt,
        activeTurnRoutes,
        sessionBoards,
        sessionBoardRowStatuses,
      };
    });
  }, []);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border border-cc-border bg-cc-bg p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">Idle leader, active worker</div>
        <ElapsedTimer sessionId={IDLE_LEADER_ID} variant="floating" currentThreadKey={QUEST_ID} />
        <div className="mb-2 text-[11px] text-cc-muted">No leader activity chip is expected.</div>
        <CodexReasoningDetail message={projectedWorkerReasoning} />
      </div>
      <div className="rounded-md border border-cc-border bg-cc-bg p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">Running leader</div>
        <ElapsedTimer sessionId={RUNNING_LEADER_ID} variant="floating" currentThreadKey={QUEST_ID} />
      </div>
      <div className="rounded-md border border-cc-border bg-cc-bg p-3">
        <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">Running worker</div>
        <ElapsedTimer sessionId={RUNNING_WORKER_ID} variant="floating" currentThreadKey={QUEST_ID} />
      </div>
    </div>
  );
}
