import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { broadcastToBrowsers, type BrowserTransportSessionLike } from "./browser-transport-controller.js";

function sessionWithHistory(messageHistory: BrowserIncomingMessage[]) {
  const socket = {
    data: {
      subscribed: true,
      conversationView: {
        kind: "history" as const,
        request: { fromTurn: 0, turnCount: 30, sectionTurnCount: 10, visibleSectionCount: 3 },
      },
    },
    send: vi.fn(),
  };
  const session = {
    id: "session-1",
    backendType: "codex",
    browserSockets: new Set([socket]),
    messageHistory,
    frozenCount: 0,
    state: { permissionMode: "default" } as BrowserTransportSessionLike["state"],
    nextEventSeq: 1,
    lastAckSeq: 0,
    pendingPermissions: new Map(),
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    taskHistory: [],
    eventBuffer: [],
    lastReadAt: 0,
    attentionReason: null,
    generationStartedAt: null,
    notifications: [],
    attentionRecords: [],
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
  } as BrowserTransportSessionLike;
  return { session, socket };
}

describe("live browser history indices", () => {
  it("adds the authoritative raw index to persisted live events without mutating history", () => {
    // Persisted live events must carry raw chronology to the browser, while the
    // durable history objects remain unchanged for storage and backend replay.
    const user = { type: "user_message", id: "u-1", content: "Early request", timestamp: 1 } as BrowserIncomingMessage;
    const reasoning = {
      type: "codex_reasoning_detail",
      id: "r-1",
      text: "Preparing materials",
      status: "complete",
      timestamp: 2,
      parent_tool_use_id: null,
    } as BrowserIncomingMessage;
    const { session, socket } = sessionWithHistory([user, reasoning]);
    const deps = { eventBufferLimit: 100, persistSession: vi.fn(), recordOutgoingRaw: vi.fn() };

    broadcastToBrowsers(session, user, deps);
    broadcastToBrowsers(session, reasoning, deps);

    expect(JSON.parse(socket.send.mock.calls[0]![0])).toMatchObject({
      type: "user_message",
      id: "u-1",
      history_index: 0,
    });
    expect(JSON.parse(socket.send.mock.calls[1]![0])).toMatchObject({
      type: "codex_reasoning_detail",
      id: "r-1",
      history_index: 1,
    });
    expect(session.eventBuffer.map((event) => event.message.history_index)).toEqual([0, 1]);
    expect(user.history_index).toBeUndefined();
    expect(reasoning.history_index).toBeUndefined();
  });

  it("does not label transient events that are absent from raw history", () => {
    // Transient status events remain post-window live state rather than being
    // misclassified as durable history rows.
    const { session, socket } = sessionWithHistory([]);
    const status = { type: "status_change", status: "running" } as BrowserIncomingMessage;

    broadcastToBrowsers(session, status, {
      eventBufferLimit: 100,
      persistSession: vi.fn(),
      recordOutgoingRaw: vi.fn(),
    });

    expect(JSON.parse(socket.send.mock.calls[0]![0])).not.toHaveProperty("history_index");
  });
});
