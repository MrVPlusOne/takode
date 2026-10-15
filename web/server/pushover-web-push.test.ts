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

  // A bare session link reopens whichever tab the app last showed, so an alert from a
  // leader thread must name that thread, Main included, for the tap to land on it.
  it("links a needs-input alert to the thread it came from, naming Main explicitly", async () => {
    makeNotifier().scheduleNotification("sess-1", "question", "Main question", undefined, {
      notificationId: "n-1",
      threadKey: "main",
    });
    await vi.advanceTimersByTimeAsync(30_000);
    makeNotifier().scheduleNotification("sess-2", "completed", "Quest done", undefined, { threadKey: "q-7" });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(webPush.alerts.map((alert) => alert.url)).toEqual([
      "/#/session/sess-1?thread=main",
      "/#/session/sess-2?thread=q-7",
    ]);
  });

  it("links a batched alert to the oldest question still waiting", async () => {
    makeNotifier();
    notifier.scheduleNotification("sess-1", "question", "First", undefined, {
      notificationId: "n-1",
      threadKey: "q-1",
    });
    notifier.scheduleNotification("sess-1", "question", "Second", undefined, {
      notificationId: "n-2",
      threadKey: "q-2",
    });
    // The first question is answered before the batch fires: the link follows the one still waiting.
    notifier.cancelNotification("sess-1", "n-1");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(webPush.alerts).toHaveLength(1);
    expect(webPush.alerts[0]!.url).toBe("/#/session/sess-1?thread=q-2");
  });

  // Follow-up reminders summarize every waiting question, so they skip the per-session delay and filters
  // and go straight to both channels, linking to the attention list. Fetch is stubbed: nothing leaves the test.
  it("sends a reminder at once to Web Push and Pushover", async () => {
    makeNotifier({
      getSettings: () => ({
        pushoverUserKey: "user",
        pushoverApiToken: "token",
        pushoverDelaySeconds: 30,
        pushoverEnabled: true,
      }),
      getBaseUrl: () => "https://takode.example/",
    });
    await notifier.sendReminder({
      title: "2 questions waiting for you (oldest 3h)",
      body: "A, B",
      path: "/#/attention",
    });

    expect(webPush.alerts).toEqual([
      { title: "2 questions waiting for you (oldest 3h)", body: "A, B", url: "/#/attention" },
    ]);
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(PUSHOVER_API_URL);
    const body = init!.body as URLSearchParams;
    expect(body.get("title")).toBe("2 questions waiting for you (oldest 3h)");
    expect(body.get("message")).toBe("A, B");
    expect(body.get("url")).toBe("https://takode.example/#/attention");
    expect(body.get("html")).toBe("0");
  });
});
