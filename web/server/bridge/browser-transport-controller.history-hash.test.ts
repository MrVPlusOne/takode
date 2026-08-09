import { describe, expect, it, vi } from "vitest";
import { computeHistoryMessagesSyncHash, computeHistoryPrefixSyncHash } from "../../shared/history-sync-hash.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { sendHistorySync, type BrowserTransportSessionLike } from "./browser-transport-controller.js";

const rootThinkingEntry = {
  type: "assistant",
  timestamp: 10,
  parent_tool_use_id: null,
  message: {
    id: "root-thinking",
    type: "message",
    role: "assistant",
    model: "provider-model",
    content: [{ type: "thinking", thinking: "Root reasoning" }],
    stop_reason: null,
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  },
} as BrowserIncomingMessage;

function makeSession(
  backendType: "claude" | "codex",
  messageHistory: BrowserIncomingMessage[] = [rootThinkingEntry],
): BrowserTransportSessionLike {
  return {
    id: "history-hash-session",
    backendType,
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
    lastReadAt: Date.now(),
    attentionReason: null,
    generationStartedAt: null,
    notifications: [],
    attentionRecords: [],
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
  };
}

describe("backend-aware history hashes", () => {
  it("excludes root thinking-only entries from Codex reconnect hashes", async () => {
    // Codex browsers suppress this row, so the server's rendered-prefix hash must suppress it too.
    const ws = { send: vi.fn() };
    await sendHistorySync(makeSession("codex"), ws, 0, undefined);

    const sync = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).find((msg) => msg.type === "history_sync");
    expect(sync.expected_frozen_hash).toBe(
      computeHistoryMessagesSyncHash([rootThinkingEntry], 0, { suppressRootThinkingOnlyAssistant: true }).hash,
    );
  });

  it("includes root thinking-only entries in Claude reconnect hashes", async () => {
    // Claude keeps root thinking visible, so reconnect hashing must retain the same rendered row.
    const ws = { send: vi.fn() };
    await sendHistorySync(makeSession("claude"), ws, 0, undefined);

    const sync = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).find((msg) => msg.type === "history_sync");
    expect(sync.expected_frozen_hash).toBe(computeHistoryMessagesSyncHash([rootThinkingEntry]).hash);
  });

  it("slices Codex frozen deltas at the raw boundary after the cached rendered prefix", async () => {
    // A hidden root-thinking row before a cached visible row must not make reconnect resend that visible row.
    const firstVisible = { type: "user_message", id: "u1", content: "cached row", timestamp: 20 } as const;
    const secondVisible = { type: "user_message", id: "u2", content: "new row", timestamp: 30 } as const;
    const history = [rootThinkingEntry, firstVisible, secondVisible] as BrowserIncomingMessage[];
    const knownPrefix = computeHistoryPrefixSyncHash(history, 1, 0, {
      suppressRootThinkingOnlyAssistant: true,
    });
    const ws = { send: vi.fn() };

    await sendHistorySync(makeSession("codex", history), ws, 1, knownPrefix.hash);

    const sync = ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).find((msg) => msg.type === "history_sync");
    expect(sync.frozen_base_count).toBe(1);
    expect(sync.frozen_base_history_index).toBe(2);
    expect(sync.frozen_delta).toEqual([secondVisible]);
  });
});
