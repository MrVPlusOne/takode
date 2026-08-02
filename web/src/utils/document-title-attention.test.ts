import { describe, expect, it } from "vitest";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import { formatDocumentTitle, getDocumentTitleAttentionCount } from "./document-title-attention.js";

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

function needsInput(id: string, timestamp: number, done = false, muted = false): SessionNotification {
  return {
    id,
    category: "needs-input",
    summary: id,
    timestamp,
    messageId: null,
    done,
    ...(muted ? { muted: true } : {}),
  };
}

function countTitleAttention({
  sdkSessions,
  sessionNotifications = new Map(),
  pendingPermissions = new Map(),
  sessionAttention = new Map(),
  sessionStatus = new Map(),
}: {
  sdkSessions: SdkSessionInfo[];
  sessionNotifications?: Map<string, SessionNotification[]>;
  pendingPermissions?: Map<string, Map<string, unknown>>;
  sessionAttention?: Map<string, "action" | "error" | "review" | null>;
  sessionStatus?: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
}): number {
  // Keep unrelated attention state in this fixture so regressions cannot
  // accidentally reintroduce it into the needs-input-only title projection.
  const state = {
    sdkSessions,
    sessionNotifications,
    pendingPermissions,
    sessionAttention,
    sessionStatus,
    cliConnected: new Map(sdkSessions.map((session) => [session.sessionId, true])),
    cliDisconnectReason: new Map(),
    countUserPermissions: (permissions: Map<string, unknown> | undefined) => permissions?.size ?? 0,
  };
  return getDocumentTitleAttentionCount(state);
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

  it("aggregates active needs-input notifications across sessions", () => {
    const result = countTitleAttention({
      sdkSessions: [sdk("leader"), sdk("worker")],
      sessionNotifications: new Map([
        ["leader", [needsInput("n-1", 1)]],
        ["worker", [needsInput("n-2", 2), needsInput("n-3", 3)]],
      ]),
    });

    expect(result).toBe(3);
  });

  it("excludes done, muted, review, and archived notifications", () => {
    const result = countTitleAttention({
      sdkSessions: [sdk("visible"), sdk("archived", { archived: true })],
      sessionNotifications: new Map([
        [
          "visible",
          [
            needsInput("active", 3),
            needsInput("done", 2, true),
            needsInput("muted", 1, false, true),
            { id: "review", category: "review", summary: "Review", timestamp: 4, messageId: null, done: false },
          ],
        ],
        ["archived", [needsInput("hidden", 5)]],
      ]),
    });

    expect(result).toBe(1);
  });

  it("returns zero when there are no active needs-input notifications", () => {
    const result = countTitleAttention({
      sdkSessions: [sdk("empty")],
    });

    expect(result).toBe(0);
  });

  it("ignores permission, unread, review, waiting, and generic attention in mixed state", () => {
    const result = countTitleAttention({
      sdkSessions: [
        sdk("needs-input"),
        sdk("permission"),
        sdk("unread"),
        sdk("review"),
        sdk("waiting"),
        sdk("generic"),
      ],
      sessionNotifications: new Map([
        ["needs-input", [needsInput("n-1", 1)]],
        [
          "review",
          [{ id: "review", category: "review", summary: "Review", timestamp: 2, messageId: null, done: false }],
        ],
      ]),
      pendingPermissions: new Map([["permission", new Map([["perm-1", {}]])]]),
      sessionAttention: new Map([
        ["unread", "review"],
        ["waiting", "action"],
        ["generic", "error"],
      ]),
      sessionStatus: new Map([["waiting", "running"]]),
    });

    expect(result).toBe(1);
  });

  it("follows fresh authoritative summaries over stale cached notifications", () => {
    const sessionNotifications = new Map([["session", [needsInput("stale", 1)]]]);

    expect(
      countTitleAttention({
        sdkSessions: [
          sdk("session", {
            notificationUrgency: null,
            activeNotificationCount: 0,
            activeNeedsInputNotificationCount: 0,
            notificationStatusVersion: 2,
          }),
        ],
        sessionNotifications,
      }),
    ).toBe(0);
  });

  it("drops a needs-input prompt when its session becomes archived", () => {
    const sessionNotifications = new Map([["session", [needsInput("active", 1)]]]);

    expect(countTitleAttention({ sdkSessions: [sdk("session")], sessionNotifications })).toBe(1);
    expect(countTitleAttention({ sdkSessions: [sdk("session", { archived: true })], sessionNotifications })).toBe(0);
  });
});

describe("formatDocumentTitle", () => {
  it("prefixes the existing base title with the active needs-input count", () => {
    expect(formatDocumentTitle("Macbook — Takode", 2)).toBe("(2) Macbook — Takode");
  });

  it("preserves normal and development base titles when the count is zero", () => {
    expect(formatDocumentTitle("Takode", 0)).toBe("Takode");
    expect(formatDocumentTitle("Macbook — [DEV] Takode", 0)).toBe("Macbook — [DEV] Takode");
  });
});
