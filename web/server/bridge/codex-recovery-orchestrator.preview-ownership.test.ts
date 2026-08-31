import { describe, expect, it, vi } from "vitest";
import { removePendingCodexInput, type CodexRecoveryOrchestratorSessionLike } from "./codex-recovery-orchestrator.js";

function previewSession(): CodexRecoveryOrchestratorSessionLike {
  return {
    id: "preview-session",
    pendingCodexInputs: [
      { id: "pending-old", content: "Older pending", timestamp: 200, cancelable: true },
      { id: "pending-new", content: "Newest pending", timestamp: 300, cancelable: true },
    ],
    messageHistory: [{ type: "user_message", id: "committed", content: "Committed", timestamp: 100 }],
    lastUserMessage: "Newest pending",
    lastMessagePreviewAt: 300,
  } as unknown as CodexRecoveryOrchestratorSessionLike;
}

describe("Codex pending-input preview ownership", () => {
  it("restores the previous preview owner when the newest pending input is cancelled", () => {
    const session = previewSession();
    const deps = { broadcastPendingCodexInputs: vi.fn(), persistSession: vi.fn() };

    expect(removePendingCodexInput(session, "pending-new", deps)).toMatchObject({ id: "pending-new" });
    expect(session.lastUserMessage).toBe("Older pending");
    expect(session.lastMessagePreviewAt).toBe(200);
  });
});
