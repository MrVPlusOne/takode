import { describe, expect, it, vi } from "vitest";
import { ClaudeSdkAdapter } from "./claude-sdk-adapter.js";

describe("ClaudeSdkAdapter launch failure", () => {
  it("reports a missing Claude executable as a backend failure instead of a usable session", async () => {
    // Uses the real Agent SDK: spawning the missing path fails with ENOENT, so
    // no process runs and no provider is contacted. The launcher marks the
    // session exited through `started`/`onBackendExit`; the bridge turns the
    // reported disconnect into backend_disconnected plus capped relaunches
    // (see claude-sdk-adapter-lifecycle-controller.test.ts).
    const onBackendExit = vi.fn();
    const adapter = new ClaudeSdkAdapter("missing-binary", {
      cwd: "/tmp",
      claudeBinary: "/nonexistent/takode-test/claude",
      env: {},
      onBackendExit,
    });
    const onDisconnect = vi.fn();
    const onInitError = vi.fn();
    adapter.onDisconnect(onDisconnect);
    adapter.onInitError(onInitError);

    // The launcher waits on `started` before reporting the session connected.
    await expect(adapter.started).resolves.toBe(false);
    await vi.waitFor(() => expect(onBackendExit).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(onDisconnect.mock.calls.length + onInitError.mock.calls.length).toBe(1);
    expect(adapter.isConnected()).toBe(false);
    expect(adapter.sendBrowserMessage({ type: "user_message", content: "hello" })).toBe(false);
  });

  it("reports started once a real process spawns, then reports its exit", async () => {
    // A stand-in executable (not Claude) proves the SDK's spawn event reaches
    // `started`; it rejects Claude's arguments and exits, which must surface as
    // a backend exit rather than a silent stop.
    const onBackendExit = vi.fn();
    const adapter = new ClaudeSdkAdapter("stand-in-binary", {
      cwd: "/tmp",
      claudeBinary: "/bin/cat",
      env: {},
      onBackendExit,
    });

    await expect(adapter.started).resolves.toBe(true);
    await vi.waitFor(() => expect(onBackendExit).toHaveBeenCalledTimes(1), { timeout: 5000 });
    expect(adapter.isConnected()).toBe(false);
  });
});
