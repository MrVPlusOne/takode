import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexAdapter } from "./codex-adapter.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "./session-types.js";

/** Minimal event-loop yield so the ReadableStream reader can process chunks.
 *  Replaces the original 20-50ms setTimeout calls — 1ms is sufficient. */
const tick = () => new Promise<void>((r) => setTimeout(r, 1));

// ─── Mock Subprocess ──────────────────────────────────────────────────────────

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

  close() {
    this.controller?.close();
  }
}

function createMockProcess() {
  const stdinStream = new MockWritableStream();
  const stdoutReadable = new MockReadableStream();
  const stderrReadable = new MockReadableStream();

  let resolveExit: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  const proc = {
    stdin: stdinStream,
    stdout: stdoutReadable.stream,
    stderr: stderrReadable.stream,
    pid: 12345,
    exited: exitPromise,
    kill: vi.fn(),
  };

  return { proc, stdin: stdinStream, stdout: stdoutReadable, stderr: stderrReadable };
}

async function initializeAdapter(stdout: MockReadableStream) {
  stdout.push(JSON.stringify({ id: 1, result: { userAgent: "codex" } }) + "\n");
  await tick();
  stdout.push(JSON.stringify({ id: 2, result: { thread: { id: "thr_123" } } }) + "\n");
  await tick();
}

function parseWrittenJsonLines(chunks: string[]): any[] {
  return chunks
    .join("")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// The adapter routes the browser's sign-in request and Codex's completion
// notification to the MCP manager, with the session's thread for plugin servers.
describe("CodexAdapter MCP sign-in routing", () => {
  it("starts the thread's sign-in and reloads MCP servers when Codex reports it complete", async () => {
    const { proc, stdin, stdout } = createMockProcess();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(proc as never, "test-session", { model: "o4-mini" });
    adapter.onBrowserMessage((msg) => messages.push(msg));
    await tick();
    await initializeAdapter(stdout);
    await tick();

    adapter.sendBrowserMessage({ type: "mcp_sign_in", serverName: "neptune" } as BrowserOutgoingMessage);
    await tick();
    const login = parseWrittenJsonLines(stdin.chunks).find((m) => m.method === "mcpServer/oauth/login");
    expect(login.params).toEqual({ name: "neptune", threadId: "thr_123" });
    stdout.push(
      JSON.stringify({ id: login.id, result: { authorizationUrl: "https://a.example/authorize", loginId: "l1" } }) +
        "\n",
    );
    await tick();
    await tick();

    stdout.push(
      JSON.stringify({
        method: "mcpServer/oauthLogin/completed",
        params: { name: "neptune", loginId: "l1", success: true },
      }) + "\n",
    );
    await tick();
    await tick();
    expect(parseWrittenJsonLines(stdin.chunks).some((m) => m.method === "config/mcpServer/reload")).toBe(true);
  });
});
