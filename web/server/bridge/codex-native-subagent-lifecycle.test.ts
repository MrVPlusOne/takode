import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import {
  applyCodexNativeSubagentEvent,
  createCodexNativeSubagentRegistry,
  deriveCodexNativeSubagentSnapshot,
} from "../codex-native-subagent-state.js";
import type { CodexNativeSubagentAdapterEvent } from "../codex-native-subagent-adapter-controller.js";
import { registerCodexNativeSubagentLifecycle } from "./codex-native-subagent-lifecycle.js";

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

function createFixture(options: { registry?: ReturnType<typeof createCodexNativeSubagentRegistry> } = {}) {
  let listener: ((event: CodexNativeSubagentAdapterEvent) => void) | undefined;
  const registrationOrder: string[] = [];
  const seedKnownChildProviderThreadIds = vi.fn(() => registrationOrder.push("seed"));
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
  };
  const handled: BrowserIncomingMessage[] = [];
  const persistSession = vi.fn(() => registrationOrder.push("persist"));
  registerCodexNativeSubagentLifecycle(session, adapter, {
    persistSession,
    handleBrowserMessage: async (_target, message) => {
      registrationOrder.push("handle");
      handled.push(message);
      if (message.type === "session_update") {
        session.state = { ...session.state, ...message.session };
      } else if (message.type === "assistant") {
        session.messageHistory.push(message);
      }
    },
  });
  return {
    adapter,
    session,
    handled,
    persistSession,
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
    expect(fixture.seedKnownChildProviderThreadIds).toHaveBeenCalledWith(seeded);
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

  it("buffers early child output until authoritative root-turn activity arrives", async () => {
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
    expect(fixture.handled.some((message) => message.type === "assistant")).toBe(false);

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
      (message) => message.type === "assistant" && message.message.id === "early-child-message",
    );
    expect(assistant?.codexSubagent).toMatchObject({ rootTurnId: "feed-user-turn-a" });
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
});
