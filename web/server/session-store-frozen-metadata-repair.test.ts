import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCodexNativeSubagentEvent,
  codexNativeSubagentChildIdForProviderThread,
  createCodexNativeSubagentRegistry,
} from "./codex-native-subagent-state.js";
import { SessionStore, type PersistedSession } from "./session-store.js";
import type { BrowserIncomingMessage, SessionState } from "./session-types.js";

function state(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    backend_type: "codex",
    backend_state: "disconnected",
    model: "gpt-5.2-codex",
    cwd: "/test",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 1,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function completedHistory(): BrowserIncomingMessage[] {
  return [
    { type: "user_message", id: "user-1", content: "Run a child", timestamp: 100 },
    {
      type: "assistant",
      message: {
        id: "root-reply",
        type: "message",
        role: "assistant",
        model: "gpt-5.2-codex",
        content: [{ type: "text", text: "Root-owned reply" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 200,
      codexSubagent: { childId: "codex-child-corrupt-root", rootTurnId: "user-1" },
    },
    resultMessage("result-1"),
  ];
}

function resultMessage(id: string): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: id,
      session_id: "frozen-metadata-test",
    },
  };
}

function session(id: string): PersistedSession {
  return {
    id,
    state: state(id),
    messageHistory: completedHistory(),
    pendingMessages: [],
    pendingPermissions: [],
  };
}

function rootReply(persisted: PersistedSession): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  const message = persisted.messageHistory.find(
    (entry): entry is Extract<BrowserIncomingMessage, { type: "assistant" }> => entry.type === "assistant",
  );
  if (!message) throw new Error("missing assistant fixture");
  return message;
}

function historyEntry(persisted: PersistedSession, id: string): BrowserIncomingMessage {
  const message = persisted.messageHistory.find((entry) => {
    if (entry.type === "assistant") return entry.message.id === id;
    return entry.type === "error" && entry.id === id;
  });
  if (!message) throw new Error(`missing history fixture ${id}`);
  return message;
}

describe("SessionStore frozen metadata repair", () => {
  it("keeps a repaired frozen ownership prefix durable across two later restarts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "takode-frozen-metadata-repair-"));
    try {
      const initialStore = new SessionStore(dir);
      const original = session("frozen-metadata-repair");
      await initialStore.saveSync(original);
      await initialStore.flushAll();

      const repairStore = new SessionStore(dir);
      const restoredForRepair = await repairStore.load(original.id);
      expect(restoredForRepair?._frozenCount).toBe(3);
      expect(rootReply(restoredForRepair!).codexSubagent).toBeDefined();

      const repairedReply = rootReply(restoredForRepair!);
      const { codexSubagent: _removedInvalidOwnership, ...rootOwnedReply } = repairedReply;
      restoredForRepair!.messageHistory[1] = rootOwnedReply;
      await repairStore.rewriteFrozenHistoryMetadata(restoredForRepair!, 3);
      await repairStore.flushAll();

      const firstRestartStore = new SessionStore(dir);
      const firstRestart = await firstRestartStore.load(original.id);
      expect(firstRestart?.messageHistory).toHaveLength(3);
      expect(rootReply(firstRestart!).codexSubagent).toBeUndefined();
      await firstRestartStore.saveSync(firstRestart!);
      await firstRestartStore.flushAll();

      const secondRestartStore = new SessionStore(dir);
      const secondRestart = await secondRestartStore.load(original.id);
      expect(secondRestart?.messageHistory).toHaveLength(3);
      expect(rootReply(secondRestart!).codexSubagent).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps a retired frozen recovery diagnostic hidden after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "takode-frozen-recovery-diagnostic-"));
    try {
      const initialStore = new SessionStore(dir);
      const original = session("frozen-recovery-diagnostic");
      original.state.codex_turn_recovery = {
        recoveryId: "recovery-owner",
        originalOwnerId: "recovery-owner",
        originalProviderTurnId: "provider-turn",
        originalHistoryIndex: 0,
        continuationOwnerId: null,
        threadKey: "main",
        status: "action_required",
        reason: "continuation_failed",
        attempt: 1,
        maxAttempts: 1,
        createdAt: 100,
        updatedAt: 110,
      };
      original.messageHistory = [
        { type: "user_message", id: "recovery-owner", content: "Finish the task", timestamp: 100 },
        {
          type: "user_message",
          id: "recovery-diagnostic",
          content: "Review the interrupted work.",
          timestamp: 120,
          agentSource: { sessionId: "system:codex-leader-recovery-diagnostic" },
          codexTurnRecoveryId: "recovery-owner",
          threadKey: "main",
        },
        resultMessage("recovery-result"),
      ];
      await initialStore.saveSync(original);
      await initialStore.flushAll();

      const repairStore = new SessionStore(dir);
      const repaired = await repairStore.load(original.id);
      expect(repaired?._frozenCount).toBe(3);
      const diagnostic = repaired?.messageHistory[1];
      if (diagnostic?.type !== "user_message") throw new Error("missing recovery diagnostic fixture");
      diagnostic.codexTurnRecoveryResolvedAt = 200;
      repaired!.state.codex_turn_recovery = null;
      await repairStore.rewriteFrozenHistoryMetadata(repaired!, 3);
      await repairStore.flushAll();

      const reloaded = await new SessionStore(dir).load(original.id);
      expect(reloaded?.state.codex_turn_recovery).toBeNull();
      expect(reloaded?.messageHistory[1]).toMatchObject({
        type: "user_message",
        id: "recovery-diagnostic",
        codexTurnRecoveryId: "recovery-owner",
        codexTurnRecoveryResolvedAt: 200,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a stale frozen-count repair instead of rewriting concurrent history", async () => {
    const dir = await mkdtemp(join(tmpdir(), "takode-frozen-metadata-guard-"));
    try {
      const store = new SessionStore(dir);
      const original = session("frozen-metadata-guard");
      await store.saveSync(original);
      await store.flushAll();
      const restored = await store.load(original.id);

      await expect(store.rewriteFrozenHistoryMetadata(restored!, 2)).rejects.toThrow(
        "Frozen history metadata repair guard failed",
      );
      expect(rootReply((await new SessionStore(dir).load(original.id))!).codexSubagent).toBeDefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not overwrite a concurrently newer hot tail after the frozen repair yields", async () => {
    // Deterministic ordering regression: rewriteFrozenHistoryMetadata queues its
    // frozen write and yields, then a newer normal save queues a hot tail. The
    // repair's hot write must already own the earlier queue position.
    const dir = await mkdtemp(join(tmpdir(), "takode-frozen-metadata-race-"));
    try {
      const store = new SessionStore(dir);
      const original = session("frozen-metadata-race");
      await store.saveSync(original);
      await store.flushAll();

      const restored = await store.load(original.id);
      expect(restored?._frozenCount).toBe(3);
      const repaired = structuredClone(restored!);
      const repairedReply = rootReply(repaired);
      const { codexSubagent: _removedInvalidOwnership, ...rootOwnedReply } = repairedReply;
      repaired.messageHistory[1] = rootOwnedReply;

      const newer = structuredClone(repaired);
      newer.messageHistory.push({
        type: "user_message",
        id: "newer-hot-user-message",
        content: "This hot tail arrived while the frozen repair was in flight.",
        timestamp: 300,
      });
      newer.state.model = "newer-hot-model";

      const repairWrite = store.rewriteFrozenHistoryMetadata(repaired, 3);
      const newerHotWrite = store.saveSync(newer);
      await Promise.all([repairWrite, newerHotWrite]);
      await store.flushAll();

      const reloaded = await new SessionStore(dir).load(original.id);
      expect(rootReply(reloaded!).codexSubagent).toBeUndefined();
      expect(reloaded?.messageHistory).toContainEqual(
        expect.objectContaining({ type: "user_message", id: "newer-hot-user-message" }),
      );
      expect(reloaded?.state.model).toBe("newer-hot-model");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("repairs legacy root, cyclic, and runtime-extra ownership before disconnected replay", async () => {
    // Browser subscribe can precede adapter attach after restart, so SessionStore
    // itself must return and persist an exact public ownership shape.
    const dir = await mkdtemp(join(tmpdir(), "takode-frozen-restore-authority-"));
    try {
      const original = session("frozen-restore-authority");
      const registry = createCodexNativeSubagentRegistry(original.id, { coverage: "complete" });
      applyCodexNativeSubagentEvent(
        registry,
        {
          type: "activity",
          kind: "started",
          providerThreadId: "provider-current-child",
          providerParentThreadId: "provider-root-thread",
          providerEventId: "provider-current-spawn",
          rootProviderTurnId: "provider-root-turn",
          agentPath: "/root/current_child",
          observedAt: 110,
        },
        { resolveFeedRootTurnKey: () => "user-1" },
      );
      applyCodexNativeSubagentEvent(registry, {
        type: "thread_metadata",
        observedAt: 120,
        thread: {
          id: "provider-historical-child",
          parentThreadId: "provider-root-thread",
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: "provider-root-thread",
                depth: 1,
                agent_path: "/root/historical_child",
              },
            },
          },
        },
      });
      const current = registry.childrenByProviderThreadId["provider-current-child"]!;
      const historical = registry.childrenByProviderThreadId["provider-historical-child"]!;
      historical.spawnRootProviderTurnId = "provider-root-turn";
      historical.feedRootTurnKey = "user-1";
      const rootChildId = codexNativeSubagentChildIdForProviderThread(registry, "provider-root-thread");
      registry.childrenByProviderThreadId["provider-root-thread"] = {
        publicChildId: rootChildId,
        providerParentThreadId: "provider-current-child",
        spawnRootProviderTurnId: "provider-root-turn",
        feedRootTurnKey: "user-1",
        agentPath: "/root",
        depth: 2,
        spawnOrder: 3,
        status: "done",
        statusObservedAt: 130,
        transcriptAvailability: "partial",
        turnsByProviderTurnId: {},
        seenActivityEventIds: ["interacted:provider-root-contact"],
      };
      registry.nextSpawnOrder = 4;
      original.codexNativeSubagents = registry;

      const assistant = (
        id: string,
        text: string,
        codexSubagent: Record<string, unknown>,
      ): Extract<BrowserIncomingMessage, { type: "assistant" }> => ({
        type: "assistant",
        message: {
          id,
          type: "message",
          role: "assistant",
          model: "gpt-5.2-codex",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 200,
        codexSubagent: codexSubagent as never,
      });
      original.messageHistory = [
        { type: "user_message", id: "user-1", content: "Run a child", timestamp: 100 },
        assistant("current-child", "Current child", {
          childId: current.publicChildId,
          rootTurnId: "user-1",
          rootProviderTurnId: "provider-root-turn",
        }),
        {
          type: "error",
          id: "historical-child",
          message: "Historical child error",
          timestamp: 210,
          codexSubagent: {
            childId: historical.publicChildId,
            rootTurnId: "user-1",
            rootProviderTurnId: "provider-root-turn",
          } as never,
        },
        assistant("misclassified-root", "Root-owned reply", {
          childId: rootChildId,
          rootTurnId: "user-1",
          rootProviderTurnId: "provider-root-turn",
        }),
        resultMessage("result-1"),
      ];
      original.eventBuffer = [
        {
          seq: 1,
          message: assistant("buffered-historical", "Buffered historical", {
            childId: historical.publicChildId,
            rootTurnId: "user-1",
            rootProviderTurnId: "provider-root-turn",
          }),
        },
      ];

      const initialStore = new SessionStore(dir);
      await initialStore.saveSync(original);
      await initialStore.flushAll();

      const firstRestart = await new SessionStore(dir).load(original.id);
      expect(firstRestart).not.toBeNull();
      expect(historyEntry(firstRestart!, "current-child").codexSubagent).toEqual({
        childId: current.publicChildId,
        rootTurnId: "user-1",
      });
      expect(historyEntry(firstRestart!, "historical-child").codexSubagent).toEqual({
        childId: historical.publicChildId,
      });
      expect(historyEntry(firstRestart!, "misclassified-root").codexSubagent).toBeUndefined();
      expect(firstRestart!.eventBuffer?.[0]?.message.codexSubagent).toEqual({ childId: historical.publicChildId });
      expect(firstRestart!.state.codex_native_subagents).toMatchObject({
        coverage: "partial",
        session: { total: 1 },
      });

      const secondRestart = await new SessionStore(dir).load(original.id);
      expect(secondRestart).not.toBeNull();
      expect(historyEntry(secondRestart!, "current-child").codexSubagent).toEqual({
        childId: current.publicChildId,
        rootTurnId: "user-1",
      });
      expect(historyEntry(secondRestart!, "historical-child").codexSubagent).toEqual({
        childId: historical.publicChildId,
      });
      expect(historyEntry(secondRestart!, "misclassified-root").codexSubagent).toBeUndefined();
      expect(secondRestart!.eventBuffer?.[0]?.message.codexSubagent).toEqual({ childId: historical.publicChildId });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
