import { describe, expect, it, vi } from "vitest";
const mockRefreshBrowserConversationViews = vi.hoisted(() => vi.fn());
vi.mock("./browser-transport-controller.js", () => ({
  refreshBrowserConversationViews: mockRefreshBrowserConversationViews,
}));

import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import {
  applyCodexNativeSubagentEvent,
  createCodexNativeSubagentRegistry,
  deriveCodexNativeSubagentSnapshot,
} from "../codex-native-subagent-state.js";
import type { CodexNativeSubagentAdapterEvent } from "../codex-native-subagent-adapter-controller.js";
import {
  registerCodexNativeSubagentLifecycle,
  type CodexNativeSubagentLifecycleSessionLike,
} from "./codex-native-subagent-lifecycle.js";

function pendingTurn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "user_message", content: "run children" },
    userMessageId: "feed-user-turn-a",
    userContent: "run children",
    historyIndex: 0,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1_787_860_000_000,
    updatedAt: 1_787_860_000_500,
    acknowledgedAt: 1_787_860_000_500,
    turnTarget: "current",
    lastError: null,
    turnId: "provider-root-turn-a",
    disconnectedAt: null,
    resumeConfirmedAt: null,
  };
}

function createFixture(
  options: { registry?: ReturnType<typeof createCodexNativeSubagentRegistry>; frozenCount?: number } = {},
) {
  mockRefreshBrowserConversationViews.mockClear();

  let listener: ((event: CodexNativeSubagentAdapterEvent) => void) | undefined;
  const registrationOrder: string[] = [];
  const seedKnownChildProviderThreadIds = vi.fn((_threadIds: Iterable<string>) => registrationOrder.push("seed"));
  const adapter = {
    getNativeSubagentController: () => ({
      onEvent: (next: (event: CodexNativeSubagentAdapterEvent) => void) => {
        listener = next;
      },
      seedKnownChildProviderThreadIds,
    }),
  };
  const registry = options.registry ?? createCodexNativeSubagentRegistry("session-native");
  const session = {
    id: "session-native",
    state: { codex_native_subagents: deriveCodexNativeSubagentSnapshot(registry) },
    codexAdapter: adapter,
    codexNativeSubagents: registry,
    pendingCodexTurns: [pendingTurn()],
    messageHistory: [
      { type: "user_message", id: "feed-user-turn-a", content: "run children", timestamp: 1_787_860_000_000 },
    ] as BrowserIncomingMessage[],
    browserSockets: new Set(),
    nextEventSeq: 1,
    frozenCount: options.frozenCount ?? 0,
    eventBuffer: [] as Array<{ message: BrowserIncomingMessage }>,
  };
  const handled: BrowserIncomingMessage[] = [];
  const persistSession = vi.fn(() => registrationOrder.push("persist"));
  const persistHistoryOwnershipRepair = vi.fn(
    async (_session: CodexNativeSubagentLifecycleSessionLike, _expectedFrozenCount: number): Promise<void> => {
      registrationOrder.push("persist-history-repair");
    },
  );
  const handleMessage = async (message: BrowserIncomingMessage) => {
    registrationOrder.push("handle");
    handled.push(message);
    if (message.type === "session_update") {
      session.state = { ...session.state, ...message.session };
    } else if (message.type === "assistant") {
      session.messageHistory.push(message);
    }
  };
  registerCodexNativeSubagentLifecycle(session, adapter, {
    persistSession,
    persistHistoryOwnershipRepair,
    broadcastToBrowsers: (_target, message) => void handleMessage(message),
    handleOwnedBrowserMessage: (_target, message) => handleMessage(message),
  });
  return {
    adapter,
    session,
    handled,
    persistSession,
    persistHistoryOwnershipRepair,
    registrationOrder,
    seedKnownChildProviderThreadIds,
    emit: (event: CodexNativeSubagentAdapterEvent) => listener!(event),
  };
}

describe("Codex native subagent bridge lifecycle", () => {
  it("does not revise or publish an already-partial registry on initial adapter registration", () => {
    const registry = createCodexNativeSubagentRegistry("session-native");
    const revision = registry.revision;
    const fixture = createFixture({ registry });

    expect(registry.revision).toBe(revision);
    expect(fixture.session.state.codex_native_subagents?.coverage).toBe("partial");
    expect(fixture.persistSession).not.toHaveBeenCalled();
    expect(fixture.handled).toEqual([]);
    expect(fixture.registrationOrder).toEqual(["seed"]);
  });

  it.each([
    { label: "zero-child", withChild: false, total: 0, seeded: [] },
    { label: "nonzero-child", withChild: true, total: 1, seeded: ["provider-existing-child"] },
  ])("downgrades complete $label coverage before replacement-adapter seeding", ({ withChild, total, seeded }) => {
    const registry = createCodexNativeSubagentRegistry("session-native", { coverage: "complete" });
    if (withChild) {
      applyCodexNativeSubagentEvent(
        registry,
        {
          type: "activity",
          kind: "started",
          providerThreadId: "provider-existing-child",
          providerEventId: "existing-spawn",
          rootProviderTurnId: "provider-root-turn-a",
          agentPath: "/root/existing",
          observedAt: 1_787_860_001_000,
        },
        { resolveFeedRootTurnKey: () => "feed-user-turn-a" },
      );
    }
    const revision = registry.revision;

    const fixture = createFixture({ registry });

    expect(registry.coverage).toBe("partial");
    expect(registry.revision).toBe(revision + 1);
    expect(fixture.session.state.codex_native_subagents).toMatchObject({ coverage: "partial", session: { total } });
    expect(fixture.persistSession).toHaveBeenCalledOnce();
    expect(fixture.handled).toHaveLength(1);
    expect(fixture.handled[0]).toMatchObject({
      type: "session_update",
      session: { codex_native_subagents: { coverage: "partial", session: { total } } },
    });
    expect([...(fixture.seedKnownChildProviderThreadIds.mock.calls[0]?.[0] ?? [])]).toEqual(seeded);
    expect(fixture.registrationOrder).toEqual(["persist", "handle", "seed"]);
  });
  it("maps private provider activity to an opaque authoritative turn snapshot", () => {
    const fixture = createFixture();
    fixture.emit({
      type: "activity",
      eventId: "activity-1",
      senderProviderThreadId: "provider-root-thread",
      senderProviderTurnId: "provider-root-turn-a",
      childProviderThreadId: "provider-child-thread",
      agentPath: "/root/schema_probe",
      kind: "started",
      observedAt: 1_787_860_001_000,
    });

    const snapshot = fixture.session.state.codex_native_subagents!;
    expect(snapshot.session.total).toBe(1);
    expect(snapshot.turns["feed-user-turn-a"]).toMatchObject({ total: 1, status: "starting" });
    expect(snapshot.children[0]).toMatchObject({
      rootTurnId: "feed-user-turn-a",
      agentPath: "/root/schema_probe",
      status: "starting",
    });
    expect(snapshot.children[0]?.childId).toMatch(/^codex-child-/);
    expect(JSON.stringify(snapshot)).not.toContain("provider-child-thread");
    expect(fixture.persistSession).toHaveBeenCalled();
    expect(fixture.handled.some((message) => message.type === "session_update")).toBe(true);
  });

  it("decorates child-owned history before the ordinary browser-message pipeline", async () => {
    const fixture = createFixture();
    fixture.emit({
      type: "activity",
      eventId: "activity-1",
      senderProviderThreadId: "provider-root-thread",
      senderProviderTurnId: "provider-root-turn-a",
      childProviderThreadId: "provider-child-thread",
      agentPath: "/root/schema_probe",
      kind: "started",
      observedAt: 1_787_860_001_000,
    });
    fixture.emit({
      type: "owned_message",
      source: {
        providerThreadId: "provider-child-thread",
        providerTurnId: "provider-child-turn",
        observedAt: 1_787_860_002_000,
        itemId: "provider-item-1",
      },
      message: {
        type: "assistant",
        message: {
          id: "safe-message-1",
          type: "message",
          role: "assistant",
          model: "",
          content: [{ type: "text", text: "Child result" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 1_787_860_002_000,
      },
    });
    await Promise.resolve();

    const assistant = fixture.handled.find((message) => message.type === "assistant");
    expect(assistant).toMatchObject({
      type: "assistant",
      codexSubagent: {
        rootTurnId: "feed-user-turn-a",
      },
    });
    expect(assistant?.codexSubagent?.childId).toMatch(/^codex-child-/);
    const serialized = JSON.stringify(assistant);
    expect(serialized).not.toContain("provider-child-thread");
    expect(serialized).not.toContain("rootProviderTurnId");
    expect(serialized).not.toContain("provider-root-turn-a");
    expect(fixture.session.state.codex_native_subagents?.children[0]?.transcriptAvailability).toBe("partial");
  });

  it("projects chronological child audit through the bounded privacy contract", async () => {
    const fixture = createFixture();
    fixture.emit({
      type: "activity",
      eventId: "provider-spawn-item",
      senderProviderThreadId: "provider-root-thread",
      senderProviderTurnId: "provider-root-turn-a",
      childProviderThreadId: "provider-child-thread",
      agentPath: "/root/privacy_probe",
      kind: "started",
      observedAt: 1_787_860_001_000,
    });
    const rawMessage: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
      type: "assistant",
      message: {
        id: "codex-tool_use-provider-tool-item",
        type: "message",
        role: "assistant",
        model: "private-model-name",
        content: [
          {
            type: "text",
            text: "child provider-child-thread replied to provider-root-thread from /Users/private/repo/secret.ts",
          },
          {
            type: "tool_use",
            id: "provider-tool-item",
            name: "Read",
            input: {
              file_path: "src/example.ts",
              cwd: "/Users/private/repo",
              API_TOKEN: "private-token",
            },
          },
          {
            type: "tool_result",
            tool_use_id: "provider-tool-item",
            content: "result from provider-root-turn-a at /Users/private/repo/secret.ts",
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: "provider-parent-tool",
      timestamp: 1_787_860_002_000,
    };
    const event = {
      type: "owned_message" as const,
      source: {
        providerThreadId: "provider-child-thread",
        providerTurnId: "provider-child-turn",
        itemId: "provider-tool-item",
        observedAt: 1_787_860_002_000,
      },
      message: rawMessage,
    };

    fixture.emit(event);
    await Promise.resolve();
    const assistant = fixture.handled.find(
      (message) => message.type === "assistant" && message.message.content.some((block) => block.type === "tool_use"),
    );
    expect(assistant?.type).toBe("assistant");
    if (assistant?.type !== "assistant") throw new Error("missing projected assistant");
    const tool = assistant.message.content.find((block) => block.type === "tool_use");
    const result = assistant.message.content.find((block) => block.type === "tool_result");
    expect(assistant.message.id).toMatch(/^codex-native-message-[0-9a-f]{24}$/);
    expect(assistant.message.model).toBe("");
    expect(assistant.parent_tool_use_id).toBeNull();
    expect(tool).toMatchObject({
      type: "tool_use",
      id: expect.stringMatching(/^codex-native-tool-[0-9a-f]{24}$/),
      name: "Read",
      input: { file_path: "src/example.ts" },
    });
    expect(tool?.type === "tool_use" ? tool.input : {}).not.toHaveProperty("cwd");
    expect(tool?.type === "tool_use" ? tool.input : {}).not.toHaveProperty("API_TOKEN");
    expect(result).toMatchObject({
      type: "tool_result",
      tool_use_id: tool?.type === "tool_use" ? tool.id : "missing",
    });
    const serialized = JSON.stringify(assistant);
    for (const forbidden of [
      "provider-child-thread",
      "provider-root-thread",
      "provider-root-turn-a",
      "provider-tool-item",
      "provider-parent-tool",
      "/Users/private",
      "private-token",
      "private-model-name",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(serialized).toContain("[sensitive value omitted]");
    expect(serialized).toContain("[absolute path omitted]");

    fixture.emit(event);
    await Promise.resolve();
    const projected = fixture.handled.filter(
      (message): message is Extract<BrowserIncomingMessage, { type: "assistant" }> =>
        message.type === "assistant" && message.message.content.some((block) => block.type === "tool_use"),
    );
    expect(projected[1]).toEqual(projected[0]);
  });

  it("keeps early child output as unresolved audit until authoritative root-turn activity arrives", async () => {
    // Installed Codex may announce the child thread before the parent's
    // subAgentActivity item. Child rows must not be flattened or dropped.
    const fixture = createFixture();
    fixture.emit({
      type: "thread_metadata",
      childProviderThreadId: "provider-early-child",
      parentProviderThreadId: "provider-root-thread",
      agentPath: "/root/early_child",
      depth: 1,
      observedAt: 1_787_860_001_000,
    });
    fixture.emit({
      type: "owned_message",
      source: {
        providerThreadId: "provider-early-child",
        providerTurnId: "provider-early-turn",
        observedAt: 1_787_860_001_100,
      },
      message: {
        type: "assistant",
        message: {
          id: "early-child-message",
          type: "message",
          role: "assistant",
          model: "",
          content: [{ type: "text", text: "Early child output" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 1_787_860_001_100,
      },
    });

    expect(fixture.session.state.codex_native_subagents).toMatchObject({
      coverage: "partial",
      session: { total: 0 },
      children: [],
    });
    const unresolvedAssistant = fixture.handled.find(
      (message) =>
        message.type === "assistant" &&
        message.message.content.some((block) => block.type === "text" && block.text === "Early child output"),
    );
    expect(unresolvedAssistant?.codexSubagent?.childId).toMatch(/^codex-child-/);
    expect(unresolvedAssistant?.codexSubagent).not.toHaveProperty("rootTurnId");

    fixture.emit({
      type: "activity",
      eventId: "early-child-spawn",
      senderProviderThreadId: "provider-root-thread",
      senderProviderTurnId: "provider-root-turn-a",
      childProviderThreadId: "provider-early-child",
      agentPath: "/root/early_child",
      kind: "started",
      observedAt: 1_787_860_001_200,
    });
    await Promise.resolve();

    const assistant = fixture.handled.find(
      (message) =>
        message.type === "assistant" &&
        message.message.content.some((block) => block.type === "text" && block.text === "Early child output"),
    );
    expect(assistant?.codexSubagent?.childId).toBe(unresolvedAssistant?.codexSubagent?.childId);
    expect(assistant?.codexSubagent).not.toHaveProperty("rootTurnId");
    expect(fixture.session.state.codex_native_subagents).toMatchObject({
      session: { total: 1 },
      children: [expect.objectContaining({ rootTurnId: "feed-user-turn-a" })],
    });
  });

  it("inherits the root turn for a nested child without exposing the provider parent", () => {
    const fixture = createFixture();
    fixture.emit({
      type: "activity",
      eventId: "parent-start",
      senderProviderThreadId: "provider-root-thread",
      senderProviderTurnId: "provider-root-turn-a",
      childProviderThreadId: "provider-parent-child",
      agentPath: "/root/parent",
      kind: "started",
      observedAt: 1_787_860_001_000,
    });
    fixture.emit({
      type: "activity",
      eventId: "nested-start",
      senderProviderThreadId: "provider-parent-child",
      senderProviderTurnId: "provider-parent-turn",
      childProviderThreadId: "provider-nested-child",
      agentPath: "/root/parent/nested",
      kind: "started",
      observedAt: 1_787_860_002_000,
    });

    const children = fixture.session.state.codex_native_subagents!.children;
    const parent = children.find((child) => child.agentPath === "/root/parent")!;
    const nested = children.find((child) => child.agentPath === "/root/parent/nested")!;
    expect(nested).toMatchObject({ parentChildId: parent.childId, rootTurnId: "feed-user-turn-a", depth: 2 });
    expect(JSON.stringify(children)).not.toContain("provider-parent-child");
  });
  it("repairs persisted root ownership while preserving genuine child audit messages", () => {
    const registry = createCodexNativeSubagentRegistry("session-native", { coverage: "complete" });
    applyCodexNativeSubagentEvent(
      registry,
      {
        type: "activity",
        kind: "started",
        providerThreadId: "provider-current-child",
        providerParentThreadId: "provider-root-thread",
        providerEventId: "spawn-current-child",
        rootProviderTurnId: "provider-root-turn-a",
        agentPath: "/root/post_restart_ui_check",
        observedAt: 1_787_860_001_000,
      },
      { resolveFeedRootTurnKey: () => "feed-user-turn-a" },
    );
    const child = registry.childrenByProviderThreadId["provider-current-child"]!;
    applyCodexNativeSubagentEvent(registry, {
      type: "thread_metadata",
      observedAt: 1_787_860_001_500,
      thread: {
        id: "provider-ambiguous-child",
        parentThreadId: "provider-root-thread",
        source: {
          subAgent: {
            thread_spawn: {
              parent_thread_id: "provider-root-thread",
              depth: 1,
              agent_path: "/root/historical_partial",
            },
          },
        },
      },
    });
    const ambiguousChild = registry.childrenByProviderThreadId["provider-ambiguous-child"]!;
    registry.childrenByProviderThreadId["provider-root-thread"] = {
      publicChildId: "codex-child-corrupt-root",
      providerParentThreadId: "provider-current-child",
      spawnRootProviderTurnId: "provider-root-turn-a",
      feedRootTurnKey: "feed-user-turn-a",
      agentPath: "/root",
      depth: 2,
      spawnOrder: 3,
      status: "done",
      statusObservedAt: 1_787_860_002_000,
      transcriptAvailability: "partial",
      turnsByProviderTurnId: {},
      seenActivityEventIds: ["interacted:child-message-to-root"],
    };
    registry.nextSpawnOrder = 4;

    const fixture = createFixture({ registry });
    const assistantMessage = (
      id: string,
      text: string,
      childId: string,
      ownershipExtras: Record<string, unknown> = {},
    ): BrowserIncomingMessage => ({
      type: "assistant",
      message: {
        id,
        type: "message",
        role: "assistant",
        model: "",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      codexSubagent: { childId, rootTurnId: "feed-user-turn-a", ...ownershipExtras },
    });
    fixture.session.messageHistory.push(
      assistantMessage("genuine-child-message", "Child audit row", child.publicChildId, {
        rootProviderTurnId: "provider-root-turn-a",
      }),
      assistantMessage("ambiguous-child-message", "Partial child audit row", ambiguousChild.publicChildId),
      assistantMessage("misclassified-root-message", "Root-owned reply", "codex-child-corrupt-root"),
    );
    fixture.session.eventBuffer = [
      {
        message: assistantMessage("misclassified-root-buffer", "Root buffered reply", "codex-child-corrupt-root"),
      },
    ];
    fixture.session.frozenCount = fixture.session.messageHistory.length;

    fixture.emit({
      type: "root_thread_identified",
      providerThreadId: "provider-root-thread",
      observedAt: 1_787_860_003_000,
    });

    expect(fixture.session.codexNativeSubagents.childrenByProviderThreadId["provider-root-thread"]).toBeUndefined();
    expect(fixture.session.state.codex_native_subagents).toMatchObject({
      coverage: "partial",
      session: { total: 1 },
      children: [expect.objectContaining({ displayName: "post_restart_ui_check" })],
      turns: { "feed-user-turn-a": expect.objectContaining({ total: 1 }) },
    });
    expect(
      fixture.session.messageHistory.find(
        (message) => message.type === "assistant" && message.message.id === "genuine-child-message",
      )?.codexSubagent,
    ).toEqual({ childId: child.publicChildId, rootTurnId: "feed-user-turn-a" });
    expect(
      fixture.session.messageHistory.find(
        (message) => message.type === "assistant" && message.message.id === "ambiguous-child-message",
      )?.codexSubagent?.childId,
    ).toBe(ambiguousChild.publicChildId);
    expect(
      fixture.session.messageHistory.find(
        (message) => message.type === "assistant" && message.message.id === "misclassified-root-message",
      )?.codexSubagent,
    ).toBeUndefined();
    expect(fixture.session.eventBuffer[0]?.message.codexSubagent).toBeUndefined();
    expect(mockRefreshBrowserConversationViews).toHaveBeenCalledOnce();
    expect(mockRefreshBrowserConversationViews).toHaveBeenCalledWith(fixture.session);
    expect(fixture.persistHistoryOwnershipRepair).toHaveBeenCalledOnce();
    expect(fixture.persistHistoryOwnershipRepair).toHaveBeenCalledWith(
      fixture.session,
      fixture.session.messageHistory.length,
    );
  });

  it("downgrades cyclic historical ownership to child-only audit metadata", () => {
    // A structurally invalid child remains inspectable only as unresolved audit;
    // its persisted message cannot keep a stale root-turn or provider field.
    const registry = createCodexNativeSubagentRegistry("session-native", { coverage: "complete" });
    for (const [providerThreadId, observedAt] of [
      ["provider-cycle-a", 1],
      ["provider-cycle-b", 2],
    ] as const) {
      applyCodexNativeSubagentEvent(
        registry,
        {
          type: "activity",
          kind: "started",
          providerThreadId,
          providerEventId: `spawn-${providerThreadId}`,
          rootProviderTurnId: "provider-root-turn-a",
          agentPath: `/root/${providerThreadId}`,
          observedAt,
        },
        { resolveFeedRootTurnKey: () => "feed-user-turn-a" },
      );
    }
    registry.childrenByProviderThreadId["provider-cycle-a"]!.providerParentThreadId = "provider-cycle-b";
    registry.childrenByProviderThreadId["provider-cycle-b"]!.providerParentThreadId = "provider-cycle-a";
    const cycleChildId = registry.childrenByProviderThreadId["provider-cycle-a"]!.publicChildId;
    const fixture = createFixture({ registry, frozenCount: 2 });
    fixture.session.messageHistory.push({
      type: "error",
      id: "persisted-cycle-error",
      message: "Historical child error",
      timestamp: 3,
      codexSubagent: {
        childId: cycleChildId,
        rootTurnId: "feed-user-turn-a",
        rootProviderTurnId: "provider-root-turn-a",
      } as never,
    });

    fixture.emit({ type: "root_thread_identified", providerThreadId: "provider-root-thread", observedAt: 4 });

    expect(fixture.session.messageHistory.at(-1)?.codexSubagent).toEqual({ childId: cycleChildId });
    expect(fixture.session.state.codex_native_subagents).toMatchObject({ coverage: "partial", session: { total: 0 } });
    expect(fixture.persistHistoryOwnershipRepair).toHaveBeenCalledWith(fixture.session, 2);
    expect(mockRefreshBrowserConversationViews).toHaveBeenCalledOnce();
    expect(mockRefreshBrowserConversationViews).toHaveBeenCalledWith(fixture.session);
  });

  it("scrubs all registry-known provider IDs from chronological child errors", () => {
    const registry = createCodexNativeSubagentRegistry("session-native");
    const fixture = createFixture({ registry });
    for (const [childProviderThreadId, eventId, path] of [
      ["provider-child-thread", "provider-spawn-item", "/root/error_child"],
      ["provider-sibling-thread", "provider-sibling-spawn", "/root/sibling"],
    ] as const) {
      fixture.emit({
        type: "activity",
        eventId,
        senderProviderThreadId: "provider-root-thread",
        senderProviderTurnId: "provider-root-turn-a",
        childProviderThreadId,
        agentPath: path,
        kind: "started",
        observedAt: 10,
      });
    }
    fixture.emit({
      type: "owned_message",
      source: {
        providerThreadId: "provider-child-thread",
        providerTurnId: "provider-child-turn",
        itemId: "provider-error-item",
        observedAt: 11,
      },
      message: {
        type: "error",
        id: "public-error-id",
        timestamp: 11,
        message:
          "failed at provider-root-turn-a via provider-root-thread, provider-sibling-thread, provider-spawn-item, provider-error-item",
      },
    });

    const error = fixture.handled.find((message) => message.type === "error");
    expect(error).toMatchObject({ type: "error", id: "public-error-id" });
    expect(JSON.stringify(error)).not.toMatch(
      /provider-root-turn-a|provider-root-thread|provider-sibling-thread|provider-spawn-item|provider-error-item/,
    );
    expect(error?.type === "error" ? error.message : "").toContain("[sensitive value omitted]");
  });
});
