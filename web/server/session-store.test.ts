import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SessionStore, type PersistedSession } from "./session-store.js";

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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ss-test-"));
  store = new SessionStore(tempDir);
});

afterEach(() => {
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
    expect(loaded).toEqual(session);
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
      eventBuffer: [
        { seq: 1, message: { type: "cli_connected" } },
      ],
      nextEventSeq: 2,
      lastAckSeq: 1,
      processedClientMessageIds: ["client-msg-1", "client-msg-2"],
      archived: true,
    });

    store.saveSync(session);
    await store.flushAll();
    const loaded = await store.load("s2");
    expect(loaded).toEqual(session);
    expect(loaded!.archived).toBe(true);
    expect(loaded!.pendingPermissions).toHaveLength(1);
    expect(loaded!.pendingMessages).toEqual(["msg1", "msg2"]);
    expect(loaded!.eventBuffer).toEqual([{ seq: 1, message: { type: "cli_connected" } }]);
    expect(loaded!.nextEventSeq).toBe(2);
    expect(loaded!.lastAckSeq).toBe(1);
    expect(loaded!.processedClientMessageIds).toEqual(["client-msg-1", "client-msg-2"]);
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
    expect(loaded).toEqual(session);
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
    store.saveSync(makeSession("good"));
    await store.flushAll();
    writeFileSync(join(tempDir, "bad.json"), "not-json!", "utf-8");

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("good");
  });

  it("excludes launcher.json from results", async () => {
    store.saveSync(makeSession("session-1"));
    await store.flushAll();
    store.saveLauncher({ some: "launcher data" });

    const all = await store.loadAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("session-1");
  });

  it("returns an empty array for an empty directory", async () => {
    const all = await store.loadAll();
    expect(all).toEqual([]);
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

  it("returns null when no launcher file exists", async () => {
    const loaded = await store.loadLauncher();
    expect(loaded).toBeNull();
  });
});
