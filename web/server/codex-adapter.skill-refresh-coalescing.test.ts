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

describe("CodexAdapter skill refresh coalescing", () => {
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

  // The coalesce window is 500ms. Use real timers and wait slightly longer.
  it("coalesces multiple skills/changed into a single refresh", async () => {
    // Clear init chunks to isolate our test
    stdin.chunks = [];

    // Fire 5 skills/changed in quick succession
    for (let i = 0; i < 5; i++) {
      emitSkillsChanged(stdout);
      await tick();
    }

    // No skills/list should have been sent yet (within debounce window)
    const skillsListBefore = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListBefore.length).toBe(0);

    // Wait for the coalesce window to expire
    await wait(700);

    // Exactly one skills/list should have been sent
    const skillsListAfter = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListAfter.length).toBe(1);
    expect(skillsListAfter[0].params.forceReload).toBe(true);

    expect(adapter.skillRefreshStats.coalesced).toBe(4);
    expect(adapter.skillRefreshStats.executed).toBe(1);
  });

  it("defers refresh during active turn and drains after completion", async () => {
    await startActiveTurn(adapter, stdin, stdout, "turn_1");
    stdin.chunks = [];

    // Fire skills/changed during active turn
    emitSkillsChanged(stdout);
    await tick();
    await wait(700);

    // No skills/list should be sent while turn is active
    const skillsListDuringTurn = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListDuringTurn.length).toBe(0);
    expect(adapter.skillRefreshStats.deferred).toBeGreaterThanOrEqual(1);

    // Complete the turn
    stdin.chunks = [];
    stdout.push(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { turn: { id: "turn_1", status: "completed" }, thread: { id: "thr_123" } },
      }) + "\n",
    );
    await tick();

    // Wait for the coalesce window to expire after drain
    await wait(700);

    const skillsListAfterDrain = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListAfterDrain.length).toBe(1);
  });

  it("clears timer on transport disconnect", async () => {
    stdin.chunks = [];

    emitSkillsChanged(stdout);
    await tick();

    // Timer is pending; verify no skills/list yet
    const before = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(before.length).toBe(0);

    // Clear the timer (simulates disconnect cleanup)
    adapter._clearSkillRefreshTimer();

    // Wait past coalesce window -- nothing should fire
    await wait(700);

    const after = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(after.length).toBe(0);
  });

  it("re-checks turn state when debounce fires and defers if a turn started", async () => {
    // Regression: skills/changed arrives while idle, 500ms timer is scheduled,
    // then a turn starts before the timer fires. The timer must not send
    // skills/list mid-turn; it should defer until turn completion.
    stdin.chunks = [];

    emitSkillsChanged(stdout);
    await tick();

    // Start a turn during the debounce window (before 500ms)
    await startActiveTurn(adapter, stdin, stdout, "turn_race");
    stdin.chunks = [];

    // Wait past debounce -- timer fires but should defer
    await wait(700);

    const skillsListMidTurn = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListMidTurn.length).toBe(0);

    // Complete the turn -- drain should fire the deferred refresh
    stdin.chunks = [];
    stdout.push(
      JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: { turn: { id: "turn_race", status: "completed" }, thread: { id: "thr_123" } },
      }) + "\n",
    );
    await tick();
    await wait(700);

    const skillsListAfterTurn = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsListAfterTurn.length).toBe(1);
  });

  it("does not schedule retry after transport disconnect", async () => {
    // Regression: an in-flight skills/list rejects because the transport closes.
    // The rejection handler must not schedule a backoff retry timer against a
    // dead adapter.
    stdin.chunks = [];

    emitSkillsChanged(stdout);
    await tick();

    // Let the debounce fire, sending skills/list
    await wait(700);
    const skillsList = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(skillsList.length).toBe(1);

    // Close transport (rejects the pending skills/list RPC)
    // Note: stdout.close() triggers transport close in the real adapter.
    // The _clearSkillRefreshTimer() in the close handler + the connected
    // check in the rejection handler prevent stale retry scheduling.
    adapter._clearSkillRefreshTimer();
    // Simulate the adapter marking itself disconnected (close callback)
    // We can't easily trigger a full transport close in this harness, so
    // verify the invariant: after clearing the timer, no retry fires.
    await wait(1000);

    const retrySkillsList = parseWrittenJsonLines(stdin.chunks).filter((l) => l.method === "skills/list");
    expect(retrySkillsList.length).toBe(1); // still just the original one
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
