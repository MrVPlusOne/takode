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
      monitoredResult: { threadKey: "q-1", resultId: "r1", isPending: () => true },
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(webPush.alerts[0]!.url).toBe("/#/session/sess-1?thread=q-1");
  });

  // Each alert names what it is about, so tapping any later alert can close it once that
  // is settled (phone-alert-status.ts judges the subjects). A batch names every item still
  // in it; an alert with nothing to answer is settled by reading the session after it.
  describe("alert subjects", () => {
    it("names each question and permission request still in the batch", async () => {
      makeNotifier();
      notifier.scheduleNotification("sess-1", "question", "First", undefined, { notificationId: "n-1" });
      notifier.scheduleNotification("sess-1", "question", "Second", undefined, { notificationId: "n-2" });
      notifier.scheduleNotification("sess-1", "question", "AskUserQuestion", "req-1");
      notifier.cancelNotification("sess-1", "n-1");
      await vi.advanceTimersByTimeAsync(30_000);

      expect(webPush.alerts[0]!.subjects).toEqual([
        { kind: "permission", sessionId: "sess-1", requestId: "req-1" },
        { kind: "question", sessionId: "sess-1", notificationId: "n-2" },
      ]);
    });

    it("names the Notify Me result by thread and result ID", async () => {
      makeNotifier().scheduleNotification("sess-1", "monitored-result", "Result", undefined, {
        notificationId: "monitor:q-1:r1",
        monitoredResult: { threadKey: "q-1", resultId: "r1", isPending: () => true },
      });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(webPush.alerts[0]!.subjects).toEqual([
        { kind: "notify-me", sessionId: "sess-1", threadKey: "q-1", resultId: "r1" },
      ]);
    });

    it("settles a finished-turn alert by a read after the event", async () => {
      makeNotifier();
      const scheduledAt = Date.now();
      notifier.scheduleNotification("sess-1", "completed");
      await vi.advanceTimersByTimeAsync(30_000);

      expect(webPush.alerts[0]!.subjects).toEqual([{ kind: "unread", sessionId: "sess-1", since: scheduledAt }]);
    });

    it("passes a reminder's subjects through", async () => {
      makeNotifier();
      const subjects = [{ kind: "question" as const, sessionId: "sess-1", notificationId: "n-1" }];
      await notifier.sendReminder({ title: "1 question waiting", body: "A", path: "/#/attention", subjects });

      expect(webPush.alerts[0]!.subjects).toEqual(subjects);
    });
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

  // The link names the message too, so the tap scrolls to the question or result like an
  // in-app notification link does, not just to the thread.
  it("links to the message a question or result is anchored to", async () => {
    makeNotifier();
    notifier.scheduleNotification("sess-1", "question", "First", undefined, {
      notificationId: "n-1",
      threadKey: "q-1",
      messageId: "msg-first",
    });
    notifier.scheduleNotification("sess-1", "question", "Second", undefined, {
      notificationId: "n-2",
      threadKey: "q-2",
      messageId: "msg/second",
    });
    // The batch's link follows the question still waiting, thread and message together.
    notifier.cancelNotification("sess-1", "n-1");
    await vi.advanceTimersByTimeAsync(30_000);
    makeNotifier().scheduleNotification("sess-2", "completed", "Answer", undefined, {
      threadKey: "main",
      messageId: "answer-1",
    });
    await vi.advanceTimersByTimeAsync(30_000);

    expect(webPush.alerts.map((alert) => alert.url)).toEqual([
      "/#/session/sess-1/msg/msg%2Fsecond?thread=q-2",
      "/#/session/sess-2/msg/answer-1?thread=main",
    ]);
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
