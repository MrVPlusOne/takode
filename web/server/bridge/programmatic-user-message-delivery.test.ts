import { describe, expect, it, vi } from "vitest";
import { deliverProgrammaticUserMessage } from "./programmatic-user-message-delivery.js";

function deliveryDeps(order: string[]) {
  return {
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(() => order.push("persist")),
    getBrowserTransportDeps: vi.fn(() => {
      throw new Error("held delivery must not reach browser routing");
    }),
    pruneStaleBoardStalledHerdBatch: vi.fn((_session, batch) => ({ batch, changed: false })),
    syncBackendTypeFromLauncher: vi.fn(),
  } as any;
}

describe("programmatic user message acceptance callbacks", () => {
  it("records accepted manual-pause queues after persistence", () => {
    const order: string[] = [];
    const session = {
      id: "manual-pause-session",
      backendType: "claude",
      state: { pause: { pausedAt: 100, queuedMessages: [] } },
    } as any;

    const status = deliverProgrammaticUserMessage(
      session,
      "compaction recovery",
      { sessionId: "system:compaction-recovery", sessionLabel: "Compaction Recovery" },
      undefined,
      undefined,
      { afterAccepted: () => order.push("accepted") },
      deliveryDeps(order),
    );

    expect(status).toBe("paused_queued");
    expect(session.state.pause.queuedMessages).toHaveLength(1);
    expect(order).toEqual(["persist", "accepted"]);
  });

  it("records accepted Codex auto-pause queues after persistence", () => {
    const order: string[] = [];
    const session = {
      id: "auto-pause-session",
      backendType: "codex",
      state: {
        codex_result_error_auto_pause: {
          family: "copilot_auth_refresh_exhausted",
          fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
          streak: 1,
          threshold: 1,
          pausedAt: 100,
          lastError: "refresh failed",
          lastErrorAt: 100,
          lastSourceKind: "automatic",
          totalMatchingErrors: 1,
          heldInputs: [],
        },
      },
      pendingCodexInputs: [],
      pendingCodexTurns: [],
    } as any;

    const status = deliverProgrammaticUserMessage(
      session,
      "compaction recovery",
      { sessionId: "system:compaction-recovery", sessionLabel: "Compaction Recovery" },
      undefined,
      undefined,
      {
        autoPauseSourceKind: "automatic",
        afterAccepted: () => order.push("accepted"),
      },
      deliveryDeps(order),
    );

    expect(status).toBe("paused_queued");
    expect(session.state.codex_result_error_auto_pause.heldInputs).toHaveLength(1);
    expect(order).toEqual(["persist", "accepted"]);
  });
});
