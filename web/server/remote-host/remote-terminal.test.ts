import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coreActionLatency } from "../core-action-latency.js";
import { TerminalManager } from "../terminal-manager.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { HostAgent } from "./host-agent.js";
import { HostLinkManager } from "./host-link-manager.js";
import { configureRemoteMachines } from "./session-machine.js";

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** A browser terminal socket that records what the server sends it. */
function fakeBrowserSocket() {
  let output = "";
  const messages: unknown[] = [];
  const ws = {
    sendBinary: (chunk: Uint8Array) => {
      output += new TextDecoder().decode(chunk);
    },
    send: (message: string) => messages.push(JSON.parse(message)),
  };
  return { ws: ws as any, output: () => output, messages };
}

// A session on a remote host gets its terminal on that host: the coordinator's
// terminal manager drives a real pseudo-terminal shell that `takode node` runs,
// over the same reliable link that carries the session's processes.
describe("terminals on a remote host", () => {
  const hostId = "host-1";
  let links: HostLinkManager;
  let agent: HostAgent;
  let cwd: string;

  beforeEach(async () => {
    // A plain shell keeps the test independent of the user's login profile.
    vi.stubEnv("SHELL", "/bin/sh");
    cwd = await mkdtemp(join(tmpdir(), "remote-terminal-"));
    links = new HostLinkManager();
    configureRemoteMachines(links);
    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      log: () => {},
      connect: () => new FakeHostLink(links, hostId).agentSide,
    });
    agent.start();
    await waitFor(() => links.status(hostId).online);
  });

  afterEach(async () => {
    agent.stop();
    configureRemoteMachines(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });

  it("runs the shell on the host and relays input, output, resize and exit", async () => {
    const record = vi.spyOn(coreActionLatency, "record");
    const terminals = new TerminalManager();
    const browser = fakeBrowserSocket();
    const terminalId = terminals.spawn("session-a", cwd, 80, 24, hostId);
    terminals.addBrowserSocket(terminalId, browser.ws);

    // The arithmetic result appears only if the host's shell ran the command, not as its echo.
    terminals.handleBrowserMessage(terminalId, browser.ws, JSON.stringify({ type: "input", data: "echo $((40+2))\n" }));
    await waitFor(() => browser.output().includes("42"));

    // Resizing reaches the host's pseudo-terminal.
    terminals.handleBrowserMessage(terminalId, browser.ws, JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    terminals.handleBrowserMessage(terminalId, browser.ws, JSON.stringify({ type: "input", data: "stty size\n" }));
    await waitFor(() => browser.output().includes("30 100"));

    terminals.handleBrowserMessage(terminalId, browser.ws, JSON.stringify({ type: "input", data: "exit 3\n" }));
    await waitFor(() => browser.messages.length > 0);
    expect(browser.messages).toEqual([{ type: "exit", exitCode: 3 }]);
    expect(terminals.getInfo("session-a")).toBeNull();
    expect(links.status(hostId).processes).toBe(0);

    // The cross-machine hops are visible in `takode latency`.
    const actions = record.mock.calls.map(([action]) => action);
    expect(actions).toContain("host-terminal start");
    expect(actions).toContain("host-terminal echo");
  });

  it("shows why the shell could not start on the host", async () => {
    const terminals = new TerminalManager();
    const browser = fakeBrowserSocket();
    const terminalId = terminals.spawn("session-a", join(cwd, "missing"), 80, 24, hostId);
    terminals.addBrowserSocket(terminalId, browser.ws);

    await waitFor(() => browser.messages.length > 0);
    expect(browser.output()).toContain("Cannot open a terminal");
    expect(browser.messages).toEqual([{ type: "exit", exitCode: 0 }]);
  });
});
