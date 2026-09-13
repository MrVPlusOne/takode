import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushoverNotifier, type PushoverSettings } from "./pushover.js";
import { WsBridge } from "./ws-bridge.js";
import { getClaudeMessageHandlers, getCodexAdapterBrowserMessageDeps } from "./ws-bridge-deps.js";
import { handleCodexAdapterBrowserMessage } from "./bridge/codex-adapter-browser-message-controller.js";
import { registerThreadMonitoringRoutes } from "./routes/thread-monitoring.js";
import type { RouteContext } from "./routes/context.js";
import type { CLIAssistantMessage, CLIResultMessage } from "./session-types.js";
import { clearAttentionAndMarkRead } from "./bridge/session-notification-controller.js";
import { setThreadMonitoring } from "./thread-monitoring.js";
import { registerTakodeNotificationResponseRoute } from "./routes/takode-notification-response.js";

// Exercise real result acceptance, production bridge wiring, monitoring routes and
// the delayed scheduler. All state is in memory and every HTTP delivery is mocked.
const notifiers: PushoverNotifier[] = [];

function fixture(backend: "claude" | "codex" = "claude") {
  const bridge = new WsBridge();
  const session = bridge.getOrCreateSession("synthetic-leader", backend);
  session.state.isOrchestrator = true;
  session.lastActivityPreview = "Unrelated private work in another thread";
  const launcherInfo = { sessionId: session.id, isOrchestrator: true, archived: false };
  bridge.launcher = { getSession: () => launcherInfo, touchActivity: vi.fn() } as unknown as WsBridge["launcher"];
  vi.spyOn(bridge as any, "refreshGitInfoThenRecomputeDiff").mockResolvedValue(undefined);
  const settings: PushoverSettings = {
    pushoverEnabled: true,
    pushoverApiToken: "synthetic-token",
    pushoverUserKey: "synthetic-user",
    pushoverDelaySeconds: 30,
    pushoverEventFilters: { needsInput: true, review: true, error: true },
  };
  const notifier = new PushoverNotifier({
    getSettings: () => settings,
    getBaseUrl: () => "https://example.test/",
    getServerName: () => "Test server",
    getSessionName: () => "Research",
    getSessionActivity: () => session.lastActivityPreview,
    getLastReadAt: () => session.lastReadAt,
  });
  notifiers.push(notifier);
  bridge.pushoverNotifier = notifier;
  const handlers = getClaudeMessageHandlers(bridge);
  const app = new Hono();
  const context = {
    wsBridge: bridge,
    launcher: bridge.launcher,
    resolveId: (id: string) => id,
  } as unknown as RouteContext;
  registerThreadMonitoringRoutes(app, context);
  registerTakodeNotificationResponseRoute(app, context, {
    persistSession: () => bridge.persistSessionById(session.id),
    cancelScheduledNotification: (id, notificationId) => notifier.cancelNotification(id, notificationId),
  });
  const act = (threadKey: string, action: string, resultId?: string) =>
    app.request(`/sessions/${session.id}/thread-monitoring/${threadKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, resultId }),
    });
  let sequence = 0;
  const publish = async (threadKey = "q-42", kind = "Ready", interrupted = false) => {
    const id = `assistant-${++sequence}`;
    const assistant: CLIAssistantMessage = {
      type: "assistant",
      uuid: id,
      session_id: session.id,
      parent_tool_use_id: null,
      message: {
        id,
        type: "message",
        role: "assistant",
        model: "test-model",
        content: [
          {
            type: "text",
            text: `[thread:${threadKey}:C]\nResult <ready> & complete\n{[(Thread ${kind}: ${threadKey} | Result <ready> & complete)]}`,
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    if (backend === "codex") {
      await handleCodexAdapterBrowserMessage(session, assistant, getCodexAdapterBrowserMessageDeps(bridge));
    } else {
      handlers.handleAssistantMessage(session, assistant);
    }
    expect(fetch).not.toHaveBeenCalled();
    const result: CLIResultMessage = {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: interrupted ? "interrupted" : "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: `result-${sequence}`,
      session_id: session.id,
    };
    if (backend === "codex") {
      await handleCodexAdapterBrowserMessage(
        session,
        { type: "result", data: result },
        getCodexAdapterBrowserMessageDeps(bridge),
      );
    } else {
      handlers.handleResultMessage(session, result);
    }
    return { assistant, result };
  };
  return { bridge, session, notifier, settings, handlers, publish, act, app, launcherInfo };
}

function bodies() {
  return vi.mocked(fetch).mock.calls.map((call) => call[1]!.body as URLSearchParams);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
});

afterEach(() => {
  for (const notifier of notifiers.splice(0)) notifier.destroy();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Notify Me result to Pushover", () => {
  it.each([
    "claude",
    "codex",
  ] as const)("sends one scoped %s result after the delay despite viewing", async (backend) => {
    const { session, publish, handlers } = fixture(backend);
    setThreadMonitoring(session, "q-42", true);
    const { assistant, result } = await publish();
    expect(session.state.threadMonitoring?.threads["q-42"].pending).toMatchObject({ messageId: "assistant-1" });
    // Duplicate completed-turn transport cannot restart the delay or create another alert.
    handlers.handleAssistantMessage(session, assistant);
    handlers.handleResultMessage(session, result);
    clearAttentionAndMarkRead(session, { persistSession: () => {} });
    session.state.leaderOpenThreadTabs = undefined;
    await vi.advanceTimersByTimeAsync(29_999);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [body] = bodies();
    expect(body.get("title")).toBe("Notify Me result");
    expect(body.get("message")).toBe("Test server — Research\nq-42\nResult <ready> & complete");
    expect(body.get("html")).toBe("0");
    expect(body.get("url")).toBe("https://example.test/#/session/synthetic-leader?thread=q-42");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["acknowledge", "untrack"])("%s retires only the matching result before delivery", async (action) => {
    const { session, publish, act } = fixture();
    setThreadMonitoring(session, "q-42", true);
    setThreadMonitoring(session, "q-43", true);
    await publish();
    await publish("q-43");
    const resultId = session.state.threadMonitoring!.threads["q-42"].pending!.id;
    expect((await act("q-42", action, resultId)).status).toBe(200);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].get("url")).toContain("thread=q-43");
    expect(session.state.threadMonitoring!.threads["q-43"].pending).not.toBeNull();
  });

  it("keeps an unrelated delayed needs-input push when a monitored result is acknowledged", async () => {
    const { session, notifier, publish, act } = fixture();
    setThreadMonitoring(session, "q-42", true);
    await publish();
    notifier.scheduleNotification(session.id, "question", "A separate question", undefined, {
      notificationId: "n-1",
      skipReadCheck: true,
    });
    await act("q-42", "acknowledge", session.state.threadMonitoring!.threads["q-42"].pending!.id);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(bodies()).toHaveLength(1);
    expect(bodies()[0].get("title")).toBe("Takode needs input");
    expect(bodies()[0].get("message")).toContain("A separate question");
  });

  it.each([
    "sent",
    "queued",
    "no_session",
  ] as const)("rechecks monitoring after a %s reply through the notification route", async (delivery) => {
    // Accepted input clears the observed result; rejected delivery rolls back the
    // prompt and leaves both independently owned delayed alerts eligible.
    const { bridge, session, publish, app } = fixture();
    setThreadMonitoring(session, "q-42", true);
    await publish();
    const resultId = session.state.threadMonitoring!.threads["q-42"].pending!.id;
    session.notifications.push({
      id: "n-reply",
      category: "needs-input",
      threadKey: "q-42",
      timestamp: Date.now(),
      messageId: null,
      done: false,
    });
    vi.spyOn(bridge, "injectUserMessage").mockReturnValue(delivery);
    const response = await app.request(`/sessions/${session.id}/notifications/n-reply/response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Continue", threadMonitorResultId: resultId }),
    });
    expect(response.status).toBe(delivery === "no_session" ? 503 : 200);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(delivery === "no_session" ? 1 : 0);
  });

  it.each(["filter", "archive", "removed"])("revalidates pending delivery after %s changes", async (change) => {
    const { session, settings, publish, launcherInfo, bridge } = fixture();
    setThreadMonitoring(session, "q-42", true);
    await publish();
    if (change === "filter") settings.pushoverEventFilters!.review = false;
    if (change === "archive") launcherInfo.archived = true;
    if (change === "removed") (bridge as any).sessions.delete(session.id);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains the in-app result after a failed external delivery without retrying it", async () => {
    const { session, publish } = fixture();
    setThreadMonitoring(session, "q-42", true);
    await publish();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("synthetic network failure"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("synthetic network failure"));
    expect(session.state.threadMonitoring!.threads["q-42"].pending).not.toBeNull();
  });

  it("keeps a newer result through stale acknowledgement and replaces only its thread's delayed item", async () => {
    const { session, publish, act } = fixture();
    setThreadMonitoring(session, "q-42", true);
    await publish();
    const oldId = session.state.threadMonitoring!.threads["q-42"].pending!.id;
    await vi.advanceTimersByTimeAsync(10_000);
    await publish();
    expect(await (await act("q-42", "acknowledge", oldId)).json()).toMatchObject({ changed: false });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const currentId = session.state.threadMonitoring!.threads["q-42"].pending!.id;
    await act("q-42", "acknowledge", currentId);
    await vi.advanceTimersByTimeAsync(60_000);
    vi.mocked(fetch).mockClear();
    await publish();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "untracked",
    "waiting",
    "interrupted",
    "needs-input",
    "disabled",
    "review-filter",
    "credentials",
  ])("does not send for %s", async (condition) => {
    const { session, settings, publish } = fixture();
    if (condition !== "untracked") setThreadMonitoring(session, "q-42", true);
    if (condition === "needs-input")
      session.notifications.push({
        id: "n-1",
        category: "needs-input",
        threadKey: "q-42",
        timestamp: Date.now(),
        messageId: null,
        done: false,
      });
    if (condition === "disabled") settings.pushoverEnabled = false;
    if (condition === "review-filter") settings.pushoverEventFilters!.review = false;
    if (condition === "credentials") settings.pushoverApiToken = "";
    await publish("q-42", condition === "waiting" ? "Waiting" : "Ready", condition === "interrupted");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not backfill existing results when tracking or restoring persisted state", async () => {
    const { session, publish, bridge } = fixture();
    await publish();
    setThreadMonitoring(session, "q-42", true);
    expect(session.state.threadMonitoring!.threads["q-42"].pending).not.toBeNull();
    session.state.threadMonitoring = structuredClone(session.state.threadMonitoring);
    bridge.persistSessionById(session.id);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetch).not.toHaveBeenCalled();
  });
});
