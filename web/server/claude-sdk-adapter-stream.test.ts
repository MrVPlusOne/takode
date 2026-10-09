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

  it("tracks Claude's live background tasks from its background_tasks_changed level signal", () => {
    // The board stall check reads this set to know an idle worker is waiting on
    // a background command. Each signal replaces the set; a task keeps the time
    // it was first seen; ambient tasks (watchers) are not work the agent waits on;
    // and the process ending clears the set.
    vi.useFakeTimers({ now: 1_000 });
    try {
      const adapter = createIdleAdapter(vi.fn());
      (adapter as any).connected = true;
      const send = (tasks: object[]) =>
        (adapter as any).handleSdkMessage({ type: "system", subtype: "background_tasks_changed", tasks });
      const gate = { task_id: "gate", task_type: "local_bash", description: "Run full gate" };
      const agent = { task_id: "agent", task_type: "local_agent", description: "Review diff" };
      const watcher = { task_id: "watch", task_type: "monitor", description: "Watch logs", ambient: true };

      send([gate, watcher]);
      expect(adapter.getBackgroundTasks()).toEqual({
        tasks: [{ taskId: "gate", description: "Run full gate", startedAt: 1_000 }],
        changedAt: 1_000,
      });

      // Another task starts later: the first keeps its start time.
      vi.setSystemTime(5_000);
      send([gate, agent]);
      expect(adapter.getBackgroundTasks().tasks.map((task) => [task.taskId, task.startedAt])).toEqual([
        ["gate", 1_000],
        ["agent", 5_000],
      ]);

      // An ambient task appearing is not a membership change.
      vi.setSystemTime(6_000);
      send([gate, agent, watcher]);
      expect(adapter.getBackgroundTasks().changedAt).toBe(5_000);

      vi.setSystemTime(9_000);
      send([]);
      expect(adapter.getBackgroundTasks()).toEqual({ tasks: [], changedAt: 9_000 });

      send([gate]);
      expect(adapter.getBackgroundTasks().tasks).toHaveLength(1);
      (adapter as any).handleDisconnect();
      expect(adapter.getBackgroundTasks().tasks).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
