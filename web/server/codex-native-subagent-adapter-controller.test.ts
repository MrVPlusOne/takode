import { describe, expect, it, vi } from "vitest";
import {
  CodexNativeSubagentAdapterController,
  type CodexNativeSubagentAdapterEvent,
} from "./codex-native-subagent-adapter-controller.js";

async function flushDiscovery() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("CodexNativeSubagentAdapterController", () => {
  it("uses the bounded experimental descendant query for verified thread_spawn metadata", async () => {
    const call = vi.fn(async (method: string, params: Record<string, unknown>) => {
      expect(method).toBe("thread/list");
      expect(params).toMatchObject({
        ancestorThreadId: "provider-root",
        sourceKinds: ["subAgentThreadSpawn"],
        archived: false,
        sortKey: "created_at",
        sortDirection: "asc",
        limit: 100,
      });
      return {
        data: [
          {
            id: "provider-child",
            parentThreadId: "provider-root",
            createdAt: 1_787_860_000,
            updatedAt: 1_787_860_001,
            status: { type: "active", activeFlags: ["waitingOnApproval"] },
            source: {
              subAgent: {
                thread_spawn: {
                  parent_thread_id: "provider-root",
                  depth: 1,
                  agent_path: "/root/discovered",
                  agent_nickname: "Ada",
                  agent_role: "explorer",
                },
              },
            },
          },
        ],
        nextCursor: null,
      };
    });
    const events: CodexNativeSubagentAdapterEvent[] = [];
    const controller = new CodexNativeSubagentAdapterController({ call } as never, () => true);
    controller.onEvent((event) => events.push(event));
    controller.setRootProviderThreadId("provider-root");
    controller.requestDiscovery();
    await flushDiscovery();

    expect(events.filter((event) => event.type === "thread_metadata")).toEqual([
      expect.objectContaining({
        type: "thread_metadata",
        childProviderThreadId: "provider-child",
        parentProviderThreadId: "provider-root",
        agentPath: "/root/discovered",
        nickname: "Ada",
        role: "explorer",
        depth: 1,
      }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: "discovery_finished", coverage: "complete" });
  });

  it("fails closed when experimental discovery returns malformed pages or unverified rows", async () => {
    for (const response of [
      { data: "not-an-array", nextCursor: null },
      { data: [], nextCursor: 42 },
      {
        data: [
          {
            id: "provider-review",
            parentThreadId: "provider-root",
            source: { subAgent: "review" },
          },
        ],
        nextCursor: null,
      },
    ]) {
      const events: CodexNativeSubagentAdapterEvent[] = [];
      const controller = new CodexNativeSubagentAdapterController(
        { call: vi.fn(async () => response) } as never,
        () => true,
      );
      controller.onEvent((event) => events.push(event));
      controller.setRootProviderThreadId("provider-root");
      controller.requestDiscovery();
      await flushDiscovery();

      expect(events.filter((event) => event.type === "thread_metadata")).toEqual([]);
      expect(events.at(-1)).toMatchObject({ type: "discovery_finished", coverage: "partial", reason: "failed" });
    }
  });

  it("rejects malformed experimental turn-list pages instead of coercing them to empty history", async () => {
    for (const response of [
      { data: "not-an-array", nextCursor: null },
      { data: [], nextCursor: 42 },
      { data: [{ itemsView: "full", items: [] }], nextCursor: null },
    ]) {
      const controller = new CodexNativeSubagentAdapterController(
        { call: vi.fn(async () => response) } as never,
        () => true,
      );
      await expect(controller.listTurns("provider-child")).rejects.toThrow(/Malformed thread\/turns\/list response/);
    }
  });

  it("associates a root-owned thread start with the active root turn", () => {
    const events: CodexNativeSubagentAdapterEvent[] = [];
    const controller = new CodexNativeSubagentAdapterController(
      { call: vi.fn() } as never,
      () => true,
      () => "provider-root-turn",
    );
    controller.onEvent((event) => events.push(event));
    controller.setRootProviderThreadId("provider-root");

    controller.observeNotification("thread/started", {
      thread: {
        id: "provider-child",
        parentThreadId: "provider-root",
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "provider-root",
              depth: 1,
              agent_path: "/root/early_child",
            },
          },
        },
      },
    });

    expect(events.filter((event) => event.type === "thread_metadata")).toEqual([
      expect.objectContaining({
        type: "thread_metadata",
        childProviderThreadId: "provider-child",
        rootProviderTurnId: "provider-root-turn",
      }),
    ]);
  });

  it("fails closed to partial coverage when the experimental query is unsupported", async () => {
    const controller = new CodexNativeSubagentAdapterController(
      { call: vi.fn(async () => Promise.reject(new Error("Method not found: thread/list"))) } as never,
      () => true,
    );
    const events: CodexNativeSubagentAdapterEvent[] = [];
    controller.onEvent((event) => events.push(event));
    controller.setRootProviderThreadId("provider-root");
    controller.requestDiscovery();
    await flushDiscovery();

    expect(events.filter((event) => event.type === "discovery_finished")).toEqual([
      expect.objectContaining({
        type: "discovery_finished",
        coverage: "partial",
        reason: "unsupported",
      }),
    ]);
  });

  it("defers discovery during an active root turn and drains once idle", async () => {
    let idle = false;
    const call = vi.fn(async () => ({ data: [], nextCursor: null }));
    const controller = new CodexNativeSubagentAdapterController({ call } as never, () => idle);
    controller.setRootProviderThreadId("provider-root");
    controller.requestDiscovery();
    await flushDiscovery();
    expect(call).not.toHaveBeenCalled();

    idle = true;
    controller.drainDiscovery();
    await flushDiscovery();
    expect(call).toHaveBeenCalledOnce();
  });
  it("does not turn a child-to-root interaction into a reciprocal child identity", () => {
    // Producer shape captured after restart: when a child sends to /root, the
    // child thread receives interacted activity targeting the provider root.
    const events: CodexNativeSubagentAdapterEvent[] = [];
    const controller = new CodexNativeSubagentAdapterController({ call: vi.fn() } as never, () => true);
    controller.onEvent((event) => events.push(event));
    // Replacement-adapter attach can seed persisted IDs before initialize
    // returns the provider root. Root identification must evict that stale ID.
    controller.seedKnownChildProviderThreadIds(["provider-child", "provider-root"]);
    expect(controller.isKnownChildProviderThreadId("provider-root")).toBe(true);
    controller.setRootProviderThreadId("provider-root");

    controller.observeNotification("item/completed", {
      threadId: "provider-child",
      turnId: "provider-child-turn",
      completedAtMs: 1_787_867_114_000,
      item: {
        type: "subAgentActivity",
        id: "child-message-to-root",
        kind: "interacted",
        agentThreadId: "provider-root",
        agentPath: "/root",
      },
    });

    expect(events.filter((event) => event.type === "activity")).toEqual([]);
    expect(controller.isKnownChildProviderThreadId("provider-root")).toBe(false);
    expect(
      controller.emitOwnedBrowserMessage(
        {
          type: "assistant",
          message: {
            id: "root-message",
            type: "message",
            role: "assistant",
            model: "",
            content: [{ type: "text", text: "Root-owned reply" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
          parent_tool_use_id: null,
        },
        {
          providerThreadId: "provider-root",
          providerTurnId: "provider-root-turn",
          observedAt: 1_787_867_115_000,
        },
      ),
    ).toBe(false);
  });

  it("scrubs controller-known provider identities from child error audit text", () => {
    const events: CodexNativeSubagentAdapterEvent[] = [];
    const controller = new CodexNativeSubagentAdapterController(
      { call: vi.fn() } as never,
      () => true,
      () => "provider-root-turn",
    );
    controller.onEvent((event) => events.push(event));
    controller.seedKnownChildProviderThreadIds(["provider-child", "provider-sibling"]);
    controller.setRootProviderThreadId("provider-root");

    controller.observeNotification("codex/event/error", {
      threadId: "provider-child",
      turnId: "provider-child-turn",
      itemId: "provider-error-item",
      msg: {
        message:
          "failed at provider-root/provider-root-turn for provider-child/provider-child-turn with provider-sibling provider-error-item",
      },
    });

    const ownedError = events.find(
      (event): event is Extract<CodexNativeSubagentAdapterEvent, { type: "owned_message" }> =>
        event.type === "owned_message" && event.message.type === "error",
    );
    expect(ownedError?.message).toMatchObject({ type: "error" });
    expect(JSON.stringify(ownedError?.message)).not.toMatch(
      /provider-root|provider-root-turn|provider-child|provider-child-turn|provider-sibling|provider-error-item/,
    );
    expect(ownedError?.message.type === "error" ? ownedError.message.message : "").toContain(
      "[sensitive value omitted]",
    );
  });
});
