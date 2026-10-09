import { once } from "node:events";
import { HostAgent, type HostAgentOptions } from "./host-agent.js";
import { HostLinkManager, type RemoteProcess } from "./host-link-manager.js";
import { LOCAL_HOST_ID } from "./host-registry.js";
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

  function startAgent(reconnectDelayMs = 20, extra: Partial<HostAgentOptions> = {}): HostAgent {
    const started = new HostAgent({
      ...extra,
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

  // A restarted coordinator that saved a process id takes the process over: the
  // host keeps it running, and the new coordinator receives everything the old
  // one had not acknowledged, starting with the partial line the old one saw
  // only part of, so the new reader gets whole lines. Stdin keeps working.
  it("hands a running process to a restarted coordinator that adopts it", async () => {
    const program = [
      "process.stdin.on('data', (chunk) => {",
      "  const text = String(chunk);",
      "  if (!text.includes('half')) return process.stdout.write(text.toUpperCase());",
      "  process.stdout.write('HALF-');",
      "  setTimeout(() => process.stdout.write('LINE\\nNEXT\\n'), 400);",
      "});",
    ].join("\n");
    agent = startAgent();
    const old = manager.spawn(hostId, { command: process.execPath, args: ["-e", program], env: {} });
    const oldOutput = collect(old);
    old.stdin.write("half\n");
    await waitFor(() => oldOutput.text() === "HALF-");
    // Let the old coordinator's acknowledgement reach the host.
    await new Promise((resolve) => setTimeout(resolve, 50));

    manager = new HostLinkManager();
    const adopted = manager.adopt(hostId, old.procId);
    const output = collect(adopted);
    links.at(-1)!.drop();
    await waitFor(() => output.text() === "HALF-LINE\nNEXT\n");
    adopted.stdin.write("still here\n");
    await waitFor(() => output.text().endsWith("STILL HERE\n"));
    adopted.kill("SIGTERM");
    const [, signal] = await once(adopted, "exit");
    expect(signal).toBe("SIGTERM");
  });

  // An adopted process the host no longer runs (the host restarted while the
  // coordinator was down, or it already connected without it) fails instead of
  // waiting forever, so the session can be relaunched.
  it("fails an adopted process the host no longer runs", async () => {
    const errors: string[] = [];
    const exitOf = (proc: RemoteProcess) => {
      proc.on("error", (error) => errors.push(error.message));
      return new Promise((resolve) => proc.once("exit", resolve));
    };
    const missing = exitOf(manager.adopt(hostId, "proc-from-before"));
    agent = startAgent();
    await missing;

    await exitOf(manager.adopt(hostId, "proc-adopted-too-late"));
    expect(errors).toEqual(["The host no longer runs this process", "The host no longer runs this process"]);
  });

  // Remote hosts get only session variables and supply their own machine's
  // environment. This machine's own node instead runs a process with exactly
  // the environment the coordinator prepared, as if the coordinator had
  // started it, except that agent CLIs reach the coordinator through the node.
  it("runs a process on this machine's node with the coordinator's complete environment", async () => {
    const program = [
      "const { PATH, SESSION_VALUE, COMPANION_PORT, NODE_ONLY_VALUE, TAKODE_REMOTE_HOST } = process.env;",
      "console.log(JSON.stringify({ PATH, SESSION_VALUE, COMPANION_PORT, NODE_ONLY_VALUE: NODE_ONLY_VALUE ?? null, TAKODE_REMOTE_HOST: TAKODE_REMOTE_HOST ?? null }));",
    ].join("\n");
    process.env.NODE_ONLY_VALUE = "from the node's own environment";
    try {
      const local = new HostAgent({
        coordinatorUrl: "http://127.0.0.1:3456",
        token: "token",
        apiProxyPort: 45_678,
        log: () => {},
        connect: () => new FakeHostLink(manager, LOCAL_HOST_ID).agentSide,
      });
      local.start();
      agent = local;
      const proc = manager.spawn(LOCAL_HOST_ID, {
        command: process.execPath,
        args: ["-e", program],
        env: {
          PATH: "/session/bin",
          SESSION_VALUE: "1",
          COMPANION_PORT: "3456",
          UNSET_VALUE: undefined,
        },
      });
      const output = collect(proc);
      await once(proc, "exit");
      expect(JSON.parse(output.text())).toEqual({
        PATH: "/session/bin",
        SESSION_VALUE: "1",
        COMPANION_PORT: "45678",
        NODE_ONLY_VALUE: null,
        // Same machine as the coordinator: its data is here, so no remote-host marker.
        TAKODE_REMOTE_HOST: null,
      });
    } finally {
      delete process.env.NODE_ONLY_VALUE;
    }
  });

  // A process on a remote host is marked as such, so agent CLIs there never
  // answer from that machine's own ~/.companion files: the coordinator holds
  // all Takode data. CLIs still reach the coordinator through the node's proxy.
  it("marks processes on a remote host so their CLIs use only the coordinator's data", async () => {
    agent = startAgent();
    const proc = manager.spawn(hostId, {
      command: process.execPath,
      args: [
        "-e",
        "console.log(JSON.stringify({ port: process.env.COMPANION_PORT, remote: process.env.TAKODE_REMOTE_HOST }))",
      ],
      env: { COMPANION_PORT: "3456" },
    });
    const output = collect(proc);
    await once(proc, "exit");
    const env = JSON.parse(output.text()) as { port: string; remote: string };
    expect(env.remote).toBe("1");
    expect(env.port).toBe("45678");
  });

  // A node started from inside a Claude Code session (say, restarted by an
  // agent's Bash tool) must not hand that session's login routing to the
  // processes it runs, or every Claude there reports "Not logged in". The
  // node's own provider settings still apply.
  it("does not pass a parent Claude Code session's variables to processes on a host", async () => {
    const parent = {
      CLAUDE_CODE_ENTRYPOINT: "claude-desktop-3p",
      CLAUDE_CODE_HOST_AUTH_ENV_VAR: "ANTHROPIC_AUTH_TOKEN",
      ANTHROPIC_AUTH_TOKEN: "desktop-host-token",
      ANTHROPIC_BASE_URL: "https://proxy.example",
    };
    const saved = Object.fromEntries(Object.keys(parent).map((key) => [key, process.env[key]]));
    Object.assign(process.env, parent);
    try {
      agent = startAgent();
      const proc = manager.spawn(hostId, {
        command: process.execPath,
        args: [
          "-e",
          `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(Object.keys(parent))}.map((k) => [k, process.env[k] ?? null]))))`,
        ],
        env: {},
      });
      const output = collect(proc);
      await once(proc, "exit");
      expect(JSON.parse(output.text())).toEqual({
        CLAUDE_CODE_ENTRYPOINT: null,
        CLAUDE_CODE_HOST_AUTH_ENV_VAR: null,
        ANTHROPIC_AUTH_TOKEN: null,
        ANTHROPIC_BASE_URL: "https://proxy.example",
      });
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  // When a host will not connect again (this machine's node was turned off and
  // stopped), its processes end, including ones waiting to be taken over, so
  // their sessions start anew instead of waiting forever.
  it("ends the processes of a released host", async () => {
    const queued = manager.spawn(hostId, {
      command: process.execPath,
      args: ["-e", ECHO_PROGRAM],
      env: {},
    });
    const adopted = manager.adopt(hostId, "proc-from-before");
    const errors: string[] = [];
    for (const proc of [queued, adopted]) proc.on("error", (error) => errors.push(error.message));
    const exits = Promise.all([queued, adopted].map((proc) => new Promise((resolve) => proc.once("exit", resolve))));
    manager.release(hostId, "The node is not running");
    await exits;
    expect(errors).toEqual(["The node is not running", "The node is not running"]);
    expect(manager.status(hostId).processes).toBe(0);

    // A later node starts nothing left over from before.
    agent = startAgent();
    await waitFor(() => manager.status(hostId).online);
  });

  // A machine's name belongs to the machine. A host without one keeps the name
  // the coordinator knows it by; a rename reaches it over the link; and a host
  // that has a name reports it, together with its platform, user and home.
  it("settles machine names and reports machine details over the link", async () => {
    const reported: Array<string | null> = [];
    manager.nameHost = (_hostId, name) => {
      reported.push(name);
      return name ?? "devbox";
    };
    const saved: string[] = [];
    agent = startAgent(20, { machineName: null, saveMachineName: async (name) => void saved.push(name) });
    await waitFor(() => manager.status(hostId).online);
    await waitFor(() => saved.length === 1);
    expect(reported).toEqual([null]);
    expect(saved).toEqual(["devbox"]);
    expect(manager.machineDetails(hostId)).toMatchObject({ platform: process.platform });
    expect(manager.machineDetails(hostId)?.home).toBeTruthy();

    expect(manager.pushMachineName(hostId, "build-box")).toBe(true);
    await waitFor(() => saved.length === 2);
    expect(saved[1]).toBe("build-box");
    agent.stop();

    // A host that already has a name reports it and keeps it.
    agent = startAgent(20, { machineName: "old-laptop", saveMachineName: async (name) => void saved.push(name) });
    await waitFor(() => reported.length === 2);
    expect(reported[1]).toBe("old-laptop");
    expect(saved).toHaveLength(2);
  });
});
