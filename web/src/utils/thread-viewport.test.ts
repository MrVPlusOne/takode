// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  getFeedViewportKey,
  persistLeaderSelectedThreadKey,
  persistLeaderViewportPosition,
  readLeaderSelectedThreadKey,
  readLeaderViewportPosition,
} from "./thread-viewport.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
});

describe("leader session viewport storage", () => {
  it("persists selected thread state in server-scoped browser storage", () => {
    persistLeaderSelectedThreadKey("s1", "Q-941");

    expect(readLeaderSelectedThreadKey("s1")).toBe("q-941");
    expect(localStorage.getItem("test-server:cc-leader-session-view:s1")).toContain('"selectedThreadKey":"q-941"');
  });

  it("persists stable viewport anchors separately for Main, All Threads, and quest threads", () => {
    persistLeaderViewportPosition("s1", "main", {
      scrollTop: 100,
      scrollHeight: 800,
      isAtBottom: false,
      anchorMessageId: "message-main",
      anchorTurnId: "turn-main",
      anchorOffsetTop: 12,
      lastSeenContentBottom: 760,
    });
    persistLeaderViewportPosition("s1", "all", {
      scrollTop: 200,
      scrollHeight: 900,
      isAtBottom: false,
      anchorTurnId: "turn-all",
      anchorOffsetTop: 24,
    });
    persistLeaderViewportPosition("s1", "q-941", {
      scrollTop: 300,
      scrollHeight: 1000,
      isAtBottom: true,
      anchorTurnId: "turn-quest",
      anchorOffsetTop: 36,
    });

    expect(readLeaderViewportPosition("s1", "main")?.anchorTurnId).toBe("turn-main");
    expect(readLeaderViewportPosition("s1", "main")?.anchorMessageId).toBe("message-main");
    expect(readLeaderViewportPosition("s1", "all")?.anchorTurnId).toBe("turn-all");
    expect(readLeaderViewportPosition("s1", "q-941")?.anchorTurnId).toBe("turn-quest");
    expect(localStorage.getItem("test-server:cc-leader-session-view:s1")).toContain(getFeedViewportKey("s1", "all"));
  });

  it("migrates legacy viewport state without restoring ambiguous non-bottom anchors", () => {
    // Version-1 records predate reconnect-safe viewport ownership. Preserve an explicit
    // selected thread and safe at-bottom semantics, but do not let a valid-looking old
    // non-bottom anchor deterministically retarget a restarted bounded thread window.
    const storageKey = "test-server:cc-leader-session-view:s1";
    const staleMainViewportKey = getFeedViewportKey("s1", "main");
    const safeBottomViewportKey = getFeedViewportKey("s1", "q-941");
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        version: 1,
        selectedThreadKey: "main",
        viewports: {
          [staleMainViewportKey]: {
            scrollTop: 11_700,
            scrollHeight: 14_000,
            isAtBottom: false,
            anchorMessageId: "message-117",
            anchorTurnId: "message-117",
            anchorOffsetTop: 100,
            lastSeenContentBottom: 13_900,
          },
          [safeBottomViewportKey]: {
            scrollTop: 2_400,
            scrollHeight: 3_000,
            isAtBottom: true,
            anchorMessageId: "latest-message",
            anchorTurnId: "latest-message",
            anchorOffsetTop: 20,
            lastSeenContentBottom: 2_950,
          },
        },
        updatedAt: 1_787_786_980_300,
      }),
    );

    expect(readLeaderSelectedThreadKey("s1")).toBe("main");
    expect(readLeaderViewportPosition("s1", "main")).toBeNull();
    expect(readLeaderViewportPosition("s1", "q-941")).toMatchObject({ isAtBottom: true });

    const migrated = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    expect(migrated).toMatchObject({
      version: 2,
      selectedThreadKey: "main",
    });
    expect(migrated.viewports).not.toHaveProperty(staleMainViewportKey);
    expect(migrated.viewports[safeBottomViewportKey]).toMatchObject({ isAtBottom: true });
  });

  it("uses safely migrated state even when rewriting browser storage fails", () => {
    localStorage.setItem(
      "test-server:cc-leader-session-view:s1",
      JSON.stringify({ version: 1, selectedThreadKey: "q-941", viewports: {}, updatedAt: 1 }),
    );
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    try {
      expect(readLeaderSelectedThreadKey("s1")).toBe("q-941");
    } finally {
      write.mockRestore();
    }
  });

  it("ignores invalid selected thread keys instead of restoring stale arbitrary tabs", () => {
    persistLeaderSelectedThreadKey("s1", "not-a-thread");

    expect(readLeaderSelectedThreadKey("s1")).toBeNull();
    expect(localStorage.getItem("test-server:cc-leader-session-view:s1")).toBeNull();
  });
});
