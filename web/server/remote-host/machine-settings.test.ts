import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { HostAgent } from "./host-agent.js";
import { HostLinkManager } from "./host-link-manager.js";
import type { HostMachineSettings } from "../../shared/host-protocol.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A child process that never runs anything; the test only looks at what was started. */
function fakeChild(): ChildProcess {
  return Object.assign(new EventEmitter(), { stdin: null, stdout: null, stderr: null, kill: () => true }) as never;
}

// A host's Claude/Codex programs are stored on the coordinator and sent over
// the link; the node's --claude/--codex flags win over them.
describe("machine settings over the host link", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agent: HostAgent | null = null;
  let settings: HostMachineSettings;
  let started: string[];
  let codexBinaries: unknown[];

  function startAgent(commands: { claude?: string; codex?: string } = {}): HostAgent {
    const next = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      commands,
      connect: () => new FakeHostLink(manager, hostId).agentSide,
      spawnProcess: (command) => {
        started.push(command);
        return fakeChild();
      },
      prepareCodexLaunch: async (_sessionId, _info, options) => {
        codexBinaries.push(options.codexBinary);
        return { spawnCmd: ["codex"], spawnEnv: {}, spawnCwd: undefined };
      },
    });
    next.start();
    return next;
  }

  beforeEach(() => {
    settings = { claudeBinary: "/opt/claude-copilot", codexBinary: "" };
    started = [];
    codexBinaries = [];
    manager = new HostLinkManager();
    manager.machineSettingsFor = () => settings;
  });

  afterEach(() => {
    agent?.stop();
    agent = null;
  });

  // Settings arrive right after the welcome, before any queued command, so even
  // a process queued while the host was away starts with them.
  it("runs the host's stored programs, falling back to the role name", async () => {
    manager.spawn(hostId, { command: "claude", args: [], env: {} });
    agent = startAgent();
    await waitFor(() => started.length === 1);
    expect(started).toEqual(["/opt/claude-copilot"]);

    await manager.request(hostId, { kind: "prepare_codex", sessionId: "s", info: {}, options: {} }, 5_000);
    expect(codexBinaries).toEqual(["codex"]);

    // A change reaches the connected host at once.
    settings = { claudeBinary: "", codexBinary: "/opt/codex" };
    manager.pushSettings(hostId);
    await new Promise((resolve) => setTimeout(resolve, 20));
    manager.spawn(hostId, { command: "claude", args: [], env: {} });
    await manager.request(hostId, { kind: "prepare_codex", sessionId: "s", info: {}, options: {} }, 5_000);
    await waitFor(() => started.length === 2);
    expect(started[1]).toBe("claude");
    expect(codexBinaries[1]).toBe("/opt/codex");
  });

  it("lets the node's flags override the stored settings and reports them", async () => {
    agent = startAgent({ claude: "/flag/claude" });
    await waitFor(() => manager.status(hostId).online);
    expect(manager.status(hostId).commandOverrides).toEqual({ claude: "/flag/claude" });
    manager.spawn(hostId, { command: "claude", args: [], env: {} });
    await waitFor(() => started.length === 1);
    expect(started).toEqual(["/flag/claude"]);
  });
});
