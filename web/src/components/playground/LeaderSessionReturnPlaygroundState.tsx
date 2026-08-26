import { useState } from "react";
import { useStore } from "../../store.js";
import { persistLeaderSelectedThreadKey } from "../../utils/thread-viewport.js";
import { ChatView } from "../ChatView.js";
import { PLAYGROUND_LEADER_RETURN_AWAY_SESSION_ID, PLAYGROUND_LEADER_RETURN_SESSION_ID } from "./fixtures.js";
import { Section } from "./shared.js";

export function LeaderSessionReturnPlaygroundState() {
  const [activeSessionId, setActiveSessionId] = useState(PLAYGROUND_LEADER_RETURN_SESSION_ID);
  const [returnEpoch, setReturnEpoch] = useState(0);
  const [settlementRevision, setSettlementRevision] = useState(0);
  const showingLeader = activeSessionId === PLAYGROUND_LEADER_RETURN_SESSION_ID;

  const resetLeaderMain = () => {
    persistLeaderSelectedThreadKey(PLAYGROUND_LEADER_RETURN_SESSION_ID, "main");
    setActiveSessionId(PLAYGROUND_LEADER_RETURN_SESSION_ID);
    setReturnEpoch((current) => current + 1);
  };
  const applyLateSettlement = () => {
    const revision = settlementRevision + 1;
    useStore.getState().setSessionCompletedBoard(PLAYGROUND_LEADER_RETURN_SESSION_ID, [
      {
        questId: "q-1944",
        title: `Completed tab late settlement ${revision}`,
        status: "DONE",
        updatedAt: Date.now(),
        completedAt: Date.now() - 20_000,
      },
    ]);
    setSettlementRevision(revision);
  };

  return (
    <Section
      title="Leader Session Return Stability"
      description="Production-shaped 131-message leader return harness. Keep Main selected, scroll to a recognizable message, switch away and back repeatedly, apply late settlement, and confirm the selected tab and exact viewport stay fixed."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() =>
            setActiveSessionId(
              showingLeader ? PLAYGROUND_LEADER_RETURN_AWAY_SESSION_ID : PLAYGROUND_LEADER_RETURN_SESSION_ID,
            )
          }
          className="rounded-lg border border-cc-border bg-cc-hover px-3 py-1.5 text-xs font-medium text-cc-fg hover:bg-cc-active"
        >
          {showingLeader ? "Switch to away session" : "Return to leader Main"}
        </button>
        <button
          type="button"
          onClick={applyLateSettlement}
          className="rounded-lg border border-cc-border bg-cc-card px-3 py-1.5 text-xs font-medium text-cc-muted hover:text-cc-fg"
        >
          Apply late settlement
        </button>
        <button
          type="button"
          onClick={resetLeaderMain}
          className="rounded-lg border border-cc-border bg-cc-card px-3 py-1.5 text-xs font-medium text-cc-muted hover:text-cc-fg"
        >
          Reset leader to Main
        </button>
        <span className="text-xs text-cc-muted" data-testid="playground-leader-return-active-session">
          {showingLeader ? "Leader Main return target" : "Away session"} · late revision {settlementRevision}
        </span>
      </div>
      <div
        data-testid="playground-leader-session-return"
        className="h-[620px] max-w-4xl overflow-hidden rounded-xl border border-cc-border bg-cc-card"
      >
        <ChatView
          key={`${activeSessionId}:${returnEpoch}`}
          sessionId={activeSessionId}
          hasThreadRoute={false}
          routeThreadKey={null}
        />
      </div>
    </Section>
  );
}
