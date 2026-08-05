import { describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "./codex-adapter.js";
import type { BrowserIncomingMessage } from "./session-types.js";

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

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
  readonly stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      this.controller = controller;
    },
  });
  push(data: string) {
    this.controller?.enqueue(new TextEncoder().encode(data));
  }
}

function createMockProcess() {
  const stdin = new MockWritableStream();
  const stdout = new MockReadableStream();
  return {
    stdin,
    stdout,
    proc: {
      stdin,
      stdout: stdout.stream,
      stderr: new MockReadableStream().stream,
      pid: 12345,
      exited: new Promise<number>(() => {}),
      kill: vi.fn(),
    },
  };
}

async function initialize(stdout: MockReadableStream) {
  stdout.push(JSON.stringify({ id: 1, result: { userAgent: "codex" } }) + "\n");
  await tick();
  stdout.push(JSON.stringify({ id: 2, result: { thread: { id: "thread-goal" } } }) + "\n");
  await tick();
  stdout.push(JSON.stringify({ id: 3, result: {} }) + "\n");
  await tick();
}

describe("CodexAdapter Goal support", () => {
  it("initializes with unknown Goal capability and applies Goal update/clear notifications", async () => {
    const { proc, stdout } = createMockProcess();
    const messages: BrowserIncomingMessage[] = [];
    const adapter = new CodexAdapter(proc as never, "session-goal", { model: "gpt-5.5" });
    adapter.onBrowserMessage((message) => messages.push(message));
    await initialize(stdout);

    const init = messages.find((message) => message.type === "session_init");
    expect(init?.type === "session_init" ? init.session.codex_goal_capability?.state : null).toBe("unknown");

    stdout.push(
      JSON.stringify({
        method: "thread/goal/updated",
        params: {
          goal: {
            threadId: "thread-goal",
            objective: "Finish verification",
            status: "usageLimited",
            tokenBudget: 1000,
            tokensUsed: 1200,
            timeUsedSeconds: 60,
            createdAt: "2026-08-05T00:00:00.000Z",
            updatedAt: "2026-08-05T00:01:00.000Z",
          },
        },
      }) + "\n",
    );
    await tick();

    const goalUpdate = messages.find(
      (message) => message.type === "session_update" && message.session.codex_goal?.objective === "Finish verification",
    );
    expect(goalUpdate?.type === "session_update" ? goalUpdate.session.codex_goal?.status : null).toBe("usage_limited");

    stdout.push(
      JSON.stringify({
        method: "thread/goal/cleared",
        params: { threadId: "thread-goal" },
      }) + "\n",
    );
    await tick();

    const clearUpdate = messages.find(
      (message) =>
        message.type === "session_update" &&
        Object.prototype.hasOwnProperty.call(message.session, "codex_goal") &&
        message.session.codex_goal === null,
    );
    expect(clearUpdate).toBeDefined();
    expect(adapter.getCurrentTurnId()).toBeNull();
  });

  it("marks current-thread backend turn starts as Codex Goal continuations", async () => {
    const { proc, stdout } = createMockProcess();
    const adapter = new CodexAdapter(proc as never, "session-goal", { model: "gpt-5.5" });
    const started: Array<{ turnId: string; source?: string }> = [];
    adapter.onTurnStarted((turnId, source) => started.push({ turnId, source }));
    await initialize(stdout);

    stdout.push(
      JSON.stringify({
        method: "turn/started",
        params: { threadId: "thread-goal", turn: { id: "turn-goal" } },
      }) + "\n",
    );
    await tick();

    expect(adapter.getCurrentTurnId()).toBe("turn-goal");
    expect(started).toEqual([{ turnId: "turn-goal", source: "codex_goal_continuation" }]);
  });
});
