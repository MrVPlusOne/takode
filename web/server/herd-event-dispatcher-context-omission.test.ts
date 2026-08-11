import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HerdEventDispatcher, type LauncherHandle, type WsBridgeHandle } from "./herd-event-dispatcher.js";
import type { BrowserIncomingMessage, TakodeEvent } from "./session-types.js";

function userMessage(
  content: string,
  agentSource?: { sessionId: string; sessionLabel?: string },
): BrowserIncomingMessage {
  return {
    type: "user_message",
    content,
    timestamp: Date.now(),
    ...(agentSource ? { agentSource } : {}),
  } as BrowserIncomingMessage;
}

function assistantMessage(text: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: { content: [{ type: "text", text }] },
    timestamp: Date.now(),
  } as BrowserIncomingMessage;
}

function resultMessage(result: string): BrowserIncomingMessage {
  return {
    type: "result",
    data: { result, is_error: false, duration_ms: 1_000 },
  } as BrowserIncomingMessage;
}

describe("HerdEventDispatcher injected-context omission", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bounds the actual leader injection while preserving decisions, routing, dedupe, and raw worker history", () => {
    // Producer-shaped regression for the live screenshot: the worker turn starts
    // with a leader dispatch plus very large structured preload/recovery messages,
    // then ends with the compact worker conclusion the leader actually needs.
    const memoryCatalog = `Memory catalog preloaded\n\n${"memory-entry\n".repeat(3_000)}`;
    const skillPreload = `Required leader skill preloaded: quest\n\n${"skill-body\n".repeat(2_000)}`;
    const recoveryContext = `Context was compacted.\n\n${"recovery-body\n".repeat(1_500)}`;
    const workerHistory: BrowserIncomingMessage[] = [
      userMessage("Work on the assigned quest and preserve decision visibility.", {
        sessionId: "leader-1",
        sessionLabel: "#1 Leader",
      }),
      userMessage(memoryCatalog, {
        sessionId: "system:memory-catalog",
        sessionLabel: "Memory Catalog",
      }),
      userMessage(skillPreload, {
        sessionId: "system:leader-skill-preload:quest",
        sessionLabel: "Required leader skill preloaded: quest",
      }),
      userMessage(recoveryContext, {
        sessionId: "system:compaction-recovery",
        sessionLabel: "Compaction Recovery",
      }),
      userMessage("Unresolved needs-input: choose whether to proceed.", {
        sessionId: "system:needs-input-reminder",
        sessionLabel: "Needs Input Reminder",
      }),
      assistantMessage("Alignment feedback index 0 is ready; no blocker or Journey revision is required."),
      resultMessage("Completed successfully"),
    ];

    const eventCallback: { current?: (event: TakodeEvent) => void } = {};
    const bridge = {
      subscribeTakodeEvents: vi.fn<WsBridgeHandle["subscribeTakodeEvents"]>((sessions, callback) => {
        eventCallback.current = (event) => {
          if (sessions.has(event.sessionId)) callback(event);
        };
        return vi.fn();
      }),
      injectUserMessage: vi.fn<WsBridgeHandle["injectUserMessage"]>(() => "sent"),
      isSessionIdle: vi.fn(() => true),
      wakeIdleKilledSession: vi.fn(() => false),
      getSession: vi.fn<WsBridgeHandle["getSession"]>((sessionId) =>
        sessionId === "worker-1" ? { messageHistory: workerHistory } : undefined,
      ),
      getBoardRow: vi.fn(() => ({ status: "WORKING" })),
      getBoardStallSignature: vi.fn(() => "stall-signature"),
      getBoardDispatchableSignature: vi.fn(() => "dispatchable-signature"),
    } satisfies WsBridgeHandle;
    const launcher: LauncherHandle = {
      getHerdedSessions: vi.fn(() => [{ sessionId: "worker-1" }]),
      getSession: vi.fn(() => ({ claimedQuestId: "q-1848" })),
    };
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("leader-1");

    const turnEnd = {
      id: 1,
      event: "turn_end",
      sessionId: "worker-1",
      sessionNum: 2495,
      sessionName: "Alignment worker",
      ts: Date.now(),
      data: {
        duration_ms: 77_000,
        reason: "result",
        msgRange: { from: 0, to: workerHistory.length - 1 },
        userMsgs: { count: 5, ids: [0, 1, 2, 3, 4] },
        questId: "q-1848",
        threadKey: "q-1848",
      },
    } as TakodeEvent;
    const needsInput = {
      id: 2,
      event: "notification_needs_input",
      sessionId: "worker-1",
      sessionNum: 2495,
      sessionName: "Alignment worker",
      ts: Date.now(),
      data: {
        notificationId: "n-1",
        summary: "Choose whether to proceed",
        msg_index: 4,
        questId: "q-1848",
      },
    } as TakodeEvent;

    eventCallback.current?.(turnEnd);
    eventCallback.current?.(needsInput);
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const [leaderId, injectedContent, agentSource, snapshot, route] = vi.mocked(bridge.injectUserMessage).mock.calls[0];
    expect(leaderId).toBe("leader-1");
    expect(agentSource).toEqual({ sessionId: "herd-events", sessionLabel: "Herd Events" });
    expect(route).toMatchObject({ threadKey: "q-1848", questId: "q-1848" });
    expect(snapshot?.eventKeys).toHaveLength(2);

    expect(injectedContent.length).toBeLessThan(1_500);
    expect(injectedContent).toContain("injected context omitted from herd summary");
    expect(injectedContent).toContain("Memory Catalog");
    expect(injectedContent).toContain("Required leader skill preloaded: quest");
    expect(injectedContent).toContain("Compaction Recovery");
    expect(injectedContent).not.toContain("memory-entry");
    expect(injectedContent).not.toContain("skill-body");
    expect(injectedContent).not.toContain("recovery-body");
    expect(injectedContent).toContain("Alignment feedback index 0 is ready");
    expect(injectedContent).toContain("notification_needs_input");
    expect(injectedContent).toContain("Choose whether to proceed");

    // The formatter only changes the leader delivery projection. Deliberate
    // inspection through read/peek still sees the complete worker-session body.
    expect((workerHistory[1] as Extract<BrowserIncomingMessage, { type: "user_message" }>).content).toBe(memoryCatalog);
    expect((workerHistory[2] as Extract<BrowserIncomingMessage, { type: "user_message" }>).content).toBe(skillPreload);
    expect((workerHistory[3] as Extract<BrowserIncomingMessage, { type: "user_message" }>).content).toBe(
      recoveryContext,
    );

    dispatcher.onOrchestratorTurnEnd("leader-1");
    eventCallback.current?.({ ...turnEnd, id: 3, ts: turnEnd.ts + 1_000 });
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });
});
