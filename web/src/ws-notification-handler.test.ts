// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store.js";
import { handleAttentionAlertMessage, handleNotificationUpdateMessage } from "./ws-notification-handler.js";
import type { BrowserIncomingMessage, SdkSessionInfo, SessionNotification } from "./types.js";
import { playNeedsInputSound, playReviewSound } from "./utils/notification-sound.js";
import { isMostRecentlyUsedAlertWindow } from "./utils/alert-window-presence.js";
import { markLeaderThreadDisplayed } from "./utils/thread-viewport.js";

vi.mock("./utils/notification-sound.js", () => ({
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

vi.mock("./utils/alert-window-presence.js", () => ({
  isMostRecentlyUsedAlertWindow: vi.fn(() => true),
}));

function session(): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    cwd: "/repo",
    createdAt: 1,
    archived: false,
  };
}

function review(id: string): SessionNotification {
  return {
    id,
    category: "review",
    summary: "Ready for review",
    timestamp: 1000,
    messageId: null,
    done: false,
  };
}

describe("handleNotificationUpdateMessage", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().setSdkSessions([session()]);
    useStore.setState({ notificationSound: false });
  });

  it("preserves authoritative counts instead of recomputing raw rows", () => {
    const notifications = [review("n-1"), review("n-2"), review("n-3"), review("n-4"), review("n-5")];

    handleNotificationUpdateMessage("s1", {
      notifications,
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 0,
      activeReviewNotificationCount: 1,
      mutedNeedsInputNotificationCount: 0,
      notificationStatusVersion: 7,
      notificationStatusUpdatedAt: 7000,
    });

    expect(useStore.getState().sessionNotifications.get("s1")).toEqual(notifications);
    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
      notificationStatusVersion: 7,
    });
  });

  it("derives counts for backward-compatible updates without summary fields", () => {
    handleNotificationUpdateMessage("s1", {
      notifications: [review("n-1")],
      notificationStatusVersion: 6,
    });

    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
      notificationStatusVersion: 6,
    });
  });
});

type AttentionAlert = Extract<BrowserIncomingMessage, { type: "attention_alert" }>;

function alert(kind: AttentionAlert["kind"], sessionId: string, threadKey?: string): AttentionAlert {
  return { type: "attention_alert", session_id: sessionId, kind, ...(threadKey ? { thread_key: threadKey } : {}) };
}

/** Which sound each call played, in order. */
function playedSounds(): string[] {
  const calls = [
    ...vi.mocked(playNeedsInputSound).mock.invocationCallOrder.map((order) => [order, "two-tap"] as const),
    ...vi.mocked(playReviewSound).mock.invocationCallOrder.map((order) => [order, "single"] as const),
  ];
  return calls.sort((left, right) => left[0] - right[0]).map(([, sound]) => sound);
}

// The burst window is module state, so each test starts well after the previous test's sounds.
let clock = Date.parse("2026-10-17T00:00:00Z");

describe("handleAttentionAlertMessage", () => {
  let focused = true;
  let cleanupDisplayed: (() => void) | null = null;

  beforeEach(() => {
    clock += 60_000;
    vi.useFakeTimers({ now: clock, toFake: ["Date"] });
    vi.mocked(playNeedsInputSound).mockClear();
    vi.mocked(playReviewSound).mockClear();
    vi.mocked(isMostRecentlyUsedAlertWindow).mockReturnValue(true);
    focused = true;
    vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
    useStore.getState().reset();
    useStore.setState({ notificationSound: true, currentSessionId: "leader" });
    window.location.hash = "#/session/leader";
    cleanupDisplayed?.();
    cleanupDisplayed = markLeaderThreadDisplayed("leader", "q-5");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stays silent for the tab on screen in a focused window", () => {
    // The user is looking at leader thread q-5: changes there need no sound.
    handleAttentionAlertMessage(alert("result", "leader", "q-5"), { live: true });
    handleAttentionAlertMessage(alert("needs-input", "leader", "q-5"), { live: true });

    expect(playedSounds()).toEqual([]);
  });

  it("rings for another tab of the open session and for other sessions", () => {
    handleAttentionAlertMessage(alert("result", "leader", "main"), { live: true });
    vi.advanceTimersByTime(3000);
    handleAttentionAlertMessage(alert("needs-input", "other-session"), { live: true });

    expect(playedSounds()).toEqual(["single", "two-tap"]);
  });

  it("counts an unfocused window as viewing nothing", () => {
    focused = false;
    handleAttentionAlertMessage(alert("result", "leader", "q-5"), { live: true });

    expect(playedSounds()).toEqual(["single"]);
  });

  it("treats an ordinary session on screen as its only tab", () => {
    useStore.setState({ currentSessionId: "solo" });
    window.location.hash = "#/session/solo";
    handleAttentionAlertMessage(alert("result", "solo"), { live: true });
    expect(playedSounds()).toEqual([]);

    // Another page over the same selected session is not viewing it.
    window.location.hash = "#/questmaster";
    handleAttentionAlertMessage(alert("result", "solo"), { live: true });
    expect(playedSounds()).toEqual(["single"]);
  });

  it("plays one sound per burst, letting a needs-input prompt follow a single tone", () => {
    handleAttentionAlertMessage(alert("result", "a"), { live: true });
    vi.advanceTimersByTime(500);
    handleAttentionAlertMessage(alert("result", "b"), { live: true });
    vi.advanceTimersByTime(500);
    handleAttentionAlertMessage(alert("needs-input", "c"), { live: true });
    vi.advanceTimersByTime(500);
    handleAttentionAlertMessage(alert("result", "d"), { live: true });
    handleAttentionAlertMessage(alert("needs-input", "e"), { live: true });
    expect(playedSounds()).toEqual(["single", "two-tap"]);

    vi.advanceTimersByTime(2500);
    handleAttentionAlertMessage(alert("result", "f"), { live: true });
    expect(playedSounds()).toEqual(["single", "two-tap", "single"]);
  });

  it("stays silent for replayed alerts, with sounds off, and in a window used less recently", () => {
    handleAttentionAlertMessage(alert("needs-input", "a"), { live: false });

    useStore.setState({ notificationSound: false });
    handleAttentionAlertMessage(alert("needs-input", "a"), { live: true });

    useStore.setState({ notificationSound: true });
    vi.mocked(isMostRecentlyUsedAlertWindow).mockReturnValue(false);
    handleAttentionAlertMessage(alert("needs-input", "a"), { live: true });

    expect(playedSounds()).toEqual([]);
  });
});
