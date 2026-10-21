import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "./session-store.js";
import {
  MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME,
  MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME,
} from "./model-provenance-migration-acknowledgement-store.js";
import { searchSessionDocuments } from "./session-search.js";
import { buildSessionActivityRecord } from "./activity-stream.js";
import type { BrowserIncomingMessage } from "./session-types.js";

let tempDir: string;
let store: SessionStore;

function makeSession(id: string, overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    id,
    state: {
      session_id: id,
      model: "claude-sonnet-4-5-20250929",
      cwd: "/test",
      tools: [],
      permissionMode: "default",
      claude_code_version: "1.0.0",
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
    },
    messageHistory: [],
    pendingMessages: [],
    pendingPermissions: [],
    ...overrides,
  };
}

/** Helper: build a minimal completed turn (user → assistant → result). */
function makeTurnMessages(turnIndex: number): PersistedSession["messageHistory"] {
  return [
    { type: "user_message", content: `Turn ${turnIndex} question`, timestamp: Date.now() + turnIndex * 1000 },
    {
      type: "assistant",
      message: {
        id: `msg-${turnIndex}`,
        role: "assistant",
        model: "claude-sonnet-4-5-20250929",
        content: [
          { type: "text", text: `Turn ${turnIndex} answer` },
          { type: "tool_use", id: `tu-${turnIndex}`, name: "Read", input: {} },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: Date.now() + turnIndex * 1000 + 500,
      turn_duration_ms: 1200,
    },
    {
      type: "result",
      data: { type: "result", subtype: "success", uuid: `result-${turnIndex}` },
    },
  ] as PersistedSession["messageHistory"];
}

/** Helper: build tool results for a turn. */
function makeToolResults(turnIndex: number): NonNullable<PersistedSession["toolResults"]> {
  return [
    [
      `tu-${turnIndex}`,
      { content: `Tool result for turn ${turnIndex}`, is_error: false, timestamp: Date.now() + turnIndex * 1000 + 600 },
    ],
  ];
}

function makeToolResultPreviewMessage(
  toolUseId: string,
  content = `Preview for ${toolUseId}`,
): PersistedSession["messageHistory"][number] {
  return {
    type: "tool_result_preview",
    previews: [
      {
        tool_use_id: toolUseId,
        content,
        is_error: false,
        total_size: content.length,
        is_truncated: false,
      },
    ],
  } as PersistedSession["messageHistory"][number];
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ss-test-"));
  store = new SessionStore(tempDir);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
});

// ─── saveSync / load ──────────────────────────────────────────────────────────

describe("saveSync / load", () => {
  it("writes a session to disk and reads it back", async () => {
    const session = makeSession("s1");
    store.saveSync(session);
    await store.flushAll();

    const filePath = join(tempDir, "s1.json");
    expect(existsSync(filePath)).toBe(true);

    const loaded = await store.load("s1");
    // load() adds bookkeeping fields (_frozenCount, _frozenToolResultCount, toolResults)
    expect(loaded!.id).toBe("s1");
    expect(loaded!.messageHistory).toEqual([]);
    expect(loaded!.pendingMessages).toEqual([]);
    expect(loaded!.state).toEqual(session.state);
  });

  it("persists requested and runtime-effective Codex reasoning independently", async () => {
    // Requested effort drives relaunch; the runtime report is separate browser/server
    // evidence and must survive restore without being collapsed into the request.
    const session = makeSession("codex-reasoning", {
      state: {
        ...makeSession("codex-reasoning").state,
        backend_type: "codex",
        codex_reasoning_effort: "ultra",
        codex_effective_reasoning_effort: "high",
        codex_effective_reasoning_effort_reported: true,
      },
    });
    store.saveSync(session);
    await store.flushAll();

    expect((await store.load("codex-reasoning"))?.state).toMatchObject({
      codex_reasoning_effort: "ultra",
      codex_effective_reasoning_effort: "high",
      codex_effective_reasoning_effort_reported: true,
    });
  });

  it("persists context usage history outside browser session state", async () => {
    const session = makeSession("usage-history", {
      contextUsageHistory: [{ timestamp: 1, source: "codex_token_usage", contextUsedPercent: 12 }],
    });
    store.saveSync(session);
    await store.flushAll();

    const loaded = await store.load("usage-history");

    expect(loaded?.contextUsageHistory).toEqual([
      { timestamp: 1, source: "codex_token_usage", contextUsedPercent: 12 },
    ]);
    expect(loaded?.state).not.toHaveProperty("contextUsageHistory");
  });

  it("returns null for a non-existent session", async () => {
    const loaded = await store.load("does-not-exist");
    expect(loaded).toBeNull();
  });

  it("returns null for a corrupt JSON file", async () => {
    writeFileSync(join(tempDir, "corrupt.json"), "{{not valid json!!", "utf-8");
    const loaded = await store.load("corrupt");
    expect(loaded).toBeNull();
  });

  it("preserves all session fields through round-trip", async () => {
    const session = makeSession("s2", {
      messageHistory: [{ type: "error", message: "test error" }],
      pendingMessages: ["msg1", "msg2"],
      pendingCodexTurns: [
        {
          adapterMsg: { type: "user_message", content: "retry persisted turn" },
          userMessageId: "user-persisted-1",
          userContent: "retry persisted turn",
          historyIndex: 0,
          status: "backend_acknowledged",
          dispatchCount: 1,
          createdAt: 1700000000000,
          updatedAt: 1700000001000,
          acknowledgedAt: 1700000000500,
          turnTarget: "current",
          lastError: null,
          turnId: "turn-persisted-1",
          disconnectedAt: 1700000000000,
          resumeConfirmedAt: null,
        },
      ],
      pendingPermissions: [
        [
          "req-1",
          {
            request_id: "req-1",
            tool_name: "Write",
            input: { path: "/tmp/test.txt" },
            tool_use_id: "tu-1",
            timestamp: Date.now(),
          },
        ],
      ],
      eventBuffer: [{ seq: 1, message: { type: "backend_connected" } }],
      nextEventSeq: 2,
      lastAckSeq: 1,
      processedClientMessageIds: ["client-msg-1", "client-msg-2"],
      archived: true,
    });

    store.saveSync(session);
    await store.flushAll();
    const loaded = await store.load("s2");
    // load() adds bookkeeping fields; check essential fields individually
    expect(loaded!.id).toBe("s2");
    expect(loaded!.archived).toBe(true);
    expect(loaded!.pendingPermissions).toHaveLength(1);
    expect(loaded!.pendingMessages).toEqual(["msg1", "msg2"]);
    expect(loaded!.pendingCodexTurns).toEqual(session.pendingCodexTurns);
    expect(loaded!.eventBuffer).toEqual([{ seq: 1, message: { type: "backend_connected" } }]);
    expect(loaded!.nextEventSeq).toBe(2);
    expect(loaded!.lastAckSeq).toBe(1);
    expect(loaded!.processedClientMessageIds).toEqual(["client-msg-1", "client-msg-2"]);
  });

  it("removes legacy non-replayable eventBuffer entries on load and rewrites hot JSON", async () => {
    // Legacy persisted replay buffers can contain global snapshots that current
    // runtime buffering rejects; loading should scrub them and persist the repair.
    const session = makeSession("legacy-buffer", {
      eventBuffer: [
        { seq: 1, message: { type: "backend_connected" } },
        {
          seq: 2,
          message: {
            type: "tree_groups_update",
            treeGroups: [{ id: "default", name: "Default" }],
            treeAssignments: { "session-1": "default" },
            treeNodeOrder: { default: ["session-1"] },
          },
        },
        { seq: 3, message: { type: "session_name_update", name: "Old Name" } },
        { seq: 4, message: { type: "event_replay", events: [] } },
        {
          seq: 5,
          message: {
            type: "codex_pending_inputs",
            inputs: [{ id: "pending-1", content: "x".repeat(128), timestamp: 1, cancelable: true }],
          },
        },
      ] as PersistedSession["eventBuffer"],
      nextEventSeq: 6,
      lastAckSeq: 1,
    });
    writeFileSync(join(tempDir, "legacy-buffer.json"), JSON.stringify(session), "utf-8");

    const freshStore = new SessionStore(tempDir);
    const loaded = await freshStore.load("legacy-buffer");

    expect(loaded!.eventBuffer).toEqual([{ seq: 1, message: { type: "backend_connected" } }]);
    expect(loaded!.nextEventSeq).toBe(6);
    expect(loaded!.lastAckSeq).toBe(1);

    await freshStore.flushAll();
    const hotRaw = JSON.parse(readFileSync(join(tempDir, "legacy-buffer.json"), "utf-8"));
    expect(hotRaw.eventBuffer).toEqual([{ seq: 1, message: { type: "backend_connected" } }]);
  });

  it("drops quest invalidations but keeps replayable legacy eventBuffer entries when sanitizing persisted buffers", async () => {
    // Quest list invalidations are global cache-bust signals, not per-session
    // replay state. Normal replayable events remain persisted so browser
    // reconnect semantics do not change in this pass.
    const session = makeSession("replayable-buffer", {
      eventBuffer: [
        { seq: 1, message: { type: "quest_list_updated" } },
        { seq: 2, message: { type: "pr_status_update", pr: null, available: false } },
        { seq: 3, message: { type: "session_created", session_id: "created-session" } },
      ] as PersistedSession["eventBuffer"],
    });
    writeFileSync(join(tempDir, "replayable-buffer.json"), JSON.stringify(session), "utf-8");

    const loaded = await store.load("replayable-buffer");

    expect(loaded!.eventBuffer).toEqual([
      { seq: 2, message: { type: "pr_status_update", pr: null, available: false } },
      { seq: 3, message: { type: "session_created", session_id: "created-session" } },
    ]);
  });

  it("drops legacy top-level leader text stream deltas while keeping worker/nested stream deltas", async () => {
    const base = makeSession("leader-replay-buffer");
    const session: PersistedSession = {
      ...base,
      state: { ...base.state, isOrchestrator: true },
      eventBuffer: [
        {
          seq: 1,
          message: {
            type: "stream_event",
            parent_tool_use_id: null,
            event: { type: "content_block_delta", delta: { type: "text_delta", text: "[thread:main] " } },
          },
        },
        {
          seq: 2,
          message: {
            type: "stream_event",
            parent_tool_use_id: "agent-1",
            event: { type: "content_block_delta", delta: { type: "text_delta", text: "nested" } },
          },
        },
        {
          seq: 3,
          message: {
            type: "stream_event",
            parent_tool_use_id: null,
            event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "reasoning" } },
          },
        },
      ] as PersistedSession["eventBuffer"],
    };
    writeFileSync(join(tempDir, "leader-replay-buffer.json"), JSON.stringify(session), "utf-8");

    const loaded = await store.load("leader-replay-buffer");

    expect(loaded!.eventBuffer).toEqual([session.eventBuffer![1], session.eventBuffer![2]]);
  });

  it("saveSync/load preserves codexFreshTurnRequiredUntilTurnId", async () => {
    const session = makeSession("s2-codex-fresh-turn", {
      codexFreshTurnRequiredUntilTurnId: "turn-plan-1",
    });

    store.saveSync(session);
    await store.flushAll();
    const loaded = await store.load("s2-codex-fresh-turn");

    expect(loaded!.codexFreshTurnRequiredUntilTurnId).toBe("turn-plan-1");
  });
});

// ─── save (debounced) ─────────────────────────────────────────────────────────

describe("save (debounced)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not write immediately", () => {
    const session = makeSession("debounce-1");
    store.save(session);

    const filePath = join(tempDir, "debounce-1.json");
    expect(existsSync(filePath)).toBe(false);
  });

  it("writes after the 150ms debounce period", async () => {
    const session = makeSession("debounce-2");
    store.save(session);

    vi.advanceTimersByTime(150);
    // Await the async writeFile triggered by the timer
    await store.flushAll();

    const filePath = join(tempDir, "debounce-2.json");
    expect(existsSync(filePath)).toBe(true);

    const loaded = await store.load("debounce-2");
    // load() adds bookkeeping fields; check essential fields
    expect(loaded!.id).toBe("debounce-2");
    expect(loaded!.messageHistory).toEqual([]);
    expect(loaded!.pendingMessages).toEqual([]);
  });

  it("coalesces rapid calls and only writes the last version", async () => {
    const session1 = makeSession("debounce-3", {
      pendingMessages: ["first"],
    });
    const session2 = makeSession("debounce-3", {
      pendingMessages: ["second"],
    });
    const session3 = makeSession("debounce-3", {
      pendingMessages: ["third"],
    });

    store.save(session1);
    vi.advanceTimersByTime(50);
    store.save(session2);
    vi.advanceTimersByTime(50);
    store.save(session3);

    // Not yet written (timer restarted with session3)
    expect(existsSync(join(tempDir, "debounce-3.json"))).toBe(false);

    vi.advanceTimersByTime(150);
    // Await the async writeFile triggered by the timer
    await store.flushAll();

    const loaded = await store.load("debounce-3");
    expect(loaded!.pendingMessages).toEqual(["third"]);
  });
});

// ─── loadAll ──────────────────────────────────────────────────────────────────

describe("loadAll", () => {
  it("returns all saved sessions", async () => {
    store.saveSync(makeSession("a"));
    store.saveSync(makeSession("b"));
    store.saveSync(makeSession("c"));
    await store.flushAll();

    const all = await store.loadAll();
    const ids = all.map((s) => s.id).sort();
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("skips corrupt JSON files", async () => {
    // A truncated hot file is a read failure: startup reports which file it skipped, leaves it on
    // disk, and does not log it as a failed persist (which misdirected an earlier investigation).
    store.saveSync(makeSession("good"));
    await store.flushAll();
    writeFileSync(join(tempDir, "bad.json"), '{"id":"bad","state":{"x":"unterminated', "utf-8");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
    expect(warnSpy.mock.calls.map(([message]) => String(message))).toContainEqual(
      expect.stringContaining(`Skipping unreadable session file ${join(tempDir, "bad.json")}`),
    );
    expect(errorSpy).not.toHaveBeenCalled();
    expect(readFileSync(join(tempDir, "bad.json"), "utf-8")).toBe('{"id":"bad","state":{"x":"unterminated');
  });

  it("excludes launcher.json from results", async () => {
    store.saveSync(makeSession("session-1"));
    await store.flushAll();
    store.saveLauncher({ some: "launcher data" });

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("session-1");
  });

  it("excludes the model-provenance acknowledgement sidecar from session discovery", async () => {
    // Committed and interrupted-candidate server state share the directory but neither is a session record.
    const contents = JSON.stringify({ version: 1, acknowledgements: { "event-a": 123 } });
    await writeFile(join(tempDir, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME), contents, "utf8");
    await writeFile(join(tempDir, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME), "partial", "utf8");

    expect(await store.loadAll()).toEqual([]);
    expect(await readFile(join(tempDir, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_FILENAME), "utf8")).toBe(contents);
    expect(await readFile(join(tempDir, MODEL_PROVENANCE_MIGRATION_ACKNOWLEDGEMENTS_TEMP_FILENAME), "utf8")).toBe(
      "partial",
    );
  });

  it("returns an empty array for an empty directory", async () => {
    const all = await store.loadAll();
    expect(all).toEqual([]);
  });

  it("logs startup restore metrics while sanitizing active sessions", async () => {
    // Startup uses loadAll(), not direct load(); cover active cleanup, archived
    // search-only restore, corrupt-file skips, and launcher-state metric output together.
    const activeSession = makeSession("active-metrics", {
      messageHistory: [{ type: "user_message", content: "active", timestamp: 1 }],
      eventBuffer: [
        { seq: 1, message: { type: "backend_connected" } },
        {
          seq: 2,
          message: {
            type: "tree_groups_update",
            treeGroups: [{ id: "default", name: "Default" }],
            treeAssignments: { "active-metrics": "default" },
            treeNodeOrder: { default: ["active-metrics"] },
          },
        },
      ] as PersistedSession["eventBuffer"],
      nextEventSeq: 3,
      lastAckSeq: 1,
    });
    const archivedSession = makeSession("archived-metrics", {
      archived: true,
      archivedAt: 1700000000000,
      messageHistory: [{ type: "user_message", content: "archived", timestamp: 2 }],
      _searchExcerpts: [{ type: "user_message", content: "archived", timestamp: 2 }],
    });

    store.saveSync(activeSession);
    store.saveSync(archivedSession);
    store.saveLauncher([
      { sessionId: "active-metrics", state: "connected", cwd: "/tmp", createdAt: 1 },
      { sessionId: "archived-metrics", state: "exited", cwd: "/tmp", createdAt: 2 },
      { sessionId: "other-running", state: "running", cwd: "/tmp", createdAt: 3 },
    ]);
    await store.flushAll();
    writeFileSync(join(tempDir, "corrupt.json"), "{not-json", "utf-8");

    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const all = await store.loadAll();
    await store.flushAll();

    expect(all.map((session) => session.id).sort()).toEqual(["active-metrics", "archived-metrics"]);
    expect(all.find((session) => session.id === "active-metrics")!.eventBuffer).toEqual([
      { seq: 1, message: { type: "backend_connected" } },
    ]);
    expect(all.find((session) => session.id === "archived-metrics")!._searchDataOnly).toBe(true);

    const log = infoSpy.mock.calls.map(([message]) => String(message)).join("\n");
    expect(log).toContain("Restored 2 session(s)");
    expect(log).toContain("(active=1, searchOnly=1, skipped=1)");
    expect(log).toContain("launcherStates=[connected:1, exited:1, running:1]");
    expect(log).toContain("historyMsgs=1");
    expect(log).toContain("eventBuffer 2->1");
    expect(log).toContain("dropped=1/");
    expect(log).toContain("[tree_groups_update:1/");

    const repairedHot = JSON.parse(readFileSync(join(tempDir, "active-metrics.json"), "utf-8"));
    expect(repairedHot.eventBuffer).toEqual([{ seq: 1, message: { type: "backend_connected" } }]);
  });

  it("treats launcher-archived Codex sessions as search-only even when hot JSON lacks archived flag", async () => {
    // Regression coverage for stale Codex pending delivery warnings: launcher
    // archive state is authoritative when older hot session JSON missed the
    // archived flag, so stale pending inputs do not restore as active sessions.
    const launcherArchived = makeSession("launcher-archived-codex", {
      state: {
        ...makeSession("launcher-archived-codex").state,
        backend_type: "codex",
      },
      messageHistory: [{ type: "user_message", content: "old archived turn", timestamp: 1 }],
      pendingCodexInputs: [
        {
          id: "pending-archived",
          content: "stale archived input",
          timestamp: 1,
          cancelable: true,
        },
      ],
    });
    const exitedButActive = makeSession("exited-but-active-codex", {
      state: {
        ...makeSession("exited-but-active-codex").state,
        backend_type: "codex",
      },
      messageHistory: [{ type: "user_message", content: "active tail", timestamp: 2 }],
      pendingCodexInputs: [
        {
          id: "pending-active",
          content: "still active input",
          timestamp: 2,
          cancelable: true,
        },
      ],
    });

    store.saveSync(launcherArchived);
    store.saveSync(exitedButActive);
    store.saveLauncher([
      {
        sessionId: "launcher-archived-codex",
        state: "exited",
        archived: true,
        archivedAt: 1700000000000,
      },
      {
        sessionId: "exited-but-active-codex",
        state: "exited",
        archived: false,
      },
    ]);
    await store.flushAll();

    const all = await store.loadAll();

    const archived = all.find((session) => session.id === "launcher-archived-codex")!;
    expect(archived.archived).toBe(true);
    expect(archived.archivedAt).toBe(1700000000000);
    expect(archived._searchDataOnly).toBe(true);
    expect(archived.messageHistory).toEqual([]);
    expect(archived.pendingCodexInputs).toBeUndefined();

    const active = all.find((session) => session.id === "exited-but-active-codex")!;
    expect(active._searchDataOnly).toBeUndefined();
    expect(active.pendingCodexInputs).toHaveLength(1);
  });

  it("extracts search excerpts for launcher-archived sessions that never persisted archive excerpts", async () => {
    // Launcher archive state can predate hot JSON archived metadata. When that
    // happens, search-only restore must still preserve message-content search.
    const session = makeSession("launcher-archived-without-excerpts", {
      state: {
        ...makeSession("launcher-archived-without-excerpts").state,
        backend_type: "codex",
      },
      messageHistory: [
        {
          type: "user_message",
          id: "user-needle",
          content: "legacy archived needle message",
          timestamp: 1700000000123,
        },
      ],
      pendingCodexInputs: [
        {
          id: "pending-archived",
          content: "stale archived input",
          timestamp: 1,
          cancelable: true,
        },
      ],
    });

    store.saveSync(session);
    store.saveLauncher([
      {
        sessionId: session.id,
        state: "exited",
        archived: true,
        archivedAt: 1700000000000,
      },
    ]);
    await store.flushAll();

    const all = await store.loadAll();
    const archived = all.find((candidate) => candidate.id === session.id)!;

    expect(archived._searchDataOnly).toBe(true);
    expect(archived.messageHistory).toEqual([]);
    expect(archived.pendingCodexInputs).toBeUndefined();
    expect(archived._searchExcerpts).toEqual([
      {
        type: "user_message",
        id: "user-needle",
        content: "legacy archived needle message",
        timestamp: 1700000000123,
      },
    ]);

    const search = searchSessionDocuments(
      [
        {
          sessionId: archived.id,
          archived: true,
          createdAt: 0,
          lastActivityAt: 1700000000123,
          messageHistory: archived.messageHistory,
          searchExcerpts: archived._searchExcerpts,
        },
      ],
      { query: "archived needle" },
    );
    expect(search.results[0]?.sessionId).toBe(session.id);
    expect(search.results[0]?.matchedField).toBe("user_message");
  });
});

// ─── setArchived ──────────────────────────────────────────────────────────────

describe("setArchived", () => {
  it("sets archived flag to true and persists it", async () => {
    store.saveSync(makeSession("arch-1"));
    await store.flushAll();
    const result = await store.setArchived("arch-1", true);
    await store.flushAll();

    expect(result).toBe(true);

    const loaded = await store.load("arch-1");
    expect(loaded!.archived).toBe(true);
  });

  it("sets archived flag to false and persists it", async () => {
    store.saveSync(makeSession("arch-2", { archived: true }));
    await store.flushAll();
    const result = await store.setArchived("arch-2", false);
    await store.flushAll();

    expect(result).toBe(true);

    const loaded = await store.load("arch-2");
    expect(loaded!.archived).toBe(false);
  });

  it("returns false for a non-existent session", async () => {
    const result = await store.setArchived("no-such-session", true);
    expect(result).toBe(false);
  });

  it("saves the session's activity record when archiving, and removing the session deletes it", async () => {
    // Listing an archived session's activity later reads this record instead of its whole history.
    const history = [
      { type: "user_message", id: "m1", content: "Please check the build", timestamp: 100 },
    ] as BrowserIncomingMessage[];
    store.saveSync(makeSession("arch-3", { messageHistory: history }));
    await store.flushAll();
    expect(await store.loadActivityRecord("arch-3")).toBeNull();

    await store.setArchived("arch-3", true);
    expect(await store.loadActivityRecord("arch-3")).toEqual(buildSessionActivityRecord(history, false));

    store.remove("arch-3");
    await store.flushAll();
    expect(await store.loadActivityRecord("arch-3")).toBeNull();
  });
});

// ─── remove ───────────────────────────────────────────────────────────────────

describe("remove", () => {
  it("deletes the session file from disk", async () => {
    store.saveSync(makeSession("rm-1"));
    await store.flushAll();
    expect(existsSync(join(tempDir, "rm-1.json"))).toBe(true);

    store.remove("rm-1");
    // remove() uses async unlink internally — flush to await it
    await store.flushAll();
    expect(existsSync(join(tempDir, "rm-1.json"))).toBe(false);
    expect(await store.load("rm-1")).toBeNull();
  });

  it("deletes both hot JSON and frozen log", async () => {
    // Build a session with a completed turn so it creates a frozen log
    const turn1 = makeTurnMessages(1);
    const session = makeSession("rm-frozen", {
      messageHistory: turn1,
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    expect(existsSync(join(tempDir, "rm-frozen.json"))).toBe(true);
    expect(existsSync(join(tempDir, "rm-frozen.history.jsonl"))).toBe(true);

    store.remove("rm-frozen");
    await store.flushAll();
    expect(existsSync(join(tempDir, "rm-frozen.json"))).toBe(false);
    expect(existsSync(join(tempDir, "rm-frozen.history.jsonl"))).toBe(false);
    expect(await store.load("rm-frozen")).toBeNull();
  });

  it("cancels a pending debounced save so it never writes", () => {
    vi.useFakeTimers();
    try {
      const session = makeSession("rm-2");
      store.save(session);

      // Remove before the debounce fires
      store.remove("rm-2");

      // Advance past the debounce window
      vi.advanceTimersByTime(300);

      expect(existsSync(join(tempDir, "rm-2.json"))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not throw when removing a non-existent session", () => {
    expect(() => store.remove("ghost-session")).not.toThrow();
  });
});

// ─── saveLauncher / loadLauncher ──────────────────────────────────────────────

describe("saveLauncher / loadLauncher", () => {
  it("writes and reads launcher data", async () => {
    const data = { pids: [123, 456], lastBoot: "2025-01-01T00:00:00Z" };
    store.saveLauncher(data);
    await store.flushAll();

    const loaded = await store.loadLauncher<{ pids: number[]; lastBoot: string }>();
    expect(loaded).toEqual(data);
  });

  it("persists requested Codex effort for relaunch", async () => {
    const data = [{ sessionId: "s1", codexReasoningEffort: "ultra" }];
    store.saveLauncher(data);
    await store.flushAll();

    expect(await store.loadLauncher()).toEqual(data);
  });

  it("returns null when no launcher file exists", async () => {
    const loaded = await store.loadLauncher();
    expect(loaded).toBeNull();
  });
});

// ─── Append-only frozen history ──────────────────────────────────────────────

describe("append-only frozen history", () => {
  it("freezes completed turns to JSONL and keeps hot tail small", async () => {
    // Simulate a session with one completed turn + one in-progress turn.
    // Completed turn: user_message → assistant → result
    // In-progress: user_message → assistant (no result yet)
    const turn1 = makeTurnMessages(1);
    const inProgress = [
      { type: "user_message", content: "Still thinking...", timestamp: Date.now() + 5000 },
      {
        type: "assistant",
        message: {
          id: "msg-ip",
          role: "assistant",
          model: "claude-sonnet-4-5-20250929",
          content: [{ type: "text", text: "Working..." }],
          stop_reason: null,
          usage: null,
        },
        parent_tool_use_id: null,
        timestamp: Date.now() + 5500,
      },
    ] as PersistedSession["messageHistory"];

    const session = makeSession("freeze-1", {
      messageHistory: [...turn1, ...inProgress],
      toolResults: makeToolResults(1),
    });

    store.saveSync(session);
    await store.flushAll();

    // Frozen log should exist with the completed turn
    expect(existsSync(join(tempDir, "freeze-1.history.jsonl"))).toBe(true);

    // Hot JSON should only contain the in-progress messages
    const hotRaw = JSON.parse(readFileSync(join(tempDir, "freeze-1.json"), "utf-8"));
    expect(hotRaw._frozenCount).toBe(3); // 3 messages frozen (user + assistant + result)
    expect(hotRaw.messageHistory).toHaveLength(2); // the 2 in-progress messages
    expect(hotRaw.messageHistory[0].type).toBe("user_message");
    expect(hotRaw.messageHistory[0].content).toBe("Still thinking...");

    // Load should reconstruct the full history
    const loaded = await store.load("freeze-1");
    expect(loaded!.messageHistory).toHaveLength(5); // 3 frozen + 2 hot
    expect(loaded!.messageHistory[0].type).toBe("user_message");
    expect((loaded!.messageHistory[0] as { content: string }).content).toBe("Turn 1 question");
    expect(loaded!.messageHistory[3].type).toBe("user_message");
    expect((loaded!.messageHistory[3] as { content: string }).content).toBe("Still thinking...");
  });

  it("incrementally appends new turns without rewriting old ones", async () => {
    // Save after turn 1
    const turn1 = makeTurnMessages(1);
    const session = makeSession("incr-1", {
      messageHistory: [...turn1],
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    const logAfterTurn1 = readFileSync(join(tempDir, "incr-1.history.jsonl"), "utf-8");
    const linesAfterTurn1 = logAfterTurn1.split("\n").filter((l) => l.trim());
    // Header + 3 messages + 1 tool results batch = 5 lines
    expect(linesAfterTurn1.length).toBe(5);

    // Add turn 2 and save again
    const turn2 = makeTurnMessages(2);
    session.messageHistory = [...turn1, ...turn2];
    session.toolResults = [...makeToolResults(1), ...makeToolResults(2)];
    store.saveSync(session);
    await store.flushAll();

    const logAfterTurn2 = readFileSync(join(tempDir, "incr-1.history.jsonl"), "utf-8");
    const linesAfterTurn2 = logAfterTurn2.split("\n").filter((l) => l.trim());
    // Previous 5 lines + 3 new messages + 1 tool results batch = 9 lines
    expect(linesAfterTurn2.length).toBe(9);

    // Verify the JSONL starts with the same content (append-only)
    expect(logAfterTurn2.startsWith(logAfterTurn1)).toBe(true);

    // Load should reconstruct full history
    const loaded = await store.load("incr-1");
    expect(loaded!.messageHistory).toHaveLength(6); // 3 + 3
    expect(loaded!.toolResults).toHaveLength(2);
  });

  it("does not create a frozen log when no turn is completed", async () => {
    // Only in-progress messages (no result)
    const session = makeSession("no-freeze", {
      messageHistory: [
        { type: "user_message", content: "Hello", timestamp: Date.now() },
        {
          type: "assistant",
          message: {
            id: "msg-1",
            role: "assistant",
            model: "claude-sonnet-4-5-20250929",
            content: [{ type: "text", text: "Hi!" }],
            stop_reason: null,
            usage: null,
          },
          parent_tool_use_id: null,
          timestamp: Date.now(),
        },
      ] as PersistedSession["messageHistory"],
    });

    store.saveSync(session);
    await store.flushAll();

    // No JSONL should be created
    expect(existsSync(join(tempDir, "no-freeze.history.jsonl"))).toBe(false);

    // Hot JSON should contain all messages
    const loaded = await store.load("no-freeze");
    expect(loaded!.messageHistory).toHaveLength(2);
    expect(loaded!._frozenCount).toBe(0); // no frozen messages, but count is tracked
  });

  it("handles backward compatibility with legacy format (no JSONL)", async () => {
    // Write a session in the old format (full history in JSON, no _frozenCount)
    const legacySession = makeSession("legacy", {
      messageHistory: makeTurnMessages(1),
      toolResults: makeToolResults(1),
    });
    // Write directly without using the store (simulates old format)
    writeFileSync(join(tempDir, "legacy.json"), JSON.stringify(legacySession), "utf-8");

    // Load with new store — should work and return full history
    const loaded = await store.load("legacy");
    expect(loaded).not.toBeNull();
    expect(loaded!.messageHistory).toHaveLength(3);
    expect(loaded!.toolResults).toHaveLength(1);

    // Saving again should create the frozen log
    store.saveSync(loaded!);
    await store.flushAll();
    expect(existsSync(join(tempDir, "legacy.history.jsonl"))).toBe(true);
  });

  it("recovers from crash between JSONL append and hot JSON write", async () => {
    // Simulate: JSONL has more frozen messages than the hot JSON expects.
    // This happens if the server crashed after appending to JSONL but before
    // writing the updated hot JSON.

    // Save a session with turn 1 — both files are consistent
    const turn1 = makeTurnMessages(1);
    const session = makeSession("crash-1", {
      messageHistory: [...turn1],
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    // Now simulate: turn 2 was appended to JSONL, but hot JSON wasn't updated.
    // Manually append turn 2 to the JSONL:
    const turn2 = makeTurnMessages(2);
    let appendData = "";
    for (const msg of turn2) {
      appendData += JSON.stringify(msg) + "\n";
    }
    const turn2ToolResults = makeToolResults(2);
    appendData += JSON.stringify({ _toolResults: turn2ToolResults }) + "\n";
    const { appendFile: appendFileSync } = await import("node:fs/promises");
    await appendFileSync(join(tempDir, "crash-1.history.jsonl"), appendData, "utf-8");

    // Hot JSON still thinks only 3 messages are frozen (turn 1)
    // But JSONL now has 6 messages (turn 1 + turn 2)
    // The hot JSON's messageHistory contains turn 2 messages (they overlap)
    const hotRaw = JSON.parse(readFileSync(join(tempDir, "crash-1.json"), "utf-8"));
    expect(hotRaw._frozenCount).toBe(3);

    // Rewrite hot JSON to simulate the stale state: it still has turn2 messages
    // in its hot tail (since the hot JSON write didn't happen after freeze)
    hotRaw.messageHistory = turn2;
    hotRaw.toolResults = turn2ToolResults;
    writeFileSync(join(tempDir, "crash-1.json"), JSON.stringify(hotRaw), "utf-8");

    // Load should detect the overlap and not duplicate messages
    // Create a fresh store so there's no in-memory frozen count
    const freshStore = new SessionStore(tempDir);
    const loaded = await freshStore.load("crash-1");
    expect(loaded).not.toBeNull();
    // Should have 6 messages total (3 from turn 1 + 3 from turn 2), not 9
    expect(loaded!.messageHistory).toHaveLength(6);
    expect((loaded!.messageHistory[0] as { content: string }).content).toBe("Turn 1 question");
    expect((loaded!.messageHistory[3] as { content: string }).content).toBe("Turn 2 question");
  });

  it("repairs duplicate replay-generated tool_result_preview hot tails on load and rewrites the hot JSON", async () => {
    const frozenTurn = makeTurnMessages(1);
    const repeatedPreview = makeToolResultPreviewMessage("tu-replayed", "Replay-generated preview");
    const uniquePreview = makeToolResultPreviewMessage("tu-unique", "Latest preview");

    const session = makeSession("repair-preview-tail", {
      messageHistory: [...frozenTurn, repeatedPreview, uniquePreview],
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    const hotPath = join(tempDir, "repair-preview-tail.json");
    const hotRaw = JSON.parse(readFileSync(hotPath, "utf-8"));
    hotRaw.messageHistory = [
      repeatedPreview,
      uniquePreview,
      repeatedPreview,
      uniquePreview,
      repeatedPreview,
      uniquePreview,
    ];
    writeFileSync(hotPath, JSON.stringify(hotRaw), "utf-8");

    const freshStore = new SessionStore(tempDir);
    const loaded = await freshStore.load("repair-preview-tail");
    expect(loaded).not.toBeNull();
    expect(loaded!.messageHistory).toEqual([...frozenTurn, repeatedPreview, uniquePreview]);

    await freshStore.flushAll();
    const repairedHotRaw = JSON.parse(readFileSync(hotPath, "utf-8"));
    expect(repairedHotRaw.messageHistory).toEqual([repeatedPreview, uniquePreview]);
    expect(repairedHotRaw.messageHistory).toHaveLength(2);
  });

  it("does not trim unique in-progress tool_result_preview tails while saving", async () => {
    const session = makeSession("keep-unique-preview-tail", {
      messageHistory: [
        makeToolResultPreviewMessage("tu-a", "First unique preview"),
        makeToolResultPreviewMessage("tu-b", "Second unique preview"),
      ],
    });

    store.saveSync(session);
    await store.flushAll();

    expect(session.messageHistory).toEqual([
      makeToolResultPreviewMessage("tu-a", "First unique preview"),
      makeToolResultPreviewMessage("tu-b", "Second unique preview"),
    ]);

    const loaded = await store.load("keep-unique-preview-tail");
    expect(loaded!.messageHistory).toEqual([
      makeToolResultPreviewMessage("tu-a", "First unique preview"),
      makeToolResultPreviewMessage("tu-b", "Second unique preview"),
    ]);
  });

  it("trims duplicate replay-generated tool_result_preview tails on save without mutating live session", async () => {
    // saveSync must NOT mutate the live session's messageHistory array.
    // Mutating it would invalidate the ws-bridge's frozenCount and cause
    // "frozen prefix hash mismatch" on the next browser reconnect.
    const repeatedPreview = makeToolResultPreviewMessage("tu-replayed", "Replay-generated preview");
    const uniquePreview = makeToolResultPreviewMessage("tu-unique", "Latest preview");
    const session = makeSession("trim-loaded-preview-tail", {
      messageHistory: [repeatedPreview, uniquePreview, repeatedPreview, uniquePreview, repeatedPreview],
    });

    const originalLength = session.messageHistory.length;
    store.saveSync(session);
    await store.flushAll();

    // Live session's messageHistory must remain untouched
    expect(session.messageHistory.length).toBe(originalLength);

    // But the persisted version should have duplicates trimmed
    const loaded = await store.load("trim-loaded-preview-tail");
    expect(loaded!.messageHistory).toEqual([repeatedPreview, uniquePreview]);
  });

  it("handles corrupt/truncated JSONL lines gracefully", async () => {
    // Save a completed turn
    const session = makeSession("corrupt-log", {
      messageHistory: makeTurnMessages(1),
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    // Corrupt the last line of the JSONL by truncating it
    const logPath = join(tempDir, "corrupt-log.history.jsonl");
    const logContent = readFileSync(logPath, "utf-8");
    const lines = logContent.split("\n").filter((l) => l.trim());
    // Replace last line with truncated JSON
    lines[lines.length - 1] = '{"type":"result","data":{"type"';
    writeFileSync(logPath, lines.join("\n") + "\n", "utf-8");

    // Load should skip the corrupt line and still work
    const freshStore = new SessionStore(tempDir);
    const loaded = await freshStore.load("corrupt-log");
    expect(loaded).not.toBeNull();
    // We should get at least the non-corrupt messages
    expect(loaded!.messageHistory.length).toBeGreaterThan(0);
  });

  it("does not re-freeze already-frozen messages on repeated saves", async () => {
    // Save session with completed turn
    const turn1 = makeTurnMessages(1);
    const session = makeSession("no-refreeze", {
      messageHistory: [...turn1],
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    const logAfterFirst = readFileSync(join(tempDir, "no-refreeze.history.jsonl"), "utf-8");

    // Save again with the same history (no new turn)
    store.saveSync(session);
    await store.flushAll();

    const logAfterSecond = readFileSync(join(tempDir, "no-refreeze.history.jsonl"), "utf-8");

    // JSONL should be identical (no duplicate appends)
    expect(logAfterSecond).toBe(logAfterFirst);
  });

  it("hot JSON stays small during active streaming", async () => {
    // Simulate: turn 1 completed, turn 2 in progress with many messages
    const turn1 = makeTurnMessages(1);
    const manyStreamMessages = Array.from({ length: 100 }, (_, i) => ({
      type: "stream_event" as const,
      event: { content: `Streaming chunk ${i}` },
      parent_tool_use_id: null,
    })) as PersistedSession["messageHistory"];

    const session = makeSession("hot-small", {
      messageHistory: [...turn1, ...manyStreamMessages],
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    // Hot JSON should only have the 100 stream messages, not the 103 total
    const hotRaw = JSON.parse(readFileSync(join(tempDir, "hot-small.json"), "utf-8"));
    expect(hotRaw.messageHistory).toHaveLength(100);
    expect(hotRaw._frozenCount).toBe(3);

    // Full load should reconstruct all 103
    const loaded = await store.load("hot-small");
    expect(loaded!.messageHistory).toHaveLength(103);
  });

  it("tool results are frozen alongside messages", async () => {
    const turn1 = makeTurnMessages(1);
    const turn2 = makeTurnMessages(2);
    const session = makeSession("tool-freeze", {
      messageHistory: [...turn1, ...turn2],
      toolResults: [...makeToolResults(1), ...makeToolResults(2)],
    });
    store.saveSync(session);
    await store.flushAll();

    // Hot JSON should have no tool results (both turns completed = all frozen)
    const hotRaw = JSON.parse(readFileSync(join(tempDir, "tool-freeze.json"), "utf-8"));
    expect(hotRaw.toolResults).toHaveLength(0);
    expect(hotRaw._frozenToolResultCount).toBe(2);

    // Load should reconstruct all tool results
    const loaded = await store.load("tool-freeze");
    expect(loaded!.toolResults).toHaveLength(2);
    expect(loaded!.toolResults![0][0]).toBe("tu-1");
    expect(loaded!.toolResults![1][0]).toBe("tu-2");
  });

  it("loadAll excludes .history.jsonl files from session list", async () => {
    // Save a session with a completed turn (creates both files)
    const session = makeSession("listed", {
      messageHistory: makeTurnMessages(1),
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    // Verify both files exist
    expect(existsSync(join(tempDir, "listed.json"))).toBe(true);
    expect(existsSync(join(tempDir, "listed.history.jsonl"))).toBe(true);

    // loadAll should return exactly one session (not two)
    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("listed");
    expect(all[0].messageHistory).toHaveLength(3);
  });

  it("empty history session has no frozen log", async () => {
    const session = makeSession("empty-hist");
    store.saveSync(session);
    await store.flushAll();

    expect(existsSync(join(tempDir, "empty-hist.history.jsonl"))).toBe(false);

    const loaded = await store.load("empty-hist");
    expect(loaded!.messageHistory).toHaveLength(0);
  });

  it("setArchived works with split persistence", async () => {
    // Create session with a completed turn (so frozen log exists)
    const session = makeSession("arch-frozen", {
      messageHistory: makeTurnMessages(1),
      toolResults: makeToolResults(1),
    });
    store.saveSync(session);
    await store.flushAll();

    const result = await store.setArchived("arch-frozen", true);
    await store.flushAll();

    expect(result).toBe(true);
    const loaded = await store.load("arch-frozen");
    expect(loaded!.archived).toBe(true);
    // History should still be intact
    expect(loaded!.messageHistory).toHaveLength(3);
    expect(loaded!.toolResults).toHaveLength(1);
  });
});
