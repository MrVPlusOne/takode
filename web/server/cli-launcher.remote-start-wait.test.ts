import { vi } from "vitest";

// The Claude adapter is replaced by one whose process start the test settles
// (or never settles), standing in for a remote host that does not take the
// spawn command.
const adapters = vi.hoisted(() => [] as Array<{ sessionId: string; settle: (started: boolean) => void }>);
vi.mock("./claude-sdk-adapter.js", () => ({
  ClaudeSdkAdapter: class {
    started: Promise<boolean>;
    constructor(sessionId: string) {
      let settle: (started: boolean) => void = () => {};
      this.started = new Promise<boolean>((resolve) => (settle = resolve));
      adapters.push({ sessionId, settle });
    }
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliLauncher, REMOTE_CLAUDE_START_WAIT_MS } from "./cli-launcher.js";
import { HostLinkManager } from "./remote-host/host-link-manager.js";
import type { HostRegistry } from "./remote-host/host-registry.js";

/** Poll without timers, which these tests fake. */
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 10_000 && !condition(); i++) await new Promise((resolve) => setImmediate(resolve));
  if (!condition()) throw new Error("Timed out waiting for condition");
}

/**
 * Creating a Claude session waits for its process to start. On a remote host
 * that never takes the spawn command (in the incident, a host whose node was
 * stuck "restarting for an update"), that wait had no end: the create request
 * hung until the agent CLI's proxy gave up with "Bad Gateway", leaving a
 * session that never started. Now the wait on a remote host is bounded.
 */
describe("launching Claude on a remote host that does not start it", () => {
  let tempDir: string;
  let launcher: CliLauncher;

  beforeEach(() => {
    adapters.length = 0;
    tempDir = mkdtempSync(join(tmpdir(), "remote-start-wait-test-"));
    launcher = new CliLauncher(3456, { serverId: "test-server-id" });
    launcher.setRemoteHosts({ registry: {} as HostRegistry, links: new HostLinkManager() });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(tempDir, { recursive: true, force: true });
  });

  // The create returns once the wait is over, with the session still
  // starting; it starts later if the host takes the command.
  it("returns the still-starting session after the wait", async () => {
    let returned = false;
    const launch = launcher
      .launch({ backendType: "claude-sdk", cwd: tempDir, hostId: "host-1" })
      .finally(() => (returned = true));
    await waitFor(() => adapters.length === 1);

    await vi.advanceTimersByTimeAsync(REMOTE_CLAUDE_START_WAIT_MS - 1);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const info = await launch;
    expect(info.state).toBe("starting");

    // The host takes the command later: the session becomes connected.
    adapters[0]!.settle(true);
    await waitFor(() => launcher.getSession(info.sessionId)?.state === "connected");
  });

  // A host that starts the process in time is waited for as before.
  it("waits for a process the host starts in time", async () => {
    const launch = launcher.launch({ backendType: "claude-sdk", cwd: tempDir, hostId: "host-1" });
    await waitFor(() => adapters.length === 1);
    adapters[0]!.settle(true);
    expect((await launch).state).toBe("connected");
  });
});
