import { describe, expect, it } from "vitest";
import { JsonRpcTransport } from "./codex-jsonrpc-transport.js";

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

describe("JsonRpcTransport diagnostics", () => {
  it("captures close context, pending request methods, and recent RPC summaries", async () => {
    const stdin = new MockWritableStream();
    const stdout = new MockReadableStream();
    const transport = new JsonRpcTransport(stdin as never, stdout.stream, "session-1");
    const rawIncoming: string[] = [];
    const secondRawIncoming: string[] = [];
    transport.onRawIncoming((line) => rawIncoming.push(line));
    transport.onRawIncoming((line) => secondRawIncoming.push(line));

    const request = transport.request("skills/list", { forceReload: true });
    const rejected = request.promise.then(
      () => {
        throw new Error("expected request to reject");
      },
      (err: unknown) => err as Error,
    );
    await transport.notify("initialized", {});
    await tick();

    stdout.push(JSON.stringify({ method: "skills/changed", params: {} }) + "\n");
    await tick();
    stdout.close();

    const err = await rejected;
    expect(err.message).toBe("Transport closed");

    const diagnostics = transport.getCloseDiagnostics();
    expect(diagnostics).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        closeContext: "stdout_eof(buffer=0)",
        bufferedChars: 0,
        closeId: expect.any(String),
      }),
    );
    expect(diagnostics?.pendingRequests).toEqual([
      expect.objectContaining({ id: request.id, method: "skills/list", ageMs: expect.any(Number) }),
    ]);
    expect(diagnostics?.recentIncoming.at(-1)).toEqual(
      expect.objectContaining({ direction: "in", method: "skills/changed", kind: "notification" }),
    );
    expect(diagnostics?.recentOutgoing.map((entry) => entry.method)).toEqual(["skills/list", "initialized"]);
    expect(rawIncoming).toHaveLength(1);
    expect(secondRawIncoming).toEqual(rawIncoming);
  });
});
