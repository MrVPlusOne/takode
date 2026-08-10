import { useEffect } from "react";
import { useStore } from "../../store.js";
import { ElapsedTimer } from "../MessageFeedStatus.js";
import { TurnEntries } from "../MessageFeedEntries.js";

const NOOP = () => {};

export function PlaygroundActiveReasoningChipStates() {
  useEffect(() => {
    const now = Date.now();
    const sessionIds = [
      "playground-active-reasoning-none",
      "playground-active-reasoning-short",
      "playground-active-reasoning-long",
      "playground-active-reasoning-idle",
      "playground-active-reasoning-updating",
    ];
    useStore.setState((state) => {
      const sessions = new Map(state.sessions);
      const sessionStatus = new Map(state.sessionStatus);
      const streamingStartedAt = new Map(state.streamingStartedAt);
      const activeTurnRoutes = new Map(state.activeTurnRoutes);
      const codexReasoningPreviews = new Map(state.codexReasoningPreviews);
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
      sessionStatus.set("playground-active-reasoning-idle", "idle");
      activeTurnRoutes.set("playground-active-reasoning-idle", null);
      codexReasoningPreviews.set(
        "playground-active-reasoning-short",
        new Map([
          [
            "q-42",
            {
              text: "**Checking route metadata**\n\nThe body now remains until visible q-42 output replaces it.",
              updatedAt: now,
              threadKey: "q-42",
              questId: "q-42",
            },
          ],
        ]),
      );
      codexReasoningPreviews.set(
        "playground-active-reasoning-long",
        new Map([
          [
            "q-42",
            {
              text: "Comparing active turn route, browser-selected thread, and Codex reasoning stream without a title. This text uses the available message width and is not shortened by the activity chip.",
              updatedAt: now,
              threadKey: "q-42",
              questId: "q-42",
            },
          ],
        ]),
      );
      codexReasoningPreviews.set(
        "playground-active-reasoning-idle",
        new Map([
          [
            "q-42",
            {
              text: "**Retained after turn completion**\n\nNo newer visible q-42 item has replaced this row.",
              updatedAt: now,
              threadKey: "q-42",
              questId: "q-42",
            },
          ],
        ]),
      );
      codexReasoningPreviews.set(
        "playground-active-reasoning-updating",
        new Map([
          [
            "q-88",
            {
              text: "**Inspecting current protocol fields**\n\nActivity in q-88 does not clear q-42.",
              updatedAt: now,
              threadKey: "q-88",
              questId: "q-88",
            },
          ],
        ]),
      );
      return { sessions, sessionStatus, streamingStartedAt, activeTurnRoutes, codexReasoningPreviews };
    });
  }, []);

  const states = [
    { label: "No content", sessionId: "playground-active-reasoning-none", currentThreadKey: "q-42" },
    { label: "Title and body", sessionId: "playground-active-reasoning-short", currentThreadKey: "q-42" },
    { label: "Fallback body", sessionId: "playground-active-reasoning-long", currentThreadKey: "q-42" },
    { label: "Retained after idle", sessionId: "playground-active-reasoning-idle", currentThreadKey: "q-42" },
    { label: "Other route", sessionId: "playground-active-reasoning-updating", currentThreadKey: "q-42" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {states.map((state) => (
        <div key={state.sessionId} className="rounded-lg border border-cc-border bg-cc-bg p-3">
          <div className="mb-2 text-[10px] uppercase tracking-wide text-cc-muted">{state.label}</div>
          <div className="space-y-3">
            <ElapsedTimer sessionId={state.sessionId} variant="floating" currentThreadKey={state.currentThreadKey} />
            <TurnEntries
              sections={[]}
              sessionId={state.sessionId}
              currentThreadKey={state.currentThreadKey}
              leaderMode={false}
              isCodexSession
              activeCodexTerminalIds={new Set()}
              onOpenCodexTerminal={NOOP}
              turnStates={[]}
              toggleTurn={NOOP}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
