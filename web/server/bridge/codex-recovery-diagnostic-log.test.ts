import { describe, expect, it, vi } from "vitest";

const warn = vi.hoisted(() => vi.fn());
vi.mock("../server-logger.js", () => ({
  createLogger: () => ({ warn }),
}));

import type { CodexOutboundTurn } from "../session-types.js";
import { buildCodexRecoveryDiagnosticLogContext, logCodexRecoveryDiagnostic } from "./codex-recovery-diagnostic-log.js";

function pendingTurn(userMessageId: string, turnId: string | null): CodexOutboundTurn {
  return {
    adapterMsg: { type: "user_message", content: "inspect" },
    userMessageId,
    pendingInputIds: [userMessageId],
    userContent: "inspect",
    historyIndex: 0,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 2,
    acknowledgedAt: 2,
    turnTarget: "current",
    lastError: null,
    turnId,
    disconnectedAt: 100,
    resumeConfirmedAt: null,
  };
}

describe("Codex recovery diagnostic logging", () => {
  it("writes session-filterable payload-free recovery metadata after the presentation outcome is known", () => {
    logCodexRecoveryDiagnostic({
      sessionId: "session-1",
      reason: "codex_resume_incomplete_recovered_messages",
      ownerId: "owner-1",
      ownerStatus: "backend_acknowledged",
      providerTurnId: "turn-1",
      threadStatus: "idle",
      turnStatus: "interrupted",
      evidenceClass: "interrupted_assistant",
      recoveredAssistantCount: 1,
      synthesizedToolResultCount: 0,
      omittedToolResultCount: 0,
      activityKinds: ["assistant_text"],
      activityCount: 1,
      sameTurnCoOwnerCount: 1,
      presentation: "continuation_queued",
      continuationQueued: true,
      diagnosticAppended: false,
      browserErrorBroadcast: false,
      routeThreadKey: "q-1986",
      routeQuestId: "q-1986",
    });

    expect(warn).toHaveBeenCalledWith(
      "Codex resumed turn settled without automatic replay",
      expect.objectContaining({
        sessionId: "session-1",
        source: "resume_reconciliation",
        reason: "codex_resume_incomplete_recovered_messages",
        ownerId: "owner-1",
        providerTurnId: "turn-1",
        presentation: "continuation_queued",
        continuationQueued: true,
        diagnosticAppended: false,
        browserErrorBroadcast: false,
        activityKinds: ["assistant_text"],
      }),
    );
    const metadata = warn.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(metadata).not.toHaveProperty("content");
    expect(metadata).not.toHaveProperty("toolInput");
    expect(metadata).not.toHaveProperty("rawError");
  });

  it("counts the exact owner plus same-provider-turn co-owners before settlement", () => {
    const owner = pendingTurn("owner-1", null);
    const coOwner = pendingTurn("owner-2", "turn-restored");

    const context = buildCodexRecoveryDiagnosticLogContext({
      session: { id: "session-1", pendingCodexTurns: [owner, coOwner] },
      owner,
      lastTurn: {
        id: "turn-restored",
        status: "interrupted",
        error: null,
        items: [],
      },
      threadStatus: "idle",
      reason: "codex_resume_incomplete_recovered_messages",
      evidenceClass: "interrupted_activity",
      recoveredAssistantCount: 0,
      synthesizedToolResultCount: 0,
      omittedToolResultCount: 0,
      activity: {
        count: 1,
        kinds: ["reasoning"],
        firstHistoryIndex: 1,
        lastHistoryIndex: 1,
      },
      route: { threadKey: "main" },
    });

    expect(context).toMatchObject({
      ownerId: "owner-1",
      providerTurnId: "turn-restored",
      sameTurnCoOwnerCount: 2,
      evidenceClass: "interrupted_activity",
      activityKinds: ["reasoning"],
    });
  });
});
