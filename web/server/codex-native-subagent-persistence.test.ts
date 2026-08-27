import { describe, expect, it, vi } from "vitest";
import { applyCodexNativeSubagentEvent, deriveCodexNativeSubagentSnapshot } from "./codex-native-subagent-state.js";
import {
  buildPersistedSessionPayload,
  getOrCreateSession,
  restorePersistedSessions,
} from "./bridge/session-registry-controller.js";
import type { SessionState } from "./session-types.js";

function state(sessionId: string): SessionState {
  return {
    session_id: sessionId,
    backend_type: "codex",
    backend_state: "disconnected",
    model: "o4-mini",
    cwd: "/tmp",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
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

const restoreDeps = {
  recoverToolStartTimesFromHistory: vi.fn(),
  finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
  scheduleCodexToolResultWatchdogs: vi.fn(),
  reconcileRestoredBoardState: vi.fn(async () => {}),
  resumeRecoveryDeliveryTransfers: vi.fn(async () => {}),
};

describe("Codex native subagent persistence", () => {
  it("round-trips the private provider index while restoring stale live status as Unknown", async () => {
    const sessions = new Map<string, any>();
    const original = getOrCreateSession(sessions, "persist-native", "codex", {
      makeDefaultState: (sessionId) => state(sessionId),
    });
    applyCodexNativeSubagentEvent(
      original.codexNativeSubagents,
      {
        type: "activity",
        kind: "started",
        providerThreadId: "provider-child-private",
        providerEventId: "spawn-1",
        rootProviderTurnId: "provider-root-turn",
        agentPath: "/root/persistence_probe",
        observedAt: 1_787_860_000_000,
      },
      { resolveFeedRootTurnKey: () => "feed-turn-safe" },
    );
    applyCodexNativeSubagentEvent(original.codexNativeSubagents, {
      type: "turn_started",
      providerThreadId: "provider-child-private",
      providerTurnId: "provider-child-turn",
      observedAt: 1_787_860_001_000,
    });
    applyCodexNativeSubagentEvent(original.codexNativeSubagents, {
      type: "discovery_complete",
      observedAt: 1_787_860_002_000,
    });
    original.state.codex_native_subagents = deriveCodexNativeSubagentSnapshot(original.codexNativeSubagents);
    expect(original.state.codex_native_subagents.coverage).toBe("complete");

    const persisted = buildPersistedSessionPayload(original);
    expect(JSON.stringify(persisted.state)).not.toContain("provider-child-private");
    expect(JSON.stringify(persisted.codexNativeSubagents)).toContain("provider-child-private");
    const opaqueId = persisted.state.codex_native_subagents?.children[0]?.childId;

    const restoredSessions = new Map<string, any>();
    await restorePersistedSessions(restoredSessions, [JSON.parse(JSON.stringify(persisted))], restoreDeps);
    const restored = restoredSessions.get("persist-native");

    expect(restored.codexNativeSubagents.childrenByProviderThreadId["provider-child-private"]).toBeDefined();
    expect(restored.state.codex_native_subagents.children[0]).toMatchObject({
      childId: opaqueId,
      status: "unknown",
      rootTurnId: "feed-turn-safe",
    });
    expect(restored.state.codex_native_subagents.turns["feed-turn-safe"]).toMatchObject({
      total: 1,
      status: "unknown",
      coverage: "partial",
    });
    expect(restored.state.codex_native_subagents.coverage).toBe("partial");
  });

  it("does not restore an authoritative complete zero before fresh descendant discovery", async () => {
    const sessions = new Map<string, any>();
    const original = getOrCreateSession(sessions, "persist-native-empty", "codex", {
      makeDefaultState: (sessionId) => state(sessionId),
    });
    applyCodexNativeSubagentEvent(original.codexNativeSubagents, {
      type: "discovery_complete",
      observedAt: 1_787_860_000_000,
    });
    original.state.codex_native_subagents = deriveCodexNativeSubagentSnapshot(original.codexNativeSubagents);
    expect(original.state.codex_native_subagents).toMatchObject({ coverage: "complete", session: { total: 0 } });

    const restoredSessions = new Map<string, any>();
    await restorePersistedSessions(
      restoredSessions,
      [JSON.parse(JSON.stringify(buildPersistedSessionPayload(original)))],
      restoreDeps,
    );

    expect(restoredSessions.get("persist-native-empty").state.codex_native_subagents).toMatchObject({
      coverage: "partial",
      session: { total: 0 },
    });
  });
});
