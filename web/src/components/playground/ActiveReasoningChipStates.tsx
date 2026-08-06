import { useEffect } from "react";
import { useStore } from "../../store.js";
import { ElapsedTimer } from "../MessageFeedStatus.js";

export function PlaygroundActiveReasoningChipStates() {
  useEffect(() => {
    const now = Date.now();
    const sessionIds = [
      "playground-active-reasoning-none",
      "playground-active-reasoning-short",
      "playground-active-reasoning-long",
      "playground-active-reasoning-updating",
    ];
    useStore.setState((state) => {
      const sessions = new Map(state.sessions);
      const sessionStatus = new Map(state.sessionStatus);
      const streamingStartedAt = new Map(state.streamingStartedAt);
      const activeTurnRoutes = new Map(state.activeTurnRoutes);
      const activeCodexReasoningPreviews = new Map(state.activeCodexReasoningPreviews);
      for (const sessionId of sessionIds) {
        sessions.set(sessionId, {
          session_id: sessionId,
          model: "gpt-5.5",
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
          ...(sessions.get(sessionId) ?? {}),
          isOrchestrator: true,
          backend_type: "codex",
        });
        sessionStatus.set(sessionId, "running");
        streamingStartedAt.set(sessionId, now - 196_000);
      }
      activeTurnRoutes.set("playground-active-reasoning-none", { threadKey: "q-42", questId: "q-42" });
      activeTurnRoutes.set("playground-active-reasoning-short", { threadKey: "q-42", questId: "q-42" });
      activeTurnRoutes.set("playground-active-reasoning-long", { threadKey: "q-42", questId: "q-42" });
      activeTurnRoutes.set("playground-active-reasoning-updating", { threadKey: "q-88", questId: "q-88" });
      activeCodexReasoningPreviews.set("playground-active-reasoning-short", {
        text: "**Checking route metadata**\n\nThe body is intentionally not shown in the chip.",
        updatedAt: now,
        threadKey: "q-42",
        questId: "q-42",
      });
      activeCodexReasoningPreviews.set("playground-active-reasoning-long", {
        text: "Comparing active turn route, browser-selected thread, and Codex reasoning stream without a title.",
        updatedAt: now,
        threadKey: "q-42",
        questId: "q-42",
      });
      activeCodexReasoningPreviews.set("playground-active-reasoning-updating", {
        text: "**Inspecting current protocol fields**\n\nReplacing the previous trace.",
        updatedAt: now,
        threadKey: "q-88",
        questId: "q-88",
      });
      return { sessions, sessionStatus, streamingStartedAt, activeTurnRoutes, activeCodexReasoningPreviews };
    });
  }, []);

  const states = [
    { label: "No content", sessionId: "playground-active-reasoning-none", currentThreadKey: "q-42" },
    { label: "Title only", sessionId: "playground-active-reasoning-short", currentThreadKey: "q-42" },
    { label: "Fallback text", sessionId: "playground-active-reasoning-long", currentThreadKey: "q-42" },
    { label: "Other route", sessionId: "playground-active-reasoning-updating", currentThreadKey: "q-42" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {states.map((state) => (
        <div key={state.sessionId} className="rounded-lg border border-cc-border bg-cc-bg p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">{state.label}</div>
          <ElapsedTimer sessionId={state.sessionId} variant="floating" currentThreadKey={state.currentThreadKey} />
        </div>
      ))}
    </div>
  );
}
