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

  it("indexes a reply that begins with signed thinking like any other reply", () => {
    // Browsers take a live message without an index as new, after the window they hold. The
    // signature is stripped by copying the reply, which once came before the index was looked
    // up by identity, so every reply that began with thinking went out without one and showed
    // at the end of a side pane's feed.
    const reply = {
      type: "assistant",
      message: {
        id: "msg-thinking",
        type: "message",
        role: "assistant",
        model: "claude-opus",
        content: [
          { type: "thinking", thinking: "plan", signature: "sig" },
          { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } },
        ],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 2,
    } as BrowserIncomingMessage;
    const user = { type: "user_message", id: "u-1", content: "Early request", timestamp: 1 } as BrowserIncomingMessage;
    const { session, socket } = sessionWithHistory([user, reply]);

    broadcastToBrowsers(session, reply, { eventBufferLimit: 100, persistSession: vi.fn(), recordOutgoingRaw: vi.fn() });

    const sent = JSON.parse(socket.send.mock.calls[0]![0]);
    expect(sent).toMatchObject({ type: "assistant", history_index: 1 });
    expect(sent.message.content[0]).not.toHaveProperty("signature");
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
