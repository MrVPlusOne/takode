import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "../session-types.js";
import { handleBrowserIngressMessage } from "./browser-transport-controller.js";
import { handleCodexPendingInputAction } from "./codex-pending-input-actions.js";

function socket() {
  return { send: vi.fn(), readyState: 1, data: {} } as any;
}

function browserEvents(target: ReturnType<typeof socket>): BrowserIncomingMessage[] {
  return target.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
}

function pausedState() {
  return {
    family: "model_backend_stream_error" as const,
    fingerprint: "model_backend_stream_error:responses",
    streak: 3,
    threshold: 3,
    pausedAt: 123,
    lastError: "Model backend stream disconnected before completion.",
    lastErrorAt: 123,
    lastSourceKind: "automatic" as const,
    totalMatchingErrors: 3,
    heldInputs: [],
  };
}

describe("Codex auto-pause explicit release browser ingress", () => {
  it("dedupes the action and fans server-authored progress only to the selected session", async () => {
    const firstBrowser = socket();
    const secondBrowser = socket();
    const otherBrowser = socket();
    const session = {
      id: "release-session",
      backendType: "codex",
      state: { cwd: "/repo", codex_result_error_auto_pause: pausedState() },
      browserSockets: new Set([firstBrowser, secondBrowser]),
      messageHistory: [],
      frozenCount: 0,
      pendingPermissions: new Map(),
      pendingCodexInputs: [],
      pendingCodexTurns: [],
      taskHistory: [],
      eventBuffer: [],
      nextEventSeq: 1,
      lastAckSeq: 0,
      processedClientMessageIds: [],
      processedClientMessageIdSet: new Set<string>(),
      notifications: [],
      attentionRecords: [],
    } as any;
    const otherSession = {
      ...session,
      id: "other-release-session",
      state: { cwd: "/repo", codex_result_error_auto_pause: pausedState() },
      browserSockets: new Set([otherBrowser]),
      processedClientMessageIds: [],
      processedClientMessageIdSet: new Set<string>(),
    } as any;
    let finishRelease!: () => void;
    const releaseBarrier = new Promise<void>((resolve) => {
      finishRelease = resolve;
    });
    const broadcastToBrowsers = (target: typeof session, message: BrowserIncomingMessage) => {
      for (const targetSocket of target.browserSockets) targetSocket.send(JSON.stringify(message));
    };
    const releaseCodexAutoPausedInputs = vi.fn(async (target: typeof session, pausedAt: number) => {
      const pause = target.state.codex_result_error_auto_pause;
      if (!pause || pause.pausedAt !== pausedAt) return "stale" as const;
      if (pause.releaseProgress?.status === "releasing") return "in_progress" as const;
      pause.releaseProgress = { status: "releasing", acceptedAt: 200 };
      broadcastToBrowsers(target, {
        type: "session_update",
        session: { codex_result_error_auto_pause: pause },
      });
      await releaseBarrier;
      target.state.codex_result_error_auto_pause = null;
      broadcastToBrowsers(target, {
        type: "session_update",
        session: { codex_result_error_auto_pause: null },
      });
      return "accepted" as const;
    });
    const routeChains = new Map<string, Promise<void>>();
    const actionDeps = {
      broadcastToBrowsers,
      persistSession: vi.fn(),
      releaseCodexAutoPausedInputs,
    } as any;
    const ingressDeps = {
      getLauncherSessionInfo: () => ({ archived: false }),
      idempotentMessageTypes: new Set(["release_codex_auto_paused_inputs"]),
      processedClientMsgIdLimit: 20,
      persistSession: vi.fn(),
      getRouteChain: (sessionId: string) => routeChains.get(sessionId),
      setRouteChain: (sessionId: string, task: Promise<void>) => {
        routeChains.set(sessionId, task);
      },
      routeBrowserMessage: async (target: typeof session, message: BrowserOutgoingMessage, ws: unknown) => {
        expect(handleCodexPendingInputAction(target, message, ws, actionDeps)).toBe(true);
      },
    } as any;
    const releaseMessage: BrowserOutgoingMessage = {
      type: "release_codex_auto_paused_inputs",
      pausedAt: 123,
      client_msg_id: "release-current-epoch",
    };

    await handleBrowserIngressMessage(session, releaseMessage, firstBrowser, ingressDeps);

    expect(releaseCodexAutoPausedInputs).toHaveBeenCalledTimes(1);
    for (const target of [firstBrowser, secondBrowser]) {
      expect(browserEvents(target)).toContainEqual(
        expect.objectContaining({
          type: "session_update",
          session: expect.objectContaining({
            codex_result_error_auto_pause: expect.objectContaining({
              releaseProgress: { status: "releasing", acceptedAt: 200 },
            }),
          }),
        }),
      );
    }
    expect(otherSession.state.codex_result_error_auto_pause).toMatchObject({ pausedAt: 123 });
    expect(otherBrowser.send).not.toHaveBeenCalled();

    await handleBrowserIngressMessage(session, releaseMessage, firstBrowser, ingressDeps);
    expect(releaseCodexAutoPausedInputs).toHaveBeenCalledTimes(1);
    expect(session.processedClientMessageIds).toEqual(["release-current-epoch"]);

    await handleBrowserIngressMessage(
      session,
      { type: "release_codex_auto_paused_inputs", pausedAt: 999, client_msg_id: "release-stale-epoch" },
      firstBrowser,
      ingressDeps,
    );
    expect(releaseCodexAutoPausedInputs).toHaveBeenCalledTimes(2);
    expect(session.state.codex_result_error_auto_pause).toMatchObject({ pausedAt: 123 });

    finishRelease();
    await releaseBarrier;
    await Promise.resolve();
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    for (const target of [firstBrowser, secondBrowser]) {
      expect(browserEvents(target)).toContainEqual({
        type: "session_update",
        session: { codex_result_error_auto_pause: null },
      });
    }
  });
});
