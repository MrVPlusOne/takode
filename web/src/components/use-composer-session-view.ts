import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import type { CodexAppReference, CodexSkillReference } from "../types.js";

const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_SKILL_REFERENCES: CodexSkillReference[] = [];
const EMPTY_APP_REFERENCES: CodexAppReference[] = [];

export function useComposerSessionView(sessionId: string) {
  return useStore(
    useShallow((s) => {
      const sessionData = s.sessions.get(sessionId);
      const isConnected = s.cliConnected.get(sessionId) ?? false;
      return {
        isConnected,
        browserConnectionStatus: s.connectionStatus?.get(sessionId) ?? (isConnected ? "connected" : "disconnected"),
        explicitAskPermission: s.askPermission.get(sessionId),
        backendType: sessionData?.backend_type,
        backendState: sessionData?.backend_state,
        isLeaderSession:
          sessionData?.isOrchestrator === true ||
          s.sdkSessions?.some((sdk) => sdk.sessionId === sessionId && sdk.isOrchestrator === true) === true,
        permissionMode: sessionData?.permissionMode || "acceptEdits",
        serverUiMode: sessionData?.uiMode,
        codexReasoningEffort: sessionData?.codex_reasoning_effort || "",
        codexServiceTier: sessionData?.codex_service_tier ?? null,
        slashCommands: sessionData?.slash_commands ?? EMPTY_STRING_ARRAY,
        skills: sessionData?.skills ?? EMPTY_STRING_ARRAY,
        skillMetadata: sessionData?.skill_metadata ?? EMPTY_SKILL_REFERENCES,
        apps: sessionData?.apps ?? EMPTY_APP_REFERENCES,
        cwd: sessionData?.cwd,
        repoRoot: sessionData?.repo_root,
        gitBranch: sessionData?.git_branch,
        isContainerized: sessionData?.is_containerized === true,
        gitAhead: sessionData?.git_ahead || 0,
        gitBehind: sessionData?.git_behind || 0,
        model: sessionData?.model,
        totalLinesAdded: sessionData?.total_lines_added,
        totalLinesRemoved: sessionData?.total_lines_removed,
        pause: sessionData?.pause ?? null,
        pausedInputQueueCount: sessionData?.pause?.queuedMessages.length ?? 0,
        codexResultErrorAutoPause: sessionData?.codex_result_error_auto_pause ?? null,
        codexAutoPausedInputCount:
          sessionData?.codex_result_error_auto_pause?.heldInputs.reduce(
            (total, item) => total + Math.max(1, item.count),
            0,
          ) ?? 0,
      };
    }),
  );
}
