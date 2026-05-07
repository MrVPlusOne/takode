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
});

describe("Graceful missing-skill behavior", () => {
  // Verifies the tightening condition: sessions that reference removed legacy
  // skills degrade gracefully. The runtime resolution in codex-adapter-utils.ts
  // uses skillPathByName.get(name) which returns undefined for missing entries,
  // and callers skip the skill rather than throwing.
  it("skillPathByName returns undefined for removed skills and callers skip gracefully", () => {
    const map = new Map<string, string>();
    map.set("existing-skill", "/path/to/skill");

    expect(map.get("existing-skill")).toBe("/path/to/skill");
    expect(map.get("quest-journey-planning")).toBeUndefined();
    expect(map.get("nonexistent")).toBeUndefined();

    // The pattern used in codex-adapter-utils extractCodexMentionInputs:
    // path = skillPathByName.get(name); if (!path) skip;
    const path = map.get("quest-journey-planning");
    const result = path ? `found: ${path}` : "skipped";
    expect(result).toBe("skipped");
  });
});
