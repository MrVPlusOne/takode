import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexAdapter } from "./codex-adapter.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "./session-types.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 1));

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

async function startActiveTurn(adapter: CodexAdapter, stdin: MockWritableStream, stdout: MockReadableStream) {
  adapter.sendBrowserMessage({ type: "user_message", content: "initial turn" } as BrowserOutgoingMessage);
  await tick();

  const rateLimitsRead = parseWrittenJsonLines(stdin.chunks).find((line) => line.method === "rateLimits/read");
  if (typeof rateLimitsRead?.id === "number") {
    stdout.push(JSON.stringify({ id: rateLimitsRead.id, result: {} }) + "\n");
  }
  stdout.push(
    JSON.stringify({ id: findLastRequestId(stdin, "turn/start"), result: { turn: { id: "turn_active" } } }) + "\n",
  );
  await tick();
}

describe("CodexAdapter stale turn/steer recovery", () => {
  let proc: ReturnType<typeof createMockProcess>["proc"];
  let stdin: MockWritableStream;
  let stdout: MockReadableStream;

  beforeEach(() => {
    const mock = createMockProcess();
    proc = mock.proc;
    stdin = mock.stdin;
    stdout = mock.stdout;
  });

  it("clears a matching stale active turn and suppresses no-active-turn steer errors", async () => {
    const emitted: BrowserIncomingMessage[] = [];
    const steerFailed = vi.fn();
    const adapter = new CodexAdapter(proc as never, "test-session", { model: "o4-mini", cwd: "/tmp" });
    adapter.onBrowserMessage((msg) => emitted.push(msg));
    adapter.onTurnSteerFailed(steerFailed);

    await initializeAdapter(stdout);
    await startActiveTurn(adapter, stdin, stdout);

    adapter.sendBrowserMessage({
      type: "codex_steer_pending",
      pendingInputIds: ["pending-follow-up"],
      expectedTurnId: "turn_active",
      inputs: [{ content: "follow-up" }],
    });
    await tick();

    stdout.push(
      JSON.stringify({
        id: findLastRequestId(stdin, "turn/steer"),
        error: { code: -32602, message: "no active turn to steer" },
      }) + "\n",
    );
    await tick();

    expect(adapter.getCurrentTurnId()).toBeNull();
    expect(steerFailed).toHaveBeenCalledWith(["pending-follow-up"]);
    expect(emitted).not.toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("Failed to steer active Codex turn"),
      }),
    );

    stdin.chunks = [];
    adapter.sendBrowserMessage({
      type: "codex_start_pending",
      pendingInputIds: ["pending-follow-up"],
      inputs: [{ content: "follow-up" }],
    });
    await tick();

    const methods = parseWrittenJsonLines(stdin.chunks).map((line) => line.method);
    expect(methods).toContain("turn/start");
    expect(methods).not.toContain("turn/interrupt");
  });

  it("keeps unrelated turn/steer failures visible and leaves the active turn intact", async () => {
    const emitted: BrowserIncomingMessage[] = [];
    const steerFailed = vi.fn();
    const adapter = new CodexAdapter(proc as never, "test-session", { model: "o4-mini", cwd: "/tmp" });
    adapter.onBrowserMessage((msg) => emitted.push(msg));
    adapter.onTurnSteerFailed(steerFailed);

    await initializeAdapter(stdout);
    await startActiveTurn(adapter, stdin, stdout);

    adapter.sendBrowserMessage({
      type: "codex_steer_pending",
      pendingInputIds: ["pending-follow-up"],
      expectedTurnId: "turn_active",
      inputs: [{ content: "follow-up" }],
    });
    await tick();

    stdout.push(
      JSON.stringify({
        id: findLastRequestId(stdin, "turn/steer"),
        error: { code: -32602, message: "input must not be empty" },
      }) + "\n",
    );
    await tick();

    expect(adapter.getCurrentTurnId()).toBe("turn_active");
    expect(steerFailed).toHaveBeenCalledWith(["pending-follow-up"]);
    expect(emitted).toContainEqual(
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("Failed to steer active Codex turn: Error: input must not be empty"),
      }),
    );
  });
});
