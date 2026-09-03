import { describe, expect, it, vi } from "vitest";
import type { PendingCodexInput } from "../session-types.js";
import { commitPendingCodexInputs } from "./codex-pending-input-history.js";
import type {
  CodexRecoveryOrchestratorDeps,
  CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";

describe("Codex pending-input thread response coverage", () => {
  it("preserves coverage and invalidates stale Ready when delayed human input commits", () => {
    const input: PendingCodexInput = {
      id: "covered-user",
      content: "Finish this request",
      timestamp: 12345,
      cancelable: false,
      threadKey: "q-42",
      questId: "q-42",
      threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
      leaderResponseCoverageVersion: 1,
    };
    const session = {
      id: "leader",
      state: {
        cwd: "/tmp",
        leaderThreadStatuses: {
          "q-42": {
            kind: "ready",
            label: "Thread Ready",
            threadKey: "q-42",
            questId: "q-42",
            summary: "old",
            messageId: "old",
            timestamp: 1,
            updatedAt: 1,
          },
        },
      },
      messageHistory: [],
      pendingCodexInputs: [input],
      notifications: [],
      isGenerating: false,
    } as unknown as CodexRecoveryOrchestratorSessionLike;
    const invalidateLeaderThreadTabsForSession = vi.fn(() => true);
    const refreshBrowserConversationViews = vi.fn();
    const deps = {
      broadcastPendingCodexInputs: vi.fn(),
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      touchUserMessage: vi.fn(),
      onUserMessage: vi.fn(),
      invalidateLeaderThreadTabsForSession,
      refreshBrowserConversationViews,
    } as unknown as CodexRecoveryOrchestratorDeps;

    commitPendingCodexInputs(session, [input.id], deps);

    expect(session.messageHistory[0]).toMatchObject({ id: input.id, leaderResponseCoverageVersion: 1 });
    expect(session.state.leaderThreadStatuses?.["q-42"]).toBeUndefined();
    expect(invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith(session.id);
    expect(refreshBrowserConversationViews).toHaveBeenCalledWith(session);
  });
});
