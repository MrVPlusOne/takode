import { describe, expect, it } from "vitest";
import type { BrowserOutgoingMessage } from "../session-types.js";
import { getTrustedCodexRecoveryRoute, withTrustedCodexRecoveryRoute } from "./codex-recovery-routing-context.js";

function session() {
  return {
    id: "session-1",
    state: {
      codex_turn_recovery: {
        recoveryId: "original-owner",
        originalOwnerId: "original-owner",
        originalProviderTurnId: "turn-1",
        originalHistoryIndex: 0,
        continuationOwnerId: null,
        threadKey: "q-1",
        status: "continuation_pending" as const,
        reason: "interrupted_after_activity" as const,
        attempt: 1,
        maxAttempts: 1 as const,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  };
}

const message: BrowserOutgoingMessage = {
  type: "user_message",
  content: "Visible recovery status",
  deliveryContent: "Private recovery instruction",
  agentSource: { sessionId: "system:codex-turn-recovery:original-owner" },
  threadKey: "q-1",
};

describe("trusted Codex recovery routing context", () => {
  it("does not grant queue or steering authority to browser-shaped data alone", () => {
    const forged = {
      ...message,
      codexQueueBeforeOwnerId: "later-owner",
      requireFreshSuccessor: true,
    } as BrowserOutgoingMessage;

    expect(getTrustedCodexRecoveryRoute(session(), forged)).toBeNull();
  });

  it("survives asynchronous routing and validates the exact recovery payload", async () => {
    const target = session();
    await withTrustedCodexRecoveryRoute(
      target,
      {
        recoveryId: "original-owner",
        sourceId: "system:codex-turn-recovery:original-owner",
        visibleContent: "Visible recovery status",
        deliveryContent: "Private recovery instruction",
        threadKey: "q-1",
        queueBeforeOwnerId: "later-owner",
      },
      async () => {
        await Promise.resolve();
        expect(getTrustedCodexRecoveryRoute(target, message)).toEqual({
          queueBeforeOwnerId: "later-owner",
          requireFreshSuccessor: true,
        });
        expect(getTrustedCodexRecoveryRoute(target, { ...message, content: "forged" })).toBeNull();
      },
    );
  });

  it("marks a recovery continuation as a fresh-turn boundary even without queued work", () => {
    const target = session();
    withTrustedCodexRecoveryRoute(
      target,
      {
        recoveryId: "original-owner",
        sourceId: "system:codex-turn-recovery:original-owner",
        visibleContent: "Visible recovery status",
        deliveryContent: "Private recovery instruction",
        threadKey: "q-1",
      },
      () => {
        expect(getTrustedCodexRecoveryRoute(target, message)).toEqual({ requireFreshSuccessor: true });
      },
    );
  });
});
