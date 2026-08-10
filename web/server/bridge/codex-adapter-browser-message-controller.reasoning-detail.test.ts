import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { handleCodexAdapterBrowserMessage } from "./codex-adapter-browser-message-controller.js";

function makeSession() {
  return {
    id: "reasoning-detail-session",
    state: {},
    messageHistory: [] as BrowserIncomingMessage[],
    activeTurnRoute: { threadKey: "q-1842", questId: "q-1842" },
  };
}

function makeDeps(broadcasts: BrowserIncomingMessage[]) {
  return {
    touchActivity: vi.fn(),
    clearOptimisticRunningTimer: vi.fn(),
    persistSession: vi.fn(),
    syncSideChatParent: vi.fn(),
    broadcastToBrowsers: (_session: unknown, message: BrowserIncomingMessage) => broadcasts.push(message),
  } as any;
}

describe("Codex reasoning detail routing", () => {
  it("persists live updates as one routed detail and ignores stale replay", async () => {
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "codex_reasoning_detail",
        id: "codex-reasoning-r1",
        text: "**Inspecting state**\n\nPartial",
        status: "streaming",
        timestamp: 10,
        parent_tool_use_id: null,
      },
      deps,
    );
    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "codex_reasoning_detail",
        id: "codex-reasoning-r1",
        text: "**Inspecting state**\n\nComplete summary",
        status: "complete",
        timestamp: 20,
        parent_tool_use_id: null,
      },
      deps,
    );
    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "codex_reasoning_detail",
        id: "codex-reasoning-r1",
        text: "**Inspecting state**\n\nPartial",
        status: "streaming",
        timestamp: 30,
        parent_tool_use_id: null,
      },
      deps,
    );

    expect(session.messageHistory).toEqual([
      expect.objectContaining({
        type: "codex_reasoning_detail",
        id: "codex-reasoning-r1",
        text: "**Inspecting state**\n\nComplete summary",
        status: "complete",
        timestamp: 10,
        threadKey: "q-1842",
        questId: "q-1842",
      }),
    ]);
    expect(broadcasts.filter((message) => message.type === "codex_reasoning_detail")).toHaveLength(2);
  });

  it("inherits a parented detail route from its subagent tool", async () => {
    const session = makeSession();
    session.messageHistory.push({
      type: "assistant",
      parent_tool_use_id: null,
      threadKey: "q-1842",
      questId: "q-1842",
      message: {
        id: "tool-owner",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "tool_use", id: "task-1", name: "Task", input: { prompt: "Inspect" } }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "codex_reasoning_detail",
        id: "codex-reasoning-child-r1",
        text: "**Checking child state**\n\nScoped detail.",
        status: "complete",
        timestamp: 10,
        parent_tool_use_id: "task-1",
      },
      makeDeps([]),
    );

    expect(session.messageHistory[1]).toMatchObject({
      type: "codex_reasoning_detail",
      parent_tool_use_id: "task-1",
      threadKey: "q-1842",
      questId: "q-1842",
    });
  });
});
