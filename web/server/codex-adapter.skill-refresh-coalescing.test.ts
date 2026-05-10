import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexAdapter } from "./codex-adapter.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "./session-types.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 1));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class MockWritableStream {
  chunks: string[] = [];
  private writer = {
    write: async (chunk: Uint8Array) => {
      this.chunks.push(new TextDecoder().decode(chunk));
    },
    releaseLock: () => {},
  };
  getWriter() {
    return this.writer;
  }
}

class MockReadableStream {
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly stream: ReadableStream<Uint8Array>;

  constructor() {
    this.stream = new ReadableStream({
      start: (controller) => {
        this.controller = controller;
      },
    });
  }

  push(data: string) {
    this.controller?.enqueue(new TextEncoder().encode(data));
  }
}

function createMockProcess() {
  const stdinStream = new MockWritableStream();
  const stdoutReadable = new MockReadableStream();
  const stderrReadable = new MockReadableStream();

  const proc = {
    stdin: stdinStream,
    stdout: stdoutReadable.stream,
    stderr: stderrReadable.stream,
    pid: 12345,
    exited: new Promise<number>(() => {}),
    kill: vi.fn(),
  };

  return { proc, stdin: stdinStream, stdout: stdoutReadable, stderr: stderrReadable };
}

function parseWrittenJsonLines(chunks: string[]): any[] {
  return chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function findLastRequestId(stdin: MockWritableStream, method: string): number {
  const request = parseWrittenJsonLines(stdin.chunks)
    .filter((line) => line.method === method)
    .at(-1);
  expect(request?.id).toEqual(expect.any(Number));
  return request.id;
}

async function initializeAdapter(stdout: MockReadableStream): Promise<void> {
  stdout.push(JSON.stringify({ id: 1, result: { userAgent: "codex" } }) + "\n");
  await tick();
  stdout.push(JSON.stringify({ id: 2, result: { thread: { id: "thr_123" } } }) + "\n");
  await tick();
}

async function startActiveTurn(
  adapter: CodexAdapter,
  stdin: MockWritableStream,
  stdout: MockReadableStream,
  turnId = "turn_active",
) {
  adapter.sendBrowserMessage({ type: "user_message", content: "test" } as BrowserOutgoingMessage);
  await tick();

  const rateLimitsRead = parseWrittenJsonLines(stdin.chunks).find((line) => line.method === "rateLimits/read");
  if (typeof rateLimitsRead?.id === "number") {
    stdout.push(JSON.stringify({ id: rateLimitsRead.id, result: {} }) + "\n");
  }
  stdout.push(JSON.stringify({ id: findLastRequestId(stdin, "turn/start"), result: { turn: { id: turnId } } }) + "\n");
  await tick();
}

function emitSkillsChanged(stdout: MockReadableStream) {
  stdout.push(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "skills/changed",
      params: {},
    }) + "\n",
  );
}

describe("CodexAdapter skill change suppression", () => {
  let proc: ReturnType<typeof createMockProcess>["proc"];
  let stdin: MockWritableStream;
  let stdout: MockReadableStream;
  let adapter: CodexAdapter;
  let messages: BrowserIncomingMessage[];

  beforeEach(async () => {
    ({ proc, stdin, stdout } = createMockProcess());
    messages = [];
    adapter = new CodexAdapter(proc as any, "test-session", {
      model: "codex-mini-latest",
      cwd: "/tmp/test",
    });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    adapter.onDisconnect(() => {});
    await initializeAdapter(stdout);
  });

  it("marks skill and app metadata stale without sending an automatic refresh", async () => {
    stdin.chunks = [];

    emitSkillsChanged(stdout);
    await tick();

    const written = parseWrittenJsonLines(stdin.chunks);
    expect(written.filter((l) => l.method === "skills/list")).toHaveLength(0);
    expect(written.filter((l) => l.method === "app/list")).toHaveLength(0);

    const update = messages.find((msg) => msg.type === "session_update" && "skills_stale" in msg.session);
    expect(update).toEqual(
      expect.objectContaining({
        session: expect.objectContaining({
          skills_stale: true,
          apps_stale: true,
          skills_stale_since: expect.any(Number),
          skills_last_changed_at: expect.any(Number),
          skills_last_change_reason: "skills_changed",
          skills_change_count: 1,
        }),
      }),
    );
    expect(adapter.skillRefreshStats.suppressed).toBe(1);
    expect(adapter.skillRefreshStats.executed).toBe(0);
  });

  it("records repeated skills/changed notifications without coalescing them into refreshes", async () => {
    stdin.chunks = [];

    for (let i = 0; i < 5; i++) {
      emitSkillsChanged(stdout);
      await tick();
    }

    const written = parseWrittenJsonLines(stdin.chunks);
    expect(written.filter((l) => l.method === "skills/list")).toHaveLength(0);
    expect(written.filter((l) => l.method === "app/list")).toHaveLength(0);
    expect(adapter.skillRefreshStats.suppressed).toBe(5);
    expect(adapter.skillRefreshStats.executed).toBe(0);

    const staleUpdates = messages.filter(
      (msg): msg is Extract<BrowserIncomingMessage, { type: "session_update" }> =>
        msg.type === "session_update" && "skills_change_count" in msg.session,
    );
    expect(staleUpdates.at(-1)?.session).toEqual(
      expect.objectContaining({
        skills_stale: true,
        apps_stale: true,
        skills_change_count: 5,
      }),
    );
  });

  it("does not drain an automatic refresh after an active turn completes", async () => {
    await startActiveTurn(adapter, stdin, stdout, "turn_1");
    stdin.chunks = [];

    emitSkillsChanged(stdout);
    await tick();

    const skillsListDuringTurn = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListDuringTurn).toHaveLength(0);
    expect(adapter.skillRefreshStats.suppressed).toBe(1);

    stdin.chunks = [];
    stdout.push(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { turn: { id: "turn_1", status: "completed" }, thread: { id: "thr_123" } },
      }) + "\n",
    );
    await tick();

    const skillsListAfterDrain = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListAfterDrain).toHaveLength(0);
  });

  it("clear refresh timer remains a no-op compatibility cleanup", async () => {
    stdin.chunks = [];

    emitSkillsChanged(stdout);
    await tick();

    const before = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(before).toHaveLength(0);

    adapter._clearSkillRefreshTimer();
    await wait(20);

    const after = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(after).toHaveLength(0);
  });

  it("manual refresh still fetches skills and apps and clears stale metadata", async () => {
    stdin.chunks = [];

    emitSkillsChanged(stdout);
    await tick();
    stdin.chunks = [];

    const refreshPromise = adapter.refreshSkills(true);
    await tick();

    const skillsReq = parseWrittenJsonLines(stdin.chunks).find((l) => l.method === "skills/list");
    expect(skillsReq).toBeDefined();
    expect(skillsReq.params).toEqual({ cwds: ["/tmp/test"], forceReload: true });

    stdout.push(
      JSON.stringify({
        id: skillsReq.id,
        result: {
          data: [
            {
              cwd: "/tmp/test",
              skills: [{ name: "review", path: "/skills/review/SKILL.md", enabled: true }],
              errors: [],
            },
          ],
        },
      }) + "\n",
    );
    await tick();
    const appReq = parseWrittenJsonLines(stdin.chunks).find((l) => l.method === "app/list");
    expect(appReq).toBeDefined();
    stdout.push(JSON.stringify({ id: appReq.id, result: { data: [], nextCursor: null } }) + "\n");

    await expect(refreshPromise).resolves.toEqual(["review"]);
    const lastUpdate = messages.filter((msg) => msg.type === "session_update").at(-1);
    expect(lastUpdate?.session).toEqual(
      expect.objectContaining({
        skills: ["review"],
        skills_stale: false,
        apps_stale: false,
        skills_stale_since: null,
        skills_last_change_reason: null,
        skills_change_count: 1,
      }),
    );
  });
});

describe("Graceful missing-skill behavior", () => {
  // Verifies the tightening condition: sessions referencing removed legacy
  // skills degrade gracefully via the real extractCodexMentionInputs utility.
  it("extractCodexMentionInputs silently skips removed skills", async () => {
    const { extractCodexMentionInputs } = await import("./codex-adapter-utils.js");

    const skillPathByName = new Map<string, string>();
    skillPathByName.set("active-skill", "/home/user/.agents/skills/active-skill");

    // Text references both an active skill and a removed deprecated skill
    const text = "Use $active-skill and $quest-journey-planning for this task";
    const mentions = extractCodexMentionInputs(text, skillPathByName);

    // Active skill is found, deprecated skill is silently skipped
    expect(mentions).toEqual([{ type: "skill", name: "active-skill", path: "/home/user/.agents/skills/active-skill" }]);
    expect(mentions.find((m) => m.name === "quest-journey-planning")).toBeUndefined();
  });
});
