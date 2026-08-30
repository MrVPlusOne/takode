import { describe, expect, it } from "vitest";
import type { SessionNotification } from "./session-types.js";
import { createSessionAttentionProjectionDefinition } from "./session-attention-projection.js";

function notification(
  id: string,
  category: "needs-input" | "review",
  overrides: Partial<SessionNotification> = {},
): SessionNotification {
  return {
    id,
    category,
    timestamp: 100,
    messageId: `message-${id}`,
    done: false,
    ...overrides,
  };
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-a",
    attentionReason: null,
    lastReadAt: 0,
    pendingPermissions: new Map(),
    notifications: [],
    notificationStatusVersion: 0,
    notificationStatusUpdatedAt: 0,
    state: {},
    ...overrides,
  } as any;
}

function derive(source: ReturnType<typeof session>, herded = false) {
  const definition = createSessionAttentionProjectionDefinition<{}>({
    getSession: () => source,
    isHerdedWorkerSession: () => herded,
    authorizeSubscription: () => true,
  });
  const dependencies = definition.selectDependencies(source, source.id);
  return definition.derive(source, source.id, dependencies);
}

describe("session attention projection", () => {
  it("derives notification, pending-permission, muted, and error semantics", () => {
    expect(
      derive(
        session({
          attentionReason: "error",
          notifications: [notification("review", "review")],
          notificationStatusVersion: 1,
        }),
      ),
    ).toEqual({ attentionReason: "error", status: { urgency: "review", count: 1 } });

    expect(
      derive(
        session({
          attentionReason: "error",
          pendingPermissions: new Map([
            ["p1", { tool_name: "Bash" }],
            ["p2", { tool_name: "AskUserQuestion" }],
          ]),
        }),
      ),
    ).toEqual({ attentionReason: "action", status: { urgency: "needs-input", count: 2 } });

    expect(
      derive(
        session({
          notifications: [notification("muted", "needs-input", { muted: true })],
          notificationStatusVersion: 1,
        }),
      ),
    ).toEqual({ attentionReason: null, status: { urgency: "muted-needs-input", count: 1 } });
  });

  it("filters read and closed leader review targets before deriving status", () => {
    const source = session({
      attentionReason: "review",
      notifications: [
        notification("open", "review", { threadKey: "q-1", questId: "q-1", timestamp: 200 }),
        notification("closed", "review", { threadKey: "q-2", questId: "q-2", timestamp: 300 }),
        notification("read", "review", { threadKey: "q-1", questId: "q-1", timestamp: 50 }),
      ],
      lastReadAt: 100,
      notificationStatusVersion: 3,
      state: {
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1"],
          closedThreadTombstones: [],
          updatedAt: 300,
        },
      },
    });

    expect(derive(source)).toEqual({ attentionReason: "review", status: { urgency: "review", count: 1 } });

    source.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [],
      updatedAt: 400,
    };
    expect(derive(source)).toEqual({ attentionReason: null, status: null });
  });

  it("keeps raw count-one fallback only for legacy status and suppresses herded notification summaries", () => {
    const legacy = session({ attentionReason: "review" });
    delete legacy.notificationStatusVersion;
    delete legacy.notificationStatusUpdatedAt;
    expect(derive(legacy)).toEqual({ attentionReason: "review", status: { urgency: "review", count: 1 } });

    expect(
      derive(
        session({
          attentionReason: null,
          notifications: [notification("needs-input", "needs-input")],
          notificationStatusVersion: 1,
        }),
        true,
      ),
    ).toEqual({ attentionReason: null, status: null });
  });

  it("does not promote ambiguous pre-discriminator review after notification status is initialized", () => {
    // Older persisted rows used attentionReason for both manual and
    // notification-derived review. Inferring manual unread here would revive
    // already-read or closed targets, so only the new explicit bit opts in.
    expect(derive(session({ attentionReason: "review", notificationStatusVersion: 1 }))).toEqual({
      attentionReason: null,
      status: null,
    });
  });

  it("keeps explicit manual unread authoritative after notification status has been initialized", () => {
    expect(
      derive(
        session({
          attentionReason: "review",
          manualUnread: true,
          notificationStatusVersion: 4,
          notificationStatusUpdatedAt: 400,
        }),
      ),
    ).toEqual({ attentionReason: "review", status: { urgency: "review", count: 1 } });
  });
});
