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

function sessionInbox(...notifications: SessionNotification[]): Map<string, SessionNotification[]> {
  return new Map([["session", notifications]]);
}

interface TitleAttentionFixture {
  sdkSessions: SdkSessionInfo[];
  sessionNotifications?: Map<string, SessionNotification[]>;
  pendingPermissions?: Map<string, Map<string, unknown>>;
  sessionAttention?: Map<string, "action" | "error" | "review" | null>;
  sessionStatus?: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
}

function countTitleAttention({
  sdkSessions,
  sessionNotifications = new Map(),
  pendingPermissions = new Map(),
  sessionAttention = new Map(),
  sessionStatus = new Map(),
}: TitleAttentionFixture): number {
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

function expectTitleProjection(
  state: TitleAttentionFixture,
  expected: { count: number; title: string },
  base = "Macbook — Takode",
): void {
  const count = countTitleAttention(state);
  expect({ count, title: formatDocumentTitle(base, count) }).toEqual(expected);
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
});

describe("document title notification transitions", () => {
  it("updates the base title when an active needs-input notification is created", () => {
    const sdkSessions = [sdk("session")];

    // A server inbox update should move the title from its zero state to one active prompt.
    expectTitleProjection({ sdkSessions }, { count: 0, title: "Macbook — Takode" });
    expectTitleProjection(
      { sdkSessions, sessionNotifications: sessionInbox(needsInput("created", 1)) },
      { count: 1, title: "(1) Macbook — Takode" },
    );
  });

  it("removes the title prefix when the active notification is resolved", () => {
    const sdkSessions = [sdk("session")];

    // Resolution keeps the historical row but marks it done, so title projection must clear.
    expectTitleProjection(
      { sdkSessions, sessionNotifications: sessionInbox(needsInput("prompt", 1)) },
      { count: 1, title: "(1) Macbook — Takode" },
    );
    expectTitleProjection(
      { sdkSessions, sessionNotifications: sessionInbox(needsInput("prompt", 1, true)) },
      { count: 0, title: "Macbook — Takode" },
    );
  });

  it("removes and restores the title prefix across mute and unmute", () => {
    const sdkSessions = [sdk("session")];

    // Muting changes attention only; unmuting the unresolved prompt must restore its title count.
    expectTitleProjection(
      { sdkSessions, sessionNotifications: sessionInbox(needsInput("prompt", 1)) },
      { count: 1, title: "(1) Macbook — Takode" },
    );
    expectTitleProjection(
      { sdkSessions, sessionNotifications: sessionInbox(needsInput("prompt", 1, false, true)) },
      { count: 0, title: "Macbook — Takode" },
    );
    expectTitleProjection(
      { sdkSessions, sessionNotifications: sessionInbox(needsInput("prompt", 1)) },
      { count: 1, title: "(1) Macbook — Takode" },
    );
  });

  it("clears a stale cached prompt when a fresh server summary reports zero", () => {
    const sessionNotifications = sessionInbox(needsInput("stale", 1));

    // The same cached inbox is first usable, then gated out by newer authoritative summary state.
    expectTitleProjection(
      { sdkSessions: [sdk("session")], sessionNotifications },
      { count: 1, title: "(1) Macbook — Takode" },
    );
    expectTitleProjection(
      {
        sdkSessions: [
          sdk("session", {
            notificationUrgency: null,
            activeNotificationCount: 0,
            activeNeedsInputNotificationCount: 0,
            notificationStatusVersion: 2,
          }),
        ],
        sessionNotifications,
      },
      { count: 0, title: "Macbook — Takode" },
    );
  });

  it("drops a needs-input prompt when its session becomes archived", () => {
    const sessionNotifications = sessionInbox(needsInput("active", 1));

    // Archiving removes the session from both the bell aggregate and document-title projection.
    expectTitleProjection(
      { sdkSessions: [sdk("session")], sessionNotifications },
      { count: 1, title: "(1) Macbook — Takode" },
    );
    expectTitleProjection(
      { sdkSessions: [sdk("session", { archived: true })], sessionNotifications },
      { count: 0, title: "Macbook — Takode" },
    );
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
