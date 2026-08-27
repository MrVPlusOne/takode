import { describe, expect, it } from "vitest";
import {
  applyCodexNativeSubagentEvent,
  createCodexNativeSubagentRegistry,
  deriveCodexNativeSubagentSnapshot,
  markRestoredCodexNativeSubagentsUnknown,
  normalizeCodexNativeSubagentRegistry,
  resolveCodexNativeSubagentProviderThreadId,
  seedCodexNativeSubagentAdapterContext,
  setCodexNativeSubagentTurnCoverage,
  type CodexNativeSubagentProviderEvent,
} from "./codex-native-subagent-state.js";

const statusCounts = (overrides: Partial<Record<string, number>> = {}) => ({
  starting: 0,
  working: 0,
  waiting: 0,
  done: 0,
  failed: 0,
  interrupted: 0,
  unknown: 0,
  ...overrides,
});

function resolver(entries: Record<string, string>) {
  return (providerTurnId: string) => entries[providerTurnId];
}

function applyAll(
  registry: ReturnType<typeof createCodexNativeSubagentRegistry>,
  events: CodexNativeSubagentProviderEvent[],
  rootTurns: Record<string, string>,
) {
  for (const event of events) {
    applyCodexNativeSubagentEvent(registry, event, {
      resolveFeedRootTurnKey: resolver(rootTurns),
      now: event.observedAt ?? 1,
    });
  }
}

describe("Codex native subagent state", () => {
  it("keeps the observed two/three/five scopes distinct and replay-idempotent", () => {
    // Regression contract from the live five-child case: two children were
    // spawned by Alignment, three by Work, and the session total is five.
    const registry = createCodexNativeSubagentRegistry("session-five", { coverage: "complete" });
    const rootTurns = { provider_alignment: "feed-alignment", provider_work: "feed-work" };
    const specs = [
      ["child-a", "provider_alignment", "/root/prior_orientation", 10],
      ["child-b", "provider_alignment", "/root/chatberry_scope_check", 20],
      ["child-c", "provider_work", "/root/agi_trace", 30],
      ["child-d", "provider_work", "/root/standard_pipeline", 40],
      ["child-e", "provider_work", "/root/evidence_limits", 50],
    ] as const;

    for (const [child, rootTurn, path, at] of specs) {
      applyAll(
        registry,
        [
          {
            type: "activity",
            kind: "started",
            providerThreadId: child,
            providerParentThreadId: "provider-root-thread",
            providerEventId: `spawn-${child}`,
            rootProviderTurnId: rootTurn,
            agentPath: path,
            depth: 1,
            observedAt: at,
          },
          {
            type: "turn_started",
            providerThreadId: child,
            providerTurnId: `turn-${child}`,
            startedAt: at + 1,
            observedAt: at + 1,
          },
          {
            type: "turn_completed",
            providerThreadId: child,
            providerTurnId: `turn-${child}`,
            status: "completed",
            completedAt: at + 2,
            observedAt: at + 2,
          },
        ],
        rootTurns,
      );
    }

    const snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.session).toEqual({
      total: 5,
      statusCounts: statusCounts({ done: 5 }),
      activeCount: 0,
      unresolvedCount: 0,
    });
    expect(snapshot.turns["feed-alignment"]).toEqual({
      rootTurnId: "feed-alignment",
      total: 2,
      statusCounts: statusCounts({ done: 2 }),
      status: "done",
      coverage: "complete",
    });
    expect(snapshot.turns["feed-work"]).toEqual({
      rootTurnId: "feed-work",
      total: 3,
      statusCounts: statusCounts({ done: 3 }),
      status: "done",
      coverage: "complete",
    });

    const revisionBeforeReplay = registry.revision;
    const replay = applyCodexNativeSubagentEvent(
      registry,
      {
        type: "activity",
        kind: "started",
        providerThreadId: "child-a",
        providerParentThreadId: "provider-root-thread",
        providerEventId: "spawn-child-a",
        rootProviderTurnId: "provider_alignment",
        agentPath: "/root/prior_orientation",
        depth: 1,
        observedAt: 10,
      },
      { resolveFeedRootTurnKey: resolver(rootTurns) },
    );
    expect(replay.changed).toBe(false);
    expect(registry.revision).toBe(revisionBeforeReplay);
  });

  it("preserves nesting and spawn ownership across interacted activity", () => {
    // interacted is contact with an existing child, not a new spawn and not a
    // reason to move that child into the later root turn's aggregate.
    const registry = createCodexNativeSubagentRegistry("nested-session", { coverage: "complete" });
    const rootTurns = { provider_root_turn: "feed-root", later_turn: "feed-later" };
    applyAll(
      registry,
      [
        {
          type: "activity",
          kind: "started",
          providerThreadId: "parent-child",
          providerParentThreadId: "provider-root-thread",
          providerEventId: "spawn-parent",
          rootProviderTurnId: "provider_root_turn",
          agentPath: "/root/source_audit",
          depth: 1,
          observedAt: 10,
        },
        {
          type: "activity",
          kind: "started",
          providerThreadId: "nested-child",
          providerParentThreadId: "parent-child",
          providerEventId: "spawn-nested",
          agentPath: "/root/source_audit/dependency_check",
          observedAt: 11,
        },
        {
          type: "activity",
          kind: "interacted",
          providerThreadId: "parent-child",
          providerParentThreadId: "provider-root-thread",
          providerEventId: "interaction-1",
          rootProviderTurnId: "later_turn",
          observedAt: 30,
        },
      ],
      rootTurns,
    );

    const snapshot = deriveCodexNativeSubagentSnapshot(registry);
    const parent = snapshot.children.find((child) => child.displayName === "source_audit");
    const nested = snapshot.children.find((child) => child.displayName === "dependency_check");
    expect(parent).toBeDefined();
    expect(nested).toMatchObject({
      parentChildId: parent?.childId,
      rootTurnId: "feed-root",
      depth: 2,
    });
    expect(snapshot.session.total).toBe(2);
    expect(snapshot.turns["feed-root"].total).toBe(2);
    expect(snapshot.turns["feed-later"]).toBeUndefined();
  });

  it("keeps session lifecycle current while freezing the first spawn outcome", () => {
    // A later follow-up can reactivate and fail the child row, but must not
    // rewrite the older root turn's first-task Done aggregate.
    const registry = createCodexNativeSubagentRegistry("follow-up-session", { coverage: "complete" });
    const rootTurns = { provider_root_turn: "feed-root" };
    applyAll(
      registry,
      [
        {
          type: "activity",
          kind: "started",
          providerThreadId: "child-follow-up",
          providerParentThreadId: "provider-root-thread",
          providerEventId: "spawn-follow-up",
          rootProviderTurnId: "provider_root_turn",
          agentPath: "/root/follow_up",
          observedAt: 10,
        },
        {
          type: "thread_status",
          providerThreadId: "child-follow-up",
          status: { type: "active", activeFlags: ["waitingOnApproval"] },
          observedAt: 11,
        },
      ],
      rootTurns,
    );
    expect(deriveCodexNativeSubagentSnapshot(registry).children[0].status).toBe("waiting");

    applyAll(
      registry,
      [
        {
          type: "turn_started",
          providerThreadId: "child-follow-up",
          providerTurnId: "first-task",
          startedAt: 12,
          observedAt: 12,
        },
        {
          type: "turn_completed",
          providerThreadId: "child-follow-up",
          providerTurnId: "first-task",
          status: "completed",
          completedAt: 20,
          observedAt: 20,
        },
        {
          type: "thread_status",
          providerThreadId: "child-follow-up",
          status: "active",
          observedAt: 19,
        },
        {
          type: "thread_status",
          providerThreadId: "child-follow-up",
          status: "notLoaded",
          observedAt: 21,
        },
        {
          type: "thread_status",
          providerThreadId: "child-follow-up",
          status: "idle",
          observedAt: 22,
        },
        {
          type: "thread_status",
          providerThreadId: "child-follow-up",
          status: "closed",
          observedAt: 23,
        },
      ],
      rootTurns,
    );
    let snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.children[0].status).toBe("done");
    expect(snapshot.turns["feed-root"].status).toBe("done");

    applyAll(
      registry,
      [
        {
          type: "turn_started",
          providerThreadId: "child-follow-up",
          providerTurnId: "later-follow-up",
          startedAt: 30,
          observedAt: 30,
        },
        {
          type: "turn_completed",
          providerThreadId: "child-follow-up",
          providerTurnId: "later-follow-up",
          status: "failed",
          completedAt: 40,
          observedAt: 40,
        },
      ],
      rootTurns,
    );
    snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.children[0].status).toBe("failed");
    expect(snapshot.session.statusCounts).toEqual(statusCounts({ failed: 1 }));
    expect(snapshot.turns["feed-root"].statusCounts).toEqual(statusCounts({ done: 1 }));
    expect(snapshot.turns["feed-root"].status).toBe("done");
  });

  it("marks restored active evidence Unknown until newer child evidence arrives", () => {
    // Persisted in-progress state is not live proof after process restart. The
    // original turn aggregate remains Unknown even if a later follow-up works.
    const registry = createCodexNativeSubagentRegistry("restore-session", { coverage: "complete" });
    const rootTurns = { provider_root_turn: "feed-root" };
    applyAll(
      registry,
      [
        {
          type: "activity",
          kind: "started",
          providerThreadId: "stale-child",
          providerParentThreadId: "provider-root-thread",
          providerEventId: "spawn-stale",
          rootProviderTurnId: "provider_root_turn",
          agentPath: "/root/stale",
          observedAt: 10,
        },
        {
          type: "turn_started",
          providerThreadId: "stale-child",
          providerTurnId: "stale-turn",
          startedAt: 11,
          observedAt: 11,
        },
      ],
      rootTurns,
    );
    expect(deriveCodexNativeSubagentSnapshot(registry).children[0].status).toBe("working");

    expect(markRestoredCodexNativeSubagentsUnknown(registry, 100)).toBe(true);
    let snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.children[0].status).toBe("unknown");
    expect(snapshot.turns["feed-root"].status).toBe("unknown");

    applyAll(
      registry,
      [
        {
          type: "turn_started",
          providerThreadId: "stale-child",
          providerTurnId: "fresh-follow-up",
          startedAt: 110,
          observedAt: 110,
        },
      ],
      rootTurns,
    );
    snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.children[0].status).toBe("working");
    expect(snapshot.turns["feed-root"].status).toBe("unknown");
  });

  it("lets explicit first-turn completion supersede earlier interrupt and error evidence", () => {
    const registry = createCodexNativeSubagentRegistry("terminal-precedence", { coverage: "complete" });
    const rootTurns = { provider_root_turn: "feed-root" };
    applyAll(
      registry,
      [
        {
          type: "activity",
          kind: "started",
          providerThreadId: "child-terminal",
          providerEventId: "spawn-terminal",
          rootProviderTurnId: "provider_root_turn",
          agentPath: "/root/terminal",
          observedAt: 10,
        },
        {
          type: "turn_started",
          providerThreadId: "child-terminal",
          providerTurnId: "first-turn",
          observedAt: 11,
        },
        {
          type: "activity",
          kind: "interrupted",
          providerThreadId: "child-terminal",
          providerEventId: "interrupt-before-terminal",
          observedAt: 12,
        },
        {
          type: "child_error",
          providerThreadId: "child-terminal",
          providerTurnId: "first-turn",
          observedAt: 13,
        },
        {
          type: "turn_completed",
          providerThreadId: "child-terminal",
          providerTurnId: "first-turn",
          status: "completed",
          completedAt: 14,
          observedAt: 14,
        },
      ],
      rootTurns,
    );

    const snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.children[0]?.status).toBe("done");
    expect(snapshot.turns["feed-root"]).toMatchObject({
      status: "done",
      statusCounts: statusCounts({ done: 1 }),
    });
  });

  it("keeps unresolved root associations out of browser totals while reporting partial coverage", () => {
    const registry = createCodexNativeSubagentRegistry("unresolved-root", { coverage: "complete" });
    applyCodexNativeSubagentEvent(registry, {
      type: "thread_metadata",
      observedAt: 10,
      thread: {
        id: "provider-unassociated",
        parentThreadId: "provider-root",
        source: {
          subAgent: {
            thread_spawn: { parent_thread_id: "provider-root", depth: 1, agent_path: "/root/unassociated" },
          },
        },
      },
    });

    expect(deriveCodexNativeSubagentSnapshot(registry)).toMatchObject({
      coverage: "partial",
      session: { total: 0, activeCount: 0, unresolvedCount: 0 },
      children: [],
      turns: {},
    });
  });

  it("accepts only verified thread_spawn discovery and preserves conservative statuses", () => {
    // Ordinary forks/manual threads must never enter the native-child index;
    // notLoaded/idle/closed are uncertainty, never terminal success proof.
    const registry = createCodexNativeSubagentRegistry("discovery-session");
    const rootTurns = { provider_root_turn: "feed-root" };

    const rejected = applyCodexNativeSubagentEvent(
      registry,
      {
        type: "thread_metadata",
        rootProviderTurnId: "provider_root_turn",
        observedAt: 10,
        thread: {
          id: "side-chat-thread",
          source: { type: "fork", sideChat: { parentThreadId: "provider-root-thread" } },
          status: "completed",
        },
      },
      { resolveFeedRootTurnKey: resolver(rootTurns) },
    );
    expect(rejected.changed).toBe(false);

    const accepted = applyCodexNativeSubagentEvent(
      registry,
      {
        type: "thread_metadata",
        rootProviderTurnId: "provider_root_turn",
        observedAt: 20,
        thread: {
          id: "native-child",
          nickname: "Noether",
          role: "explorer",
          createdAt: 18,
          status: "notLoaded",
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: "provider-root-thread",
                agent_path: "/root/native_child",
                depth: 1,
                open: true,
              },
            },
          },
        },
      },
      { resolveFeedRootTurnKey: resolver(rootTurns) },
    );
    expect(accepted.changed).toBe(true);

    let snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.session.total).toBe(1);
    expect(snapshot.children[0]).toMatchObject({
      displayName: "native_child",
      nickname: "Noether",
      role: "explorer",
      status: "unknown",
      followUpAvailable: true,
    });

    applyAll(
      registry,
      [
        { type: "child_error", providerThreadId: "native-child", observedAt: 30 },
        {
          type: "owned_message_observed",
          providerThreadId: "native-child",
          providerMessageId: "provider-message-id",
          transcriptAvailability: "partial",
          observedAt: 31,
        },
        { type: "discovery_complete", observedAt: 32 },
      ],
      rootTurns,
    );
    setCodexNativeSubagentTurnCoverage(registry, "feed-root", "complete");
    snapshot = deriveCodexNativeSubagentSnapshot(registry);
    expect(snapshot.coverage).toBe("complete");
    expect(snapshot.children[0]).toMatchObject({ status: "failed", transcriptAvailability: "partial" });
  });

  it("never serializes provider IDs or forbidden raw thread metadata into the public snapshot", () => {
    // Sentinels cover the accepted privacy boundary: compact DTOs may expose
    // only logical agentPath plus bounded labels, never provider/raw context.
    const providerChildId = "provider-child-uuid-PRIVATE";
    const providerRootThreadId = "provider-root-uuid-PRIVATE";
    const providerRootTurnId = "provider-turn-uuid-PRIVATE";
    const forbidden = [
      "ROLLOUT_PATH_SENTINEL",
      "ABSOLUTE_CWD_SENTINEL",
      "ENCRYPTED_PAYLOAD_SENTINEL",
      "INHERITED_PROMPT_SENTINEL",
      "DEVELOPER_INSTRUCTION_SENTINEL",
      "MEMORY_HANDOFF_SENTINEL",
      "REPOSITORY_ORIGIN_SENTINEL",
      "RAW_REASONING_SENTINEL",
      "UNBOUNDED_ERROR_SENTINEL",
    ];
    const registry = createCodexNativeSubagentRegistry("privacy-session");
    applyCodexNativeSubagentEvent(
      registry,
      {
        type: "thread_metadata",
        rootProviderTurnId: providerRootTurnId,
        observedAt: 10,
        thread: {
          id: providerChildId,
          parentThreadId: providerRootThreadId,
          nickname: "Safe nickname",
          role: "explorer",
          path: forbidden[0],
          cwd: forbidden[1],
          encryptedContent: forbidden[2],
          preview: forbidden[3],
          developerInstructions: forbidden[4],
          memoryHandoff: forbidden[5],
          repositoryOrigin: forbidden[6],
          reasoning: { content: forbidden[7] },
          error: forbidden[8],
          source: {
            subAgent: {
              thread_spawn: {
                parent_thread_id: providerRootThreadId,
                agent_path: "/root/privacy_safe",
                depth: 1,
                encrypted_message: forbidden[2],
                prompt: forbidden[3],
              },
            },
          },
        },
      },
      { resolveFeedRootTurnKey: resolver({ [providerRootTurnId]: "feed-safe-root" }) },
    );

    const snapshotJson = JSON.stringify(deriveCodexNativeSubagentSnapshot(registry));
    expect(snapshotJson).not.toContain(providerChildId);
    expect(snapshotJson).not.toContain(providerRootThreadId);
    expect(snapshotJson).not.toContain(providerRootTurnId);
    for (const sentinel of forbidden) expect(snapshotJson).not.toContain(sentinel);
    expect(snapshotJson).toContain("/root/privacy_safe");
    expect(snapshotJson).toContain("feed-safe-root");
  });

  it("uses deterministic session-scoped opaque IDs and normalizes persisted state safely", () => {
    // Opaque IDs must survive restart within one session but differ across
    // sessions, while the reverse provider lookup remains server-only.
    const makeRegistry = (sessionId: string) => {
      const registry = createCodexNativeSubagentRegistry(sessionId, { coverage: "complete" });
      applyCodexNativeSubagentEvent(
        registry,
        {
          type: "activity",
          kind: "started",
          providerThreadId: "provider-child-stable",
          providerParentThreadId: "provider-root-stable",
          providerEventId: "spawn-stable",
          rootProviderTurnId: "provider-turn-stable",
          agentPath: "/root/stable",
          observedAt: 10,
        },
        { resolveFeedRootTurnKey: resolver({ "provider-turn-stable": "feed-stable" }) },
      );
      return registry;
    };

    const first = makeRegistry("same-session");
    const second = makeRegistry("same-session");
    const otherSession = makeRegistry("other-session");
    const firstId = deriveCodexNativeSubagentSnapshot(first).children[0].childId;
    expect(deriveCodexNativeSubagentSnapshot(second).children[0].childId).toBe(firstId);
    expect(deriveCodexNativeSubagentSnapshot(otherSession).children[0].childId).not.toBe(firstId);
    expect(resolveCodexNativeSubagentProviderThreadId(first, firstId)).toBe("provider-child-stable");

    const persisted = JSON.parse(JSON.stringify(first));
    persisted.childrenByProviderThreadId["provider-child-stable"].publicChildId = "provider-child-stable";
    persisted.childrenByProviderThreadId["provider-child-stable"].rawPrompt = "PRIVATE_PROMPT_SENTINEL";
    const normalized = normalizeCodexNativeSubagentRegistry(persisted, "same-session");
    const normalizedSnapshotJson = JSON.stringify(deriveCodexNativeSubagentSnapshot(normalized));
    expect(normalizedSnapshotJson).not.toContain("provider-child-stable");
    expect(normalizedSnapshotJson).not.toContain("PRIVATE_PROMPT_SENTINEL");
    expect(deriveCodexNativeSubagentSnapshot(normalized).children[0].childId).toBe(firstId);

    const adapterContext = seedCodexNativeSubagentAdapterContext(normalized);
    expect(adapterContext.get("provider-child-stable")).toEqual({
      childId: firstId,
      rootTurnId: "feed-stable",
      rootProviderTurnId: "provider-turn-stable",
    });
  });
});
