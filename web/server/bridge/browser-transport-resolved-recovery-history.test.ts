import { describe, expect, it, vi } from "vitest";
import { computeHistoryMessagesSyncHash, computeHistoryPrefixSyncHash } from "../../shared/history-sync-hash.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { isRootAgentHistoryMessage } from "../root-agent-feed-message.js";
import {
  sendHistorySync,
  sendHistoryWindowSync,
  type BrowserTransportSessionLike,
} from "./browser-transport-controller.js";

function user(id: string, content: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp, threadKey: "main" };
}

function assistant(id: string, content: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.6-sol",
      content: [{ type: "text", text: content }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    threadKey: "main",
  };
}

function successResult(id: string): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      session_id: "session",
      uuid: id,
      stop_reason: "completed",
    },
    threadKey: "main",
  };
}

function diagnostic(resolved = false): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: "recovery-diagnostic",
    content: "Review the interrupted work.",
    timestamp: 3,
    threadKey: "main",
    agentSource: { sessionId: "system:codex-leader-recovery-diagnostic" },
    codexTurnRecoveryId: "owner",
    ...(resolved ? { codexTurnRecoveryResolvedAt: 4 } : {}),
  };
}

function session(messageHistory: BrowserIncomingMessage[]): BrowserTransportSessionLike {
  return {
    id: "resolved-recovery-history",
    backendType: "codex",
    browserSockets: new Set(),
    messageHistory,
    frozenCount: messageHistory.length,
    state: {} as any,
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
  };
}

function historySyncMessages(payload: any): BrowserIncomingMessage[] {
  return [...payload.frozen_delta, ...payload.hot_messages];
}

function directMessageIds(messages: BrowserIncomingMessage[]): Array<string | undefined> {
  return messages.map((message) => (message as { id?: string }).id);
}

describe("resolved Codex recovery diagnostic history projection", () => {
  it("removes the resolved row from bounded history windows with stable absolute indexes and a fresh cache hash", () => {
    const unresolved = diagnostic();
    const history = [
      user("owner", "Start work", 1),
      assistant("partial", "Partial response"),
      unresolved,
      successResult("result-owner"),
      user("follow-up", "Continue", 5),
      assistant("complete", "Finished"),
      successResult("result-follow-up"),
    ];
    const socket = { send: vi.fn() };
    const options = { fromTurn: 0, turnCount: 2, sectionTurnCount: 1, visibleSectionCount: 2 };

    sendHistoryWindowSync({ messageHistory: history }, socket, options);
    const first = JSON.parse(String(socket.send.mock.calls[0]?.[0]));
    expect(first.messages.some((message: any) => message.id === "recovery-diagnostic")).toBe(true);

    if (unresolved.type !== "user_message") throw new Error("expected user diagnostic");
    unresolved.codexTurnRecoveryResolvedAt = 4;
    socket.send.mockClear();
    sendHistoryWindowSync({ messageHistory: history }, socket, {
      ...options,
      cachedWindowHash: first.window.window_hash,
    });

    const resolved = JSON.parse(String(socket.send.mock.calls[0]?.[0]));
    expect(resolved.cache_hit).toBeUndefined();
    expect(resolved.window.window_hash).not.toBe(first.window.window_hash);
    expect(resolved.messages.some((message: any) => message.id === "recovery-diagnostic")).toBe(false);
    expect(resolved.messages.find((message: any) => message.id === "follow-up")?.history_index).toBe(4);
    expect(resolved.window.start_index).toBe(0);
  });

  it("omits the resolved row from a full history sync while retaining later raw indexes", async () => {
    const first = user("first", "First", 1);
    const second = user("second", "Second", 5);
    const history = [first, diagnostic(true), second];
    const socket = { data: { sessionId: "resolved-recovery-history" }, send: vi.fn((_raw: string) => 1) };

    await sendHistorySync(session(history), socket, 0, undefined);

    const payload = socket.send.mock.calls
      .map(([raw]) => JSON.parse(String(raw)))
      .find((item) => item.type === "history_sync");
    expect(payload.frozen_base_count).toBe(0);
    expect(directMessageIds(historySyncMessages(payload))).toEqual(["first", "second"]);
    expect(historySyncMessages(payload)[1]).toMatchObject({ id: "second", history_index: 2 });
    const projectedHash = computeHistoryMessagesSyncHash(history, 0, {
      suppressRootThinkingOnlyAssistant: true,
      includeMessage: isRootAgentHistoryMessage,
    });
    expect(payload.expected_frozen_hash).toBe(projectedHash.hash);
    expect(payload.expected_full_hash).toBe(projectedHash.hash);
  });

  it("rejects a cached frozen prefix that still counted the newly resolved row", async () => {
    const first = user("first", "First", 1);
    const unresolved = diagnostic();
    const second = user("second", "Second", 5);
    const history = [first, unresolved, second];
    const oldPrefix = computeHistoryPrefixSyncHash(history, 2, 0, {
      suppressRootThinkingOnlyAssistant: true,
      includeMessage: isRootAgentHistoryMessage,
    });
    if (unresolved.type !== "user_message") throw new Error("expected user diagnostic");
    unresolved.codexTurnRecoveryResolvedAt = 4;
    const socket = { data: { sessionId: "resolved-recovery-history" }, send: vi.fn((_raw: string) => 1) };

    await sendHistorySync(session(history), socket, 2, oldPrefix.hash);

    const payloads = socket.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ type: "history_sync", frozen_base_count: 0 });
    expect(directMessageIds(historySyncMessages(payloads[0]))).toEqual(["first", "second"]);
    expect(historySyncMessages(payloads[0])[1]).toMatchObject({ id: "second", history_index: 2 });
  });
});
