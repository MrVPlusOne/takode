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
 * Mirrors the Agent SDK query: one iterator yields every turn's messages for
 * the life of the process and finishes once Claude's output closes.
 */
async function* fakeSdkQuery(messages: Array<{ type: string }>, closed: Promise<void> = Promise.resolve()) {
  for (const msg of messages) yield msg;
  await closed;
}

describe("ClaudeSdkAdapter message stream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps relaying across turns and reports the backend exit when Claude's output closes", async () => {
    // Several results arrive on one stream; only the end of Claude's output
    // (for example the process killed by a Ctrl-C reaching its process group)
    // means the backend is gone, and it must surface as a backend exit.
    const onBackendExit = vi.fn();
    const adapter = createIdleAdapter(onBackendExit);
    const relayed: string[] = [];
    adapter.onBrowserMessage((msg) => relayed.push(msg.type));
    (adapter as any).connected = true;

    await (adapter as any).streamMessages(
      fakeSdkQuery([{ type: "assistant" }, { type: "result" }, { type: "assistant" }, { type: "result" }]),
    );

    expect(relayed).toEqual(["assistant", "result", "assistant", "result"]);
    expect(onBackendExit).toHaveBeenCalledWith("Claude process ended");
    expect(adapter.isConnected()).toBe(false);
  });

  it("reports a failed process with the SDK's error", async () => {
    const onBackendExit = vi.fn();
    const adapter = createIdleAdapter(onBackendExit);
    (adapter as any).connected = true;

    await (adapter as any).streamMessages(
      (async function* () {
        yield* [];
        throw new Error("Claude Code process exited with code 1");
      })(),
    );

    expect(onBackendExit).toHaveBeenCalledWith("Claude Code process exited with code 1");
    expect(adapter.isConnected()).toBe(false);
  });

  it("stops quietly when the adapter was disconnected on purpose", async () => {
    // disconnect() closes the query, which also ends Claude's output; that is
    // not a backend failure and must not be reported.
    const onBackendExit = vi.fn();
    const adapter = createIdleAdapter(onBackendExit);
    let closeOutput = () => {};
    const closed = new Promise<void>((resolve) => {
      closeOutput = resolve;
    });
    (adapter as any).connected = true;
    (adapter as any).sdkQuery = { close: closeOutput };

    const streaming = (adapter as any).streamMessages(fakeSdkQuery([], closed));
    await adapter.disconnect();
    await streaming;

    expect(onBackendExit).not.toHaveBeenCalled();
  });
});
