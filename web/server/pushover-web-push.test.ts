import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushoverNotifier, type PushoverNotifierOpts } from "./pushover.js";
import type { WebPushAlert, WebPushDelivery } from "./web-push.js";

/**
 * Tests for Web Push delivery through the shared phone-alert scheduler: Web Push
 * works without Pushover, shares its delay, and retracts delivered alerts once
 * their question is answered, their session is read, or their Notify Me result
 * is acknowledged. The channel itself is faked; web-push.test.ts covers it.
 */

const PUSHOVER_API_URL = "https://api.pushover.net/1/messages.json";
const PHONE = "https://web.push.apple.com/phone";

class FakeWebPush implements WebPushDelivery {
  alerts: WebPushAlert[] = [];
  retractions: Array<{ endpoints: string[]; tags: string[] }> = [];
  subscribed = true;
  /** Lets a test hold an alert "in flight" to the push service. */
  release: (() => void) | null = null;
  holdNextAlert = false;

  hasSubscriptions() {
    return this.subscribed;
  }

  sendAlert(alert: WebPushAlert): Promise<string[]> {
    this.alerts.push(alert);
    if (!this.holdNextAlert) return Promise.resolve([PHONE]);
    this.holdNextAlert = false;
    return new Promise((resolve) => {
      this.release = () => resolve([PHONE]);
    });
  }

  async sendRetraction(endpoints: string[], tags: string[]) {
    this.retractions.push({ endpoints, tags });
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

  it("retracts a delivered needs-input alert once its question is answered", async () => {
    makeNotifier().scheduleNotification("sess-1", "question", "q", undefined, { notificationId: "n-1" });
    await vi.advanceTimersByTimeAsync(30_000);
    const tag = webPush.alerts[0]!.tag;

    notifier.cancelNotification("sess-1", "n-1");
    await vi.advanceTimersByTimeAsync(0);

    expect(webPush.retractions).toEqual([{ endpoints: [PHONE], tags: [tag] }]);
  });

  it("keeps a batched alert until every question in it is answered", async () => {
    // Two permission requests batch into one "2 permissions waiting" alert; answering one
    // must not hide the phone alert for the other.
    makeNotifier();
    notifier.scheduleNotification("sess-1", "permission", "Bash: a", "req-1");
    notifier.scheduleNotification("sess-1", "permission", "Bash: b", "req-2");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts).toHaveLength(1);

    notifier.cancelPermission("sess-1", "req-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(webPush.retractions).toHaveLength(0);

    notifier.cancelPermission("sess-1", "req-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(webPush.retractions).toEqual([{ endpoints: [PHONE], tags: [webPush.alerts[0]!.tag] }]);
  });

  it("does not retract a needs-input alert just because the session was read", async () => {
    makeNotifier().scheduleNotification("sess-1", "question", "q", undefined, {
      notificationId: "n-1",
      skipReadCheck: true,
    });
    await vi.advanceTimersByTimeAsync(30_000);

    lastReadAt = Date.now();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(webPush.retractions).toHaveLength(0);
  });

  it("retracts a review alert once the session is read after delivery", async () => {
    makeNotifier().scheduleNotification("sess-1", "completed");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts).toHaveLength(1);

    // Still unread: the periodic check leaves the alert alone.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(webPush.retractions).toHaveLength(0);

    lastReadAt = Date.now();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(webPush.retractions).toEqual([{ endpoints: [PHONE], tags: [webPush.alerts[0]!.tag] }]);
  });

  it("retracts a Notify Me alert once its result is no longer pending", async () => {
    let pending = true;
    makeNotifier().scheduleNotification("sess-1", "monitored-result", "Result", undefined, {
      notificationId: "monitor:q-1:r1",
      monitoredResult: { threadKey: "q-1", isPending: () => pending },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts[0]!.url).toBe("/#/session/sess-1?thread=q-1");

    pending = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(webPush.retractions).toHaveLength(1);
  });

  it("still retracts when the question is answered while the alert is in flight", async () => {
    // The answer can land between handing the alert to the push service and its reply;
    // the retraction must wait for delivery rather than being lost.
    webPush.holdNextAlert = true;
    makeNotifier().scheduleNotification("sess-1", "question", "q", undefined, { notificationId: "n-1" });
    await vi.advanceTimersByTimeAsync(30_000);

    notifier.cancelNotification("sess-1", "n-1");
    await vi.advanceTimersByTimeAsync(0);
    expect(webPush.retractions).toHaveLength(0);

    webPush.release!();
    await vi.advanceTimersByTimeAsync(0);
    expect(webPush.retractions).toEqual([{ endpoints: [PHONE], tags: [webPush.alerts[0]!.tag] }]);
  });

  it("gives every delivered alert its own tag so retraction never hides a different alert", async () => {
    makeNotifier();
    notifier.scheduleNotification("sess-1", "question", "first", undefined, { notificationId: "n-1" });
    await vi.advanceTimersByTimeAsync(30_000);
    // Past the per-session cooldown so the second alert is delivered too.
    await vi.advanceTimersByTimeAsync(60_000);
    notifier.scheduleNotification("sess-1", "question", "second", undefined, { notificationId: "n-2" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts).toHaveLength(2);
    expect(webPush.alerts[0]!.tag).not.toBe(webPush.alerts[1]!.tag);

    notifier.cancelNotification("sess-1", "n-2");
    await vi.advanceTimersByTimeAsync(0);
    expect(webPush.retractions).toEqual([{ endpoints: [PHONE], tags: [webPush.alerts[1]!.tag] }]);
  });
});
