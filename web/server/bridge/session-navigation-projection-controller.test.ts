import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";
import {
  captureSessionNavigationLauncherActivity,
  captureSessionNavigationSourceMessage,
  getSessionNavigationLastActivityAt,
  resolveSessionNavigationStatus,
} from "./session-navigation-projection-controller.js";

function makeSession(): Session {
  return {
    id: "session-1",
    backendType: "claude",
    state: { is_compacting: false } as Session["state"],
    messageHistory: [],
    browserSockets: new Set(),
    pendingPermissions: new Map(),
    isGenerating: false,
  } as unknown as Session;
}

describe("session navigation projection sources", () => {
  it("keeps live generation authority ahead of stale idle producer status", () => {
    const session = makeSession();
    captureSessionNavigationSourceMessage(session, { type: "status_change", status: "idle" });

    expect(resolveSessionNavigationStatus(session, "running")).toBe("running");
  });

  it("keeps live compacting and reverting authority ahead of stale producer status", () => {
    const session = makeSession();
    captureSessionNavigationSourceMessage(session, { type: "status_change", status: "idle" });

    expect(resolveSessionNavigationStatus(session, "compacting")).toBe("compacting");
    expect(resolveSessionNavigationStatus(session, "reverting")).toBe("reverting");
  });

  it("uses producer status only when current server lifecycle is idle", () => {
    const session = makeSession();
    expect(resolveSessionNavigationStatus(session, "idle")).toBe("idle");

    captureSessionNavigationSourceMessage(session, { type: "status_change", status: "reverting" });
    expect(resolveSessionNavigationStatus(session, "idle")).toBe("reverting");

    captureSessionNavigationSourceMessage(session, { type: "status_change", status: null });
    expect(resolveSessionNavigationStatus(session, "idle")).toBeNull();

    captureSessionNavigationSourceMessage(session, { type: "backend_disconnected" });
    expect(resolveSessionNavigationStatus(session, null)).toBeNull();
  });

  it("keeps launcher activity stable between explicitly captured publish buckets", () => {
    const session = makeSession();

    expect(getSessionNavigationLastActivityAt(session, 10)).toBe(10);
    expect(getSessionNavigationLastActivityAt(session, 20)).toBe(10);
    expect(captureSessionNavigationLauncherActivity(session, 20)).toBe(false);
    expect(getSessionNavigationLastActivityAt(session, 20)).toBe(10);

    expect(captureSessionNavigationLauncherActivity(session, 1_020)).toBe(true);
    expect(getSessionNavigationLastActivityAt(session, 1_020)).toBe(1_020);
  });

  it("invalidates every direct navigation authority and ignores unrelated messages", () => {
    const session = makeSession();
    const sources: BrowserIncomingMessage[] = [
      { type: "session_name_update", name: "Renamed" },
      { type: "timer_update", timers: [] },
      { type: "session_update", session: { model: "new-model" } },
      { type: "session_quest_claimed", quest: null },
      { type: "permission_cancelled", request_id: "p-1" },
      { type: "user_message", content: "hello", timestamp: 1, id: "u-1" },
      { type: "result", data: {} } as unknown as BrowserIncomingMessage,
    ];
    for (const source of sources) expect(captureSessionNavigationSourceMessage(session, source)).toBe(true);
    expect(
      captureSessionNavigationSourceMessage(session, {
        type: "session_task_history",
        tasks: [],
      } as unknown as BrowserIncomingMessage),
    ).toBe(false);
  });
});

describe("session activity projection ownership", () => {
  it("routes status and permission changes through the navigation projection", () => {
    const session = makeSession();

    expect(captureSessionNavigationSourceMessage(session, { type: "status_change", status: "running" })).toBe(true);
    expect(session.navigationProducerStatus).toBe("running");
    expect(
      captureSessionNavigationSourceMessage(session, {
        type: "permission_request",
        request: { request_id: "p-1", tool_name: "Bash", input: {}, timestamp: 1 },
      } as BrowserIncomingMessage),
    ).toBe(true);
  });
});
