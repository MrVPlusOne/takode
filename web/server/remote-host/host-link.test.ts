import { once } from "node:events";
import { HostAgent } from "./host-agent.js";
import { HostLinkManager, type RemoteProcess } from "./host-link-manager.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";

/** A small program that echoes stdin in upper case, and on "LATER" prints a second line after a delay. */
const ECHO_PROGRAM = [
  "process.stdin.on('data', (chunk) => {",
  "  const text = String(chunk);",
  "  process.stdout.write(text.toUpperCase());",
  "  if (text.includes('later')) setTimeout(() => process.stdout.write('DELAYED\\n'), 300);",
  "});",
  "process.stdin.on('end', () => process.exit(7));",
].join("\n");

function collect(proc: RemoteProcess): { text: () => string } {
  let output = "";
  proc.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf-8");
  });
  return { text: () => output };
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("host link", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agent: HostAgent;
  let links: FakeHostLink[];

  function startAgent(reconnectDelayMs = 20): HostAgent {
    const started = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs,
      log: () => {},
      connect: () => {
        const link = new FakeHostLink(manager, hostId);
        links.push(link);
        return link.agentSide;
      },
    });
    started.start();
    return started;
  }

  beforeEach(() => {
    manager = new HostLinkManager();
    links = [];
  });

  afterEach(() => {
    agent?.stop();
  });

  // The basic contract: a process started through the coordinator runs on the
  // host, receives stdin in order, and its output and exit reach the coordinator.
  it("runs a process on the host and relays stdin, stdout and exit", async () => {
    agent = startAgent();
    const proc = manager.spawn(hostId, {
      command: process.execPath,
      args: ["-e", ECHO_PROGRAM],
      env: { SESSION_ONLY_VALUE: "1" },
    });
    const output = collect(proc);
    await once(proc, "spawn");
    proc.stdin.write("hello\n");
    proc.stdin.write("world\n");
    await waitFor(() => output.text() === "HELLO\nWORLD\n");
    proc.stdin.end();
    const [code] = await once(proc, "exit");
    expect(code).toBe(7);
    expect(manager.status(hostId)).toMatchObject({ online: true, processes: 0 });
  });

  // A process started while the host is away waits; nothing fails.
  it("starts a process queued while the host was away once the host connects", async () => {
    const proc = manager.spawn(hostId, { command: process.execPath, args: ["-e", ECHO_PROGRAM], env: {} });
    const output = collect(proc);
    expect(manager.status(hostId)).toMatchObject({ online: false, processes: 1 });
    proc.stdin.write("queued\n");

    agent = startAgent();
    await waitFor(() => output.text() === "QUEUED\n");
    proc.kill("SIGTERM");
    await once(proc, "exit");
  });

  // Output produced while the link is down is kept on the host and replayed in
  // order after the reconnect; stdin written meanwhile waits on the coordinator.
  it("replays output from a link drop and delivers stdin written during it", async () => {
    // The host waits 600ms before reconnecting, so the delayed line is produced while the link is down.
    agent = startAgent(600);
    const proc = manager.spawn(hostId, { command: process.execPath, args: ["-e", ECHO_PROGRAM], env: {} });
    const output = collect(proc);
    proc.stdin.write("later\n");
    await waitFor(() => output.text() === "LATER\n");

    links.at(-1)!.drop();
    expect(manager.status(hostId).online).toBe(false);
    proc.stdin.write("while away\n");
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(output.text()).toBe("LATER\n");

    await waitFor(() => manager.status(hostId).online);
    await waitFor(() => output.text().includes("WHILE AWAY\n") && output.text().includes("DELAYED\n"));
    expect(output.text()).toBe("LATER\nDELAYED\nWHILE AWAY\n");
    proc.kill("SIGTERM");
    await once(proc, "exit");
  });

  // A restarted host has lost the processes it ran; the coordinator ends them
  // instead of waiting forever.
  it("ends a process when its host restarts", async () => {
    agent = startAgent();
    const proc = manager.spawn(hostId, { command: process.execPath, args: ["-e", ECHO_PROGRAM], env: {} });
    await once(proc, "spawn");
    const errors: Error[] = [];
    proc.on("error", (error) => errors.push(error));

    const exited = new Promise<[number | null, string | null]>((resolve) =>
      proc.once("exit", (code, signal) => resolve([code, signal])),
    );
    agent.stop();
    agent = startAgent();
    const [code, signal] = await exited;
    expect({ code, signal }).toEqual({ code: null, signal: "SIGKILL" });
    expect(errors.map((error) => error.message)).toEqual(["The host restarted and its processes ended"]);
  });

  // A coordinator replaced by a newer start (a lower epoch) must not drive the
  // host's processes, even if it can still reach the host.
  it("refuses a coordinator older than one it has seen", async () => {
    manager = new HostLinkManager({ epoch: 2 });
    agent = startAgent();
    await waitFor(() => manager.status(hostId).online);

    manager = new HostLinkManager({ epoch: 1 });
    links.at(-1)!.drop();
    const stale = manager.spawn(hostId, { command: process.execPath, args: ["-e", ECHO_PROGRAM], env: {} });
    // Each attempt is refused and the host retries; the queued process never starts.
    await waitFor(() => links.length >= 4);
    expect(stale.started).toBe(false);
  });

  // A restarted coordinator cannot read the old processes, so the host ends them
  // and starts command numbering over for the new coordinator.
  it("ends host processes when the coordinator restarts and accepts the new coordinator's commands", async () => {
    agent = startAgent();
    const old = manager.spawn(hostId, { command: process.execPath, args: ["-e", ECHO_PROGRAM], env: {} });
    await once(old, "spawn");

    manager = new HostLinkManager();
    links.at(-1)!.drop();
    const proc = manager.spawn(hostId, { command: process.execPath, args: ["-e", ECHO_PROGRAM], env: {} });
    const output = collect(proc);
    proc.stdin.write("fresh\n");
    await waitFor(() => output.text() === "FRESH\n");
    proc.kill("SIGTERM");
    await once(proc, "exit");
  });
});
