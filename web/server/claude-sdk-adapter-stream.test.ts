import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";

/** Build an adapter without starting a Claude process. */
function createIdleAdapter(onBackendExit: (error: string) => void): ClaudeSdkAdapter {
  const initialize = vi.spyOn(ClaudeSdkAdapter.prototype as any, "initialize").mockResolvedValue(undefined);
  const adapter = new ClaudeSdkAdapter("sdk-session", { cwd: "/test", onBackendExit });
  initialize.mockRestore();
  return adapter;
}

/**
 * Mirrors the Agent SDK's session stream(): each call yields one turn and
 * returns right after its `result`, or returns with nothing once Claude's
 * output has closed. A closed stream stays closed, so every later call returns
 * at once. Re-entering after closure throws so a regression fails here instead
 * of spinning the test worker.
 */
function fakeSdkSession(turns: Array<Array<{ type: string }>>) {
  let calls = 0;
  return {
    get streamCalls() {
      return calls;
    },
    async *stream() {
      calls++;
      if (calls > turns.length + 1) throw new Error("stream() re-entered after the session closed");
      for (const msg of turns[calls - 1] ?? []) yield msg;
    },
  };
}

describe("ClaudeSdkAdapter message stream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the backend exit when the SDK stream closes without a result", async () => {
    // Regression: a Ctrl-C reaching Claude's process group killed the process,
    // and its stream then returned empty on every call. The adapter kept
    // re-entering stream() in a microtask loop that starved the event loop, so
    // the server never ran its shutdown and grew to 11 GB.
    const onBackendExit = vi.fn();
    const adapter = createIdleAdapter(onBackendExit);
    const session = fakeSdkSession([[{ type: "assistant" }, { type: "result" }]]);
    (adapter as any).connected = true;
    (adapter as any).sdkSession = session;

    await (adapter as any).streamMessages();

    // One completed turn, then one closed stream: exactly two calls.
    expect(session.streamCalls).toBe(2);
    expect(onBackendExit).toHaveBeenCalledWith("Claude process ended");
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops quietly when the adapter was disconnected on purpose", async () => {
    // disconnect() closes the SDK session, which also ends its stream without
    // a result; that is not a backend failure and must not be reported.
    const onBackendExit = vi.fn();
    const adapter = createIdleAdapter(onBackendExit);
    const session = fakeSdkSession([]);
    (adapter as any).connected = true;
    (adapter as any).sdkSession = session;

    const streaming = (adapter as any).streamMessages();
    await adapter.disconnect();
    await streaming;

    expect(onBackendExit).not.toHaveBeenCalled();
  });
});
