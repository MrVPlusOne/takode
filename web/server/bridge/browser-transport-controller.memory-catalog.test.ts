import { describe, expect, it, vi } from "vitest";
import {
  handleBrowserIngressMessage,
  injectUserMessage,
  type BrowserTransportSessionLike,
} from "./browser-transport-controller.js";
import { routeBrowserMessage as routeAdapterBrowserMessage } from "./adapter-browser-routing-controller.js";

function makeSession(): BrowserTransportSessionLike {
  return {
    id: "startup-catalog-session",
    backendType: "claude",
    browserSockets: new Set(),
    messageHistory: [],
    frozenCount: 0,
    state: { permissionMode: "default" } as any,
    nextEventSeq: 1,
    lastAckSeq: 0,
    pendingPermissions: new Map(),
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    taskHistory: [],
    eventBuffer: [],
    lastReadAt: Date.now(),
    attentionReason: null,
    generationStartedAt: null,
    notifications: [],
    attentionRecords: [],
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
    pendingStartupMemoryCatalogInjection: true,
  };
}

function makeRoutingDeps(routeBrowserMessage: ReturnType<typeof vi.fn>, routeState: { current?: Promise<void> }) {
  return {
    routeBrowserMessage,
    backendConnected: vi.fn(() => true),
    getLauncherSessionInfo: vi.fn(() => ({ archived: false })),
    idempotentMessageTypes: new Set<string>(),
    processedClientMsgIdLimit: 100,
    persistSession: vi.fn(),
    touchActivity: vi.fn(),
    getRouteChain: vi.fn(() => routeState.current),
    setRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
      routeState.current = route;
    }),
    clearRouteChain: vi.fn((_sessionId: string, route: Promise<void>) => {
      if (routeState.current === route) routeState.current = undefined;
    }),
    notifyImageSendFailure: vi.fn(),
    broadcastError: vi.fn(),
  } as any;
}

describe("startup memory catalog route serialization", () => {
  it("serializes concurrent browser user messages", async () => {
    const session = makeSession();
    const routeState: { current?: Promise<void> } = {};
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const order: string[] = [];
    const routeBrowserMessage = vi.fn(async (_session: BrowserTransportSessionLike, msg: any) => {
      order.push(`start:${msg.content}`);
      if (msg.content === "first") {
        session.pendingStartupMemoryCatalogInjection = false;
        firstStarted();
        await firstGate;
      }
      order.push(`end:${msg.content}`);
    });
    const deps = makeRoutingDeps(routeBrowserMessage, routeState);

    const first = handleBrowserIngressMessage(session, { type: "user_message", content: "first" }, undefined, deps);
    await firstReady;
    const second = handleBrowserIngressMessage(session, { type: "user_message", content: "second" }, undefined, deps);

    expect(routeBrowserMessage).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["start:first"]);
    releaseFirst();
    await Promise.all([first, second]);

    expect(order).toEqual(["start:first", "end:first", "start:second", "end:second"]);
  });

  it("serializes programmatic startup messages and records acceptance after routing", async () => {
    const session = makeSession();
    const routeState: { current?: Promise<void> } = {};
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstReady = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const order: string[] = [];
    const routeBrowserMessage = vi.fn(async (_session: BrowserTransportSessionLike, msg: any) => {
      order.push(`start:${msg.content}`);
      if (msg.content === "first") {
        session.pendingStartupMemoryCatalogInjection = false;
        firstStarted();
        await firstGate;
      }
      order.push(`end:${msg.content}`);
      return true;
    });
    const deps = makeRoutingDeps(routeBrowserMessage, routeState);

    injectUserMessage(session, "first", undefined, undefined, deps, undefined, {
      afterAccepted: () => order.push("accepted:first"),
    });
    await firstReady;
    injectUserMessage(session, "second", undefined, undefined, deps, undefined, {
      afterAccepted: () => order.push("accepted:second"),
    });

    expect(routeBrowserMessage).toHaveBeenCalledTimes(1);
    const drain = routeState.current;
    releaseFirst();
    await drain;

    expect(order).toEqual([
      "start:first",
      "end:first",
      "accepted:first",
      "start:second",
      "end:second",
      "accepted:second",
    ]);
  });

  it("carries a durable outcome-reminder guard through the generic route queue", async () => {
    const session = makeSession();
    const routeState: { current?: Promise<void> } = {};
    let releaseInFlight!: () => void;
    const inFlight = new Promise<void>((resolve) => {
      releaseInFlight = resolve;
    });
    routeState.current = inFlight;
    const afterAccepted = vi.fn();
    const afterRejected = vi.fn();
    const guard = {
      version: 1 as const,
      pendingResponseTargets: [
        {
          threadKey: "main",
          earliestTimestamp: 10,
          pendingAnswerCount: 1,
          pendingAnswerUserMessageIds: ["u1"],
        },
      ],
      missingOutcomeTargets: [],
      missingNeedsInputTargets: [],
    };
    session.messageHistory.push(
      {
        type: "user_message",
        id: "direct-u1",
        content: "Please answer.",
        timestamp: 10,
        threadKey: "main",
        leaderResponseCoverageVersion: 1,
        leaderUserMessageId: "u1",
      } as any,
      {
        type: "assistant",
        message: {
          id: "answer-u1",
          type: "message",
          role: "assistant",
          model: "test",
          content: [{ type: "text", text: "Answered." }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 20,
        threadKey: "main",
        leaderThreadRole: "answer",
        threadAnswer: { version: 2, answerUserMessageIds: ["u1"], observedHistoryLength: 1 },
      } as any,
    );
    session.state.leaderThreadStatuses = {
      main: {
        kind: "ready",
        label: "Thread Ready",
        threadKey: "main",
        summary: "answer complete",
        messageId: "answer-u1",
        timestamp: 20,
        updatedAt: 20,
      },
    };
    const historyLength = session.messageHistory.length;
    const routeBrowserMessage = vi.fn((target: BrowserTransportSessionLike, msg: any) =>
      routeAdapterBrowserMessage(target as any, msg, undefined, {} as any),
    );
    const deps = makeRoutingDeps(routeBrowserMessage, routeState);

    expect(
      injectUserMessage(
        session,
        "queued reminder",
        { sessionId: "system:leader-thread-outcome-reminder" },
        undefined,
        deps,
        { threadKey: "main" } as any,
        { leaderThreadOutcomeReminderGuard: guard, afterAccepted, afterRejected },
      ),
    ).toBe("sent");
    expect(routeBrowserMessage).not.toHaveBeenCalled();

    releaseInFlight();
    await routeState.current;

    expect(routeBrowserMessage).toHaveBeenCalledTimes(1);
    expect(session.messageHistory).toHaveLength(historyLength);
    expect(afterAccepted).not.toHaveBeenCalled();
    expect(afterRejected).toHaveBeenCalledWith("route_rejected");
  });

  it("keeps browser ingress behind a programmatic startup route", async () => {
    const session = makeSession();
    const routeState: { current?: Promise<void> } = {};
    let releaseProgrammatic!: () => void;
    let programmaticStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseProgrammatic = resolve;
    });
    const firstReady = new Promise<void>((resolve) => {
      programmaticStarted = resolve;
    });
    const order: string[] = [];
    const routeBrowserMessage = vi.fn(async (_session: BrowserTransportSessionLike, msg: any) => {
      order.push(`start:${msg.content}`);
      if (msg.content === "programmatic") {
        session.pendingStartupMemoryCatalogInjection = false;
        programmaticStarted();
        await firstGate;
      }
      order.push(`end:${msg.content}`);
      return true;
    });
    const deps = makeRoutingDeps(routeBrowserMessage, routeState);

    injectUserMessage(session, "programmatic", undefined, undefined, deps);
    await firstReady;
    const browser = handleBrowserIngressMessage(session, { type: "user_message", content: "browser" }, undefined, deps);

    expect(routeBrowserMessage).toHaveBeenCalledTimes(1);
    releaseProgrammatic();
    await browser;
    expect(order).toEqual(["start:programmatic", "end:programmatic", "start:browser", "end:browser"]);
  });

  it("does not run programmatic acceptance callbacks for rejected routes", async () => {
    const session = makeSession();
    const routeState: { current?: Promise<void> } = {};
    const afterAccepted = vi.fn();
    const afterRejected = vi.fn();
    const deps = makeRoutingDeps(
      vi.fn(async () => false),
      routeState,
    );

    injectUserMessage(session, "rejected", undefined, undefined, deps, undefined, { afterAccepted, afterRejected });
    await routeState.current;
    expect(afterAccepted).not.toHaveBeenCalled();
    expect(afterRejected).toHaveBeenCalledWith("route_rejected");
  });
});
