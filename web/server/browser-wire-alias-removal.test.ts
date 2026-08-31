import { describe, expect, it } from "vitest";
import { codexReasoningSnapshotFields } from "./bridge/codex-reasoning-preview-state.js";
import { projectBrowserSessionState, type ActiveCodexReasoningPreview, type SessionState } from "./session-types.js";

const preview: ActiveCodexReasoningPreview = {
  text: "Inspecting owner-scoped recovery state",
  updatedAt: 1_234_567_890,
  turnId: "turn-123",
  threadKey: "q-2000",
  questId: "q-2000",
};

const leaderOpenThreadTabs = {
  version: 1 as const,
  orderedOpenThreadKeys: ["q-2000", "q-1991"],
  closedThreadTombstones: [{ threadKey: "q-1900", closedAt: 1_234_567_000 }],
  updatedAt: 1_234_567_890,
};

const leaderThreadStatuses = {
  "q-2000": {
    kind: "ready" as const,
    label: "Thread Ready" as const,
    threadKey: "q-2000",
    questId: "q-2000",
    summary: "wire cleanup ready",
    messageId: "msg-1",
    timestamp: 1_234_567_890,
    updatedAt: 1_234_567_890,
  },
};

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("current-build browser wire aliases", () => {
  it("keeps durable leader state internal while preserving canonical recovery progress", () => {
    const internal = {
      session_id: "leader-1",
      model: "gpt-5.5",
      permissionMode: "default",
      leaderOpenThreadTabs,
      leaderThreadStatuses,
      codex_result_error_auto_pause_recovery_testing: true,
      codex_result_error_auto_pause_recovery_progress: "active",
    } as unknown as SessionState;

    const browserState = projectBrowserSessionState(internal);

    expect(browserState).toMatchObject({
      session_id: "leader-1",
      codex_result_error_auto_pause_recovery_progress: "active",
    });
    expect(browserState).not.toHaveProperty("leaderOpenThreadTabs");
    expect(browserState).not.toHaveProperty("leaderThreadStatuses");
    expect(browserState).not.toHaveProperty("codex_result_error_auto_pause_recovery_testing");
    expect(internal.leaderOpenThreadTabs).toBe(leaderOpenThreadTabs);
    expect(internal.leaderThreadStatuses).toBe(leaderThreadStatuses);
  });

  it("reduces representative reasoning, recovery, and leader-session frames", () => {
    const canonicalReasoning = {
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-2000", questId: "q-2000" },
      ...codexReasoningSnapshotFields({ codexReasoningPreviews: { "q-2000": preview } }),
    };
    const canonicalRecovery = {
      type: "status_change",
      status: "running",
      codexAutoPauseRecoveryProgress: "active",
    };
    const canonicalRecoveryUpdate = {
      type: "session_update",
      session: { codex_result_error_auto_pause_recovery_progress: "active" },
    };
    const canonicalSessionInit = {
      type: "session_init",
      session: projectBrowserSessionState({
        session_id: "leader-1",
        model: "gpt-5.5",
        permissionMode: "default",
        leaderOpenThreadTabs,
        leaderThreadStatuses,
      } as unknown as SessionState),
    };

    const pairs = {
      reasoningStatus: [{ ...canonicalReasoning, activeCodexReasoningPreview: preview }, canonicalReasoning],
      recoveryStatus: [{ ...canonicalRecovery, codexAutoPauseRecoveryTesting: true }, canonicalRecovery],
      recoverySessionUpdate: [
        {
          ...canonicalRecoveryUpdate,
          session: {
            ...canonicalRecoveryUpdate.session,
            codex_result_error_auto_pause_recovery_testing: true,
          },
        },
        canonicalRecoveryUpdate,
      ],
      leaderSessionInit: [
        {
          ...canonicalSessionInit,
          session: { ...canonicalSessionInit.session, leaderOpenThreadTabs, leaderThreadStatuses },
        },
        canonicalSessionInit,
      ],
    } as const;

    const metrics = Object.fromEntries(
      Object.entries(pairs).map(([name, [legacy, canonical]]) => {
        const legacyBytes = jsonBytes(legacy);
        const canonicalBytes = jsonBytes(canonical);
        expect(canonicalBytes).toBeLessThan(legacyBytes);
        return [name, { legacyBytes, canonicalBytes, savedBytes: legacyBytes - canonicalBytes }];
      }),
    );

    if (process.env.TAKODE_PRINT_BROWSER_WIRE_ALIAS_METRICS === "1") {
      console.log(`[browser-wire-aliases] ${JSON.stringify(metrics)}`);
    }

    expect(metrics).toEqual({
      reasoningStatus: { legacyBytes: 426, canonicalBytes: 263, savedBytes: 163 },
      recoveryStatus: { legacyBytes: 122, canonicalBytes: 85, savedBytes: 37 },
      recoverySessionUpdate: { legacyBytes: 150, canonicalBytes: 96, savedBytes: 54 },
      leaderSessionInit: { legacyBytes: 491, canonicalBytes: 104, savedBytes: 387 },
    });
  });
});
