// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../types.js";

const getSessionNotifications = vi.hoisted(() => vi.fn());
vi.mock("../api.js", () => ({ api: { getSessionNotifications, markSessionRead: vi.fn() } }));
vi.mock("../components/NotifyMe.js", () => ({ openNotifyMeEntry: vi.fn() }));

import { useStore } from "../store.js";
import { openAttentionItem } from "./useAttentionNavigator.js";

function review(id: string, timestamp: number, messageId: string | null, threadKey = "q-1"): SessionNotification {
  return { id, category: "review", summary: "Answer", timestamp, messageId, threadKey, done: false };
}

const UNREAD_Q1 = {
  kind: "unread" as const,
  key: "unread:leader:q-1",
  sessionId: "leader",
  threadKey: "q-1",
  label: "q-1",
  timestamp: 30,
};

// Opening an unread thread from the attention list, Next or the feed chip lands on the first
// result the user hasn't read, not the newest one or wherever the thread was left.
describe("openAttentionItem on an unread thread", () => {
  beforeEach(() => {
    window.location.hash = "#/session/other";
    getSessionNotifications.mockReset();
    useStore.getState().reset();
    useStore.setState({ sdkSessions: [{ sessionId: "leader", archived: false } as never] });
  });

  it("opens at the oldest unread result in that thread", () => {
    useStore
      .getState()
      .setSessionNotifications("leader", [
        review("n-2", 20, "m-second"),
        review("n-1", 10, "m-first"),
        review("n-main", 5, "m-main", "main"),
        { ...review("n-0", 1, "m-read"), done: true },
      ]);

    openAttentionItem(UNREAD_Q1, useStore.getState().sdkSessions);

    expect(window.location.hash).toBe("#/session/leader/msg/m-first?thread=q-1");
    expect(getSessionNotifications).not.toHaveBeenCalled();
  });

  it("opens the thread at once and moves to the first unread result once it loads", async () => {
    // This browser hasn't loaded that session's notifications: no waiting before the thread opens.
    let resolve!: (notifications: SessionNotification[]) => void;
    getSessionNotifications.mockReturnValue(new Promise((done) => (resolve = done)));

    openAttentionItem(UNREAD_Q1, useStore.getState().sdkSessions);
    expect(window.location.hash).toBe("#/session/leader?thread=q-1");
    // Only the results the browser would list: ones already read don't count as unread.
    expect(getSessionNotifications).toHaveBeenCalledWith("leader", { visible: true });

    const historyLength = history.length;
    resolve([review("n-2", 20, "m-second"), review("n-1", 10, "m-first")]);
    await vi.waitFor(() => expect(window.location.hash).toBe("#/session/leader/msg/m-first?thread=q-1"));
    // Replaced in place, so Back doesn't return to the bare thread first.
    expect(history.length).toBe(historyLength);
  });

  it("does not pull the user back after they moved on before the notifications loaded", async () => {
    let resolve!: (notifications: SessionNotification[]) => void;
    getSessionNotifications.mockReturnValue(new Promise((done) => (resolve = done)));

    openAttentionItem(UNREAD_Q1, useStore.getState().sdkSessions);
    window.location.hash = "#/session/leader?thread=q-2";
    resolve([review("n-1", 10, "m-first")]);
    await new Promise((done) => setTimeout(done, 0));

    expect(window.location.hash).toBe("#/session/leader?thread=q-2");
  });
});
