import { describe, expect, it, vi } from "vitest";
import { sendStateSnapshot, type BrowserTransportSessionLike } from "./browser-transport-controller.js";

describe("state snapshot Codex reasoning projection", () => {
  it("projects retained per-thread rows while idle", () => {
    // Reconnect snapshots must restore volatile in-process rows even after the
    // provider turn itself has ended.
    const ws = { send: vi.fn() };
    const session = {
      id: "reasoning-session",
      backendType: "codex",
      state: { permissionMode: "default" },
      messageHistory: [],
      pendingPermissions: new Map(),
      pendingCodexInputs: [],
      pendingCodexTurns: [],
      browserSockets: new Set(),
      notifications: [],
      attentionRecords: [],
      generationStartedAt: null,
      lastReadAt: 0,
      attentionReason: null,
      codexReasoningPreviews: {
        "q-975": {
          text: "Retained after result",
          updatedAt: 123,
          threadKey: "q-975",
          questId: "q-975",
        },
      },
    } as unknown as BrowserTransportSessionLike;

    sendStateSnapshot(session, ws, {
      getBoard: () => [],
      getCompletedBoard: () => [],
      backendConnected: () => true,
      deriveBackendState: () => "connected",
      getBoardRowSessionStatuses: () => ({}),
    } as unknown as Parameters<typeof sendStateSnapshot>[2]);

    const snapshot = JSON.parse(String(ws.send.mock.calls[0]?.[0]));
    expect(snapshot).toMatchObject({
      type: "state_snapshot",
      sessionStatus: "idle",
      codexReasoningPreviews: [{ text: "Retained after result", threadKey: "q-975" }],
    });
    expect(snapshot).not.toHaveProperty("activeCodexReasoningPreview");
  });
});
