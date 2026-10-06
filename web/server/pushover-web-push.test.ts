import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushoverNotifier, type PushoverNotifierOpts } from "./pushover.js";
import type { WebPushAlert, WebPushDelivery } from "./web-push.js";

/**
 * Tests for Web Push delivery through the shared phone-alert scheduler: Web Push
 * works without Pushover, shares its delay and cancellation, and never sends any
 * follow-up push for an alert already shown. On iOS a follow-up "retraction" push
 * could not close the shown alert and only added another notification, so the
 * scheduler must not send one. The channel itself is faked; web-push.test.ts covers it.
 */

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
class FakeWebPush implements WebPushDelivery {
  alerts: WebPushAlert[] = [];
  subscribed = true;

  hasSubscriptions() {
    return this.subscribed;
  }

  async sendAlert(alert: WebPushAlert) {
    this.alerts.push(alert);
  }
}

describe("PushoverNotifier with Web Push", () => {
  let notifier: PushoverNotifier;
  let webPush: FakeWebPush;
  let lastReadAt: number;

  function makeNotifier(overrides?: Partial<PushoverNotifierOpts>) {
    notifier = new PushoverNotifier({
      // Pushover is off: Web Push alone must keep the scheduler running.
      getSettings: () => ({
        pushoverUserKey: "",
        pushoverApiToken: "",
        pushoverDelaySeconds: 30,
        pushoverEnabled: false,
      }),
      getBaseUrl: () => "http://localhost:3456",
      getServerName: () => "My Server",
      getSessionName: () => "Refactor auth",
      getSessionActivity: () => undefined,
      getLastReadAt: () => lastReadAt,
      webPush,
      ...overrides,
    });
    return notifier;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    webPush = new FakeWebPush();
    lastReadAt = 0;
  });

  afterEach(() => {
    notifier?.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("delivers through Web Push after the shared delay when Pushover is not configured", async () => {
    makeNotifier().scheduleNotification("sess-1", "question", "Which approach?", undefined, {
      notificationId: "n-1",
      skipReadCheck: true,
    });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(webPush.alerts).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);

    expect(webPush.alerts).toEqual([
      expect.objectContaining({
        title: "Takode needs input",
        body: "My Server — Refactor auth\nWhich approach?",
        url: "/#/session/sess-1",
      }),
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not schedule anything when neither channel is available", async () => {
    webPush.subscribed = false;
    makeNotifier().scheduleNotification("sess-1", "question", "q", undefined, { notificationId: "n-1" });
    webPush.subscribed = true;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(webPush.alerts).toHaveLength(0);
  });

  it("sends to both channels when Pushover is also configured", async () => {
    makeNotifier({
      getSettings: () => ({
        pushoverUserKey: "user",
        pushoverApiToken: "token",
        pushoverDelaySeconds: 30,
        pushoverEnabled: true,
      }),
    }).scheduleNotification("sess-1", "permission", "Bash: npm test", "req-1");

    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(PUSHOVER_API_URL);
  });

  it("does not send an alert whose question was answered before the delay", async () => {
    makeNotifier().scheduleNotification("sess-1", "question", "q", undefined, { notificationId: "n-1" });
    await vi.advanceTimersByTimeAsync(10_000);
    notifier.cancelNotification("sess-1", "n-1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(webPush.alerts).toHaveLength(0);
  });

  it("sends no follow-up push once a delivered question is answered", async () => {
    makeNotifier().scheduleNotification("sess-1", "question", "q", undefined, { notificationId: "n-1" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts).toHaveLength(1);

    notifier.cancelNotification("sess-1", "n-1");
    await vi.advanceTimersByTimeAsync(120_000);

    expect(webPush.alerts).toHaveLength(1);
  });

  it("sends no follow-up push when a delivered review alert's session is read", async () => {
    makeNotifier().scheduleNotification("sess-1", "completed");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts).toHaveLength(1);

    lastReadAt = Date.now();
    await vi.advanceTimersByTimeAsync(120_000);

    expect(webPush.alerts).toHaveLength(1);
  });

  it("links a Notify Me alert to its thread", async () => {
    makeNotifier().scheduleNotification("sess-1", "monitored-result", "Result", undefined, {
      notificationId: "monitor:q-1:r1",
      monitoredResult: { threadKey: "q-1", isPending: () => true },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts[0]!.url).toBe("/#/session/sess-1?thread=q-1");
  });
});
