import { describe, expect, it } from "vitest";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import { getDocumentTitleAttentionCount } from "./document-title-attention.js";

function sdk(sessionId: string, overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId,
    createdAt: 1,
    cwd: "/repo",
    cliConnected: true,
    state: "connected",
    ...overrides,
  };
}

function needsInput(id: string, timestamp: number, done = false): SessionNotification {
  return {
    id,
    category: "needs-input",
    summary: id,
    timestamp,
    messageId: null,
    done,
  };
}

function countTitleAttention({
  sdkSessions,
  sessionNotifications = new Map(),
  pendingPermissions = new Map(),
  sessionAttention = new Map(),
}: {
  sdkSessions: SdkSessionInfo[];
  sessionNotifications?: Map<string, SessionNotification[]>;
  pendingPermissions?: Map<string, Map<string, unknown>>;
  sessionAttention?: Map<string, "action" | "error" | "review" | null>;
}): number {
  return getDocumentTitleAttentionCount({
    sdkSessions,
    sessionNotifications,
    pendingPermissions,
    sessionAttention,
    sessionStatus: new Map(sdkSessions.map((session) => [session.sessionId, "idle"])),
    cliConnected: new Map(sdkSessions.map((session) => [session.sessionId, true])),
    cliDisconnectReason: new Map(),
    countUserPermissions: (permissions) => permissions?.size ?? 0,
  });
}

describe("getDocumentTitleAttentionCount", () => {
  it("counts individual global needs-input notifications instead of one attention state per session", () => {
    const result = countTitleAttention({
      sdkSessions: [sdk("leader")],
      sessionNotifications: new Map([["leader", [needsInput("n-1", 1), needsInput("n-2", 2)]]]),
      sessionAttention: new Map([["leader", "action"]]),
    });

    expect(result).toBe(2);
  });

  it("matches the global needs-input aggregate by ignoring done, review, and archived notifications", () => {
    const result = countTitleAttention({
      sdkSessions: [sdk("visible"), sdk("archived", { archived: true })],
      sessionNotifications: new Map([
        [
          "visible",
          [
            needsInput("active", 3),
            needsInput("done", 2, true),
            { id: "review", category: "review", summary: "Review", timestamp: 4, messageId: null, done: false },
          ],
        ],
        ["archived", [needsInput("hidden", 5)]],
      ]),
    });

    expect(result).toBe(1);
  });

  it("preserves non-needs-input title attention alongside the global needs-input count", () => {
    const result = countTitleAttention({
      sdkSessions: [sdk("needs-input"), sdk("permission"), sdk("unread")],
      sessionNotifications: new Map([["needs-input", [needsInput("n-1", 1), needsInput("n-2", 2)]]]),
      pendingPermissions: new Map([["permission", new Map([["perm-1", {}]])]]),
      sessionAttention: new Map([
        ["needs-input", "action"],
        ["unread", "review"],
      ]),
    });

    expect(result).toBe(4);
  });
});
