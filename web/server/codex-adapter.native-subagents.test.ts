import { describe, expect, it, vi } from "vitest";
import { CodexAdapter } from "./codex-adapter.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import type { CodexNativeSubagentAdapterEvent } from "./codex-native-subagent-adapter-controller.js";

// These fixtures mirror installed Codex 0.144.1 notification shapes. In
// particular, V2 spawn activity may arrive only as item/completed.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

class MockWritableStream {
  chunks: string[] = [];
  private writer = {
    write: async (chunk: Uint8Array) => this.chunks.push(new TextDecoder().decode(chunk)),
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
  push(message: unknown) {
    this.controller?.enqueue(new TextEncoder().encode(`${JSON.stringify(message)}\n`));
  }
}

function createAdapter() {
  const stdin = new MockWritableStream();
  const stdout = new MockReadableStream();
  const stderr = new MockReadableStream();
  const proc = {
    stdin,
    stdout: stdout.stream,
    stderr: stderr.stream,
    pid: 12345,
    exited: new Promise<number>(() => {}),
    kill: vi.fn(),
  };
  return { adapter: new CodexAdapter(proc as never, "native-test", { model: "o4-mini" }), stdout };
}

async function initializeRoot(stdout: MockReadableStream) {
  await tick();
  stdout.push({ id: 1, result: { userAgent: "codex" } });
  await tick();
  stdout.push({ id: 2, result: { thread: { id: "019-root-provider-thread" } } });
  await tick();
}

describe("CodexAdapter native V2 subagents", () => {
  it("keeps provider identity on the private native callback and suppresses child root lifecycle", async () => {
    const { adapter, stdout } = createAdapter();
    const browserMessages: BrowserIncomingMessage[] = [];
    const nativeEvents: CodexNativeSubagentAdapterEvent[] = [];
    adapter.onBrowserMessage((message) => browserMessages.push(message));
    adapter.getNativeSubagentController().onEvent((event) => nativeEvents.push(event));
    await initializeRoot(stdout);

    stdout.push({
      method: "item/completed",
      params: {
        threadId: "019-root-provider-thread",
        turnId: "019-root-provider-turn",
        completedAtMs: 1_787_860_000_000,
        item: {
          type: "subAgentActivity",
          id: "activity-start-1",
          kind: "started",
          agentThreadId: "019-child-provider-thread",
          agentPath: "/root/schema_probe",
        },
      },
    });
    await tick();

    stdout.push({
      method: "turn/started",
      params: {
        threadId: "019-child-provider-thread",
        turn: { id: "019-child-turn", status: "inProgress", items: [], startedAt: 1_787_860_001 },
      },
    });
    stdout.push({
      method: "item/completed",
      params: {
        threadId: "019-child-provider-thread",
        turnId: "019-child-turn",
        completedAtMs: 1_787_860_002_000,
        item: { type: "agentMessage", id: "child-message-1", text: "Child-owned result" },
      },
    });
    stdout.push({
      method: "turn/completed",
      params: {
        threadId: "019-child-provider-thread",
        turn: {
          id: "019-child-turn",
          status: "completed",
          items: [],
          startedAt: 1_787_860_001,
          completedAt: 1_787_860_003,
        },
      },
    });
    await tick();

    expect(nativeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "activity",
          childProviderThreadId: "019-child-provider-thread",
          senderProviderTurnId: "019-root-provider-turn",
          eventId: "activity-start-1",
        }),
        expect.objectContaining({
          type: "turn_started",
          childProviderThreadId: "019-child-provider-thread",
          childProviderTurnId: "019-child-turn",
        }),
        expect.objectContaining({
          type: "owned_message",
          source: expect.objectContaining({
            providerThreadId: "019-child-provider-thread",
            providerTurnId: "019-child-turn",
          }),
          message: expect.objectContaining({ type: "assistant" }),
        }),
        expect.objectContaining({
          type: "turn_completed",
          childProviderThreadId: "019-child-provider-thread",
          status: "completed",
        }),
      ]),
    );
    expect(JSON.stringify(browserMessages)).not.toContain("019-child-provider-thread");
    expect(
      browserMessages.some(
        (message) =>
          message.type === "assistant" &&
          message.message.content.some((block) => block.type === "text" && block.text === "Child-owned result"),
      ),
    ).toBe(false);
    expect(browserMessages.some((message) => message.type === "result")).toBe(false);
  });

  it("keeps installed child error notifications out of root failure state", async () => {
    const { adapter, stdout } = createAdapter();
    const browserMessages: BrowserIncomingMessage[] = [];
    const nativeEvents: CodexNativeSubagentAdapterEvent[] = [];
    adapter.onBrowserMessage((message) => browserMessages.push(message));
    adapter.getNativeSubagentController().onEvent((event) => nativeEvents.push(event));
    await initializeRoot(stdout);

    stdout.push({
      method: "turn/started",
      params: {
        threadId: "019-root-provider-thread",
        turn: { id: "019-root-live-turn", status: "inProgress", items: [], startedAt: 1_787_860_020 },
      },
    });
    stdout.push({
      method: "item/completed",
      params: {
        threadId: "019-root-provider-thread",
        turnId: "019-root-live-turn",
        item: {
          type: "subAgentActivity",
          id: "activity-child-error",
          kind: "started",
          agentThreadId: "019-child-error-thread",
          agentPath: "/root/error_child",
        },
      },
    });
    stdout.push({
      method: "codex/event/error",
      params: {
        threadId: "019-child-error-thread",
        turnId: "019-child-error-turn",
        msg: { message: "write_stdin failed: child-only router failure" },
      },
    });
    stdout.push({
      method: "turn/completed",
      params: {
        threadId: "019-root-provider-thread",
        turn: {
          id: "019-root-live-turn",
          status: "completed",
          items: [],
          startedAt: 1_787_860_020,
          completedAt: 1_787_860_021,
        },
      },
    });
    await tick();

    expect(nativeEvents).toContainEqual(
      expect.objectContaining({
        type: "child_error",
        childProviderThreadId: "019-child-error-thread",
        childProviderTurnId: "019-child-error-turn",
      }),
    );
    expect(
      browserMessages.some(
        (message) => message.type === "error" && message.message.includes("child-only router failure"),
      ),
    ).toBe(false);
    expect(browserMessages).toContainEqual(
      expect.objectContaining({
        type: "result",
        data: expect.objectContaining({ subtype: "success", is_error: false }),
      }),
    );
  });

  it("deduplicates interacted activity as the same provider child identity", async () => {
    const { adapter, stdout } = createAdapter();
    const nativeEvents: CodexNativeSubagentAdapterEvent[] = [];
    adapter.getNativeSubagentController().onEvent((event) => nativeEvents.push(event));
    await initializeRoot(stdout);

    for (const [id, kind] of [
      ["activity-start", "started"],
      ["activity-interact", "interacted"],
    ] as const) {
      stdout.push({
        method: "item/completed",
        params: {
          threadId: "019-root-provider-thread",
          turnId: "019-root-provider-turn",
          completedAtMs: 1_787_860_010_000,
          item: {
            type: "subAgentActivity",
            id,
            kind,
            agentThreadId: "019-one-child",
            agentPath: "/root/one_child",
          },
        },
      });
    }
    await tick();

    const activity = nativeEvents.filter((event) => event.type === "activity");
    expect(activity).toHaveLength(2);
    expect(new Set(activity.map((event) => event.type === "activity" && event.childProviderThreadId))).toEqual(
      new Set(["019-one-child"]),
    );
  });
  it("keeps the provider root out of child ownership after a child sends to its parent", async () => {
    // This sequence mirrors the post-restart rollout: root starts a child, then
    // the child emits interacted activity whose target/path are the root.
    const { adapter, stdout } = createAdapter();
    const browserMessages: BrowserIncomingMessage[] = [];
    const nativeEvents: CodexNativeSubagentAdapterEvent[] = [];
    adapter.onBrowserMessage((message) => browserMessages.push(message));
    adapter.getNativeSubagentController().onEvent((event) => nativeEvents.push(event));
    await initializeRoot(stdout);

    stdout.push({
      method: "item/completed",
      params: {
        threadId: "019-root-provider-thread",
        turnId: "019-root-provider-turn",
        item: {
          type: "subAgentActivity",
          id: "activity-start-child",
          kind: "started",
          agentThreadId: "019-child-provider-thread",
          agentPath: "/root/post_restart_ui_check",
        },
      },
    });
    stdout.push({
      method: "item/completed",
      params: {
        threadId: "019-child-provider-thread",
        turnId: "019-child-provider-turn",
        item: {
          type: "subAgentActivity",
          id: "activity-child-to-root",
          kind: "interacted",
          agentThreadId: "019-root-provider-thread",
          agentPath: "/root",
        },
      },
    });
    stdout.push({
      method: "item/completed",
      params: {
        threadId: "019-root-provider-thread",
        turnId: "019-root-provider-turn",
        item: { type: "agentMessage", id: "root-message-after-child", text: "Root-owned reply" },
      },
    });
    await tick();

    expect(
      nativeEvents.some(
        (event) => event.type === "activity" && event.childProviderThreadId === "019-root-provider-thread",
      ),
    ).toBe(false);
    expect(adapter.getNativeSubagentController().isKnownChildProviderThreadId("019-root-provider-thread")).toBe(false);
    expect(browserMessages).toContainEqual(
      expect.objectContaining({
        type: "assistant",
        message: expect.objectContaining({
          content: expect.arrayContaining([expect.objectContaining({ type: "text", text: "Root-owned reply" })]),
        }),
      }),
    );
    expect(
      browserMessages.some(
        (message) =>
          message.type === "assistant" && message.message.id === "root-message-after-child" && !!message.codexSubagent,
      ),
    ).toBe(false);
  });
});
