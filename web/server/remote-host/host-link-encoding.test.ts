import { once } from "node:events";
import type { HostToCoordinator } from "../../shared/host-protocol.js";
import { HostAgent, type HostAgentOptions } from "./host-agent.js";
import { HostLinkManager, type HostLinkSocket, type RemoteProcess } from "./host-link-manager.js";
import { LOCAL_HOST_ID } from "./host-registry.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";

/**
 * Echoes each stdin line; the line "binary" makes it print bytes that are not
 * valid UTF-8, and "big" a large, repetitive block like a file read.
 */
const PROGRAM = [
  "let pending = '';",
  "process.stdin.on('data', (chunk) => {",
  "  const lines = (pending + String(chunk)).split('\\n');",
  "  pending = lines.pop();",
  "  for (const line of lines) {",
  "    if (line === 'binary') process.stdout.write(Buffer.from([0xff, 0xfe, 0x0a]));",
  '    else if (line === \'big\') process.stdout.write(\'{"type":"user","text":"same line"}\\n\'.repeat(4000));',
  "    else process.stdout.write(line + '\\n');",
  "  }",
  "});",
].join("\n");

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function collect(proc: RemoteProcess): () => Buffer {
  const chunks: Buffer[] = [];
  proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  return () => Buffer.concat(chunks);
}

describe("host link encoding", () => {
  let manager: HostLinkManager;
  let agent: HostAgent | null = null;
  let links: FakeHostLink[];

  function startAgent(
    hostId: string,
    extra: Partial<HostAgentOptions> = {},
    toCoordinator?: (message: HostToCoordinator) => HostToCoordinator,
  ): HostAgent {
    agent = new HostAgent({
      ...extra,
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      connect: () => {
        const link = new FakeHostLink(manager, hostId, toCoordinator);
        links.push(link);
        return link.agentSide;
      },
    });
    agent.start();
    return agent;
  }

  /** Run the echo program on a host, send it `input` lines one by one, and return its output once `done` holds. */
  async function runEcho(hostId: string, input: string[], done: (output: Buffer) => boolean): Promise<Buffer> {
    const proc = manager.spawn(hostId, { command: process.execPath, args: ["-e", PROGRAM], env: {} });
    const output = collect(proc);
    await once(proc, "spawn");
    for (const line of input) {
      proc.stdin.write(line);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await waitFor(() => done(output()));
    proc.kill("SIGTERM");
    await once(proc, "exit");
    return output();
  }

  function welcomeFeatures(link: FakeHostLink): unknown {
    return link.sentToHost.find((message) => message.t === "welcome")!.features;
  }

  beforeEach(() => {
    manager = new HostLinkManager();
    links = [];
  });

  afterEach(() => {
    agent?.stop();
    agent = null;
  });

  // A current host and coordinator agree on both features: after the
  // welcome, messages travel compressed both ways, output that is valid UTF-8
  // travels as text, and bytes that are not stay base64. Every byte arrives.
  it("compresses messages both ways and carries every byte with a current host", async () => {
    startAgent("host-1");
    const expected = Buffer.concat([
      Buffer.from("hello ✓\n"),
      Buffer.from([0xff, 0xfe, 0x0a]),
      Buffer.from('{"type":"user","text":"same line"}\n'.repeat(4000)),
    ]);
    const output = await runEcho("host-1", ["hello ✓\n", "binary\n", "big\n"], (out) => out.length >= expected.length);
    expect(output.equals(expected)).toBe(true);

    const link = links[0]!;
    expect(welcomeFeatures(link)).toEqual(["text", "deflate"]);
    expect(link.frames.some(({ to, frame }) => to === "host" && frame instanceof Uint8Array)).toBe(true);
    expect(link.frames.some(({ to, frame }) => to === "coordinator" && frame instanceof Uint8Array)).toBe(true);
    const stdout = link.sentToCoordinator.flatMap((message) =>
      message.t === "event" && message.event.kind === "stdout" ? [message.event] : [],
    );
    expect(stdout.some((event) => event.text === "hello ✓\n")).toBe(true);
    expect(stdout.some((event) => event.data === Buffer.from([0xff, 0xfe, 0x0a]).toString("base64"))).toBe(true);
    const stdin = link.sentToHost.flatMap((message) =>
      message.t === "command" && message.command.kind === "stdin" ? [message.command] : [],
    );
    expect(stdin[0]).toMatchObject({ text: "hello ✓\n" });
    // The large repetitive block crossed in a small fraction of its size.
    const toCoordinatorBytes = link.frames
      .filter(({ to }) => to === "coordinator")
      .reduce((sum, { frame }) => sum + (typeof frame === "string" ? Buffer.byteLength(frame) : frame.length), 0);
    expect(toCoordinatorBytes).toBeLessThan(expected.length / 20);
  });

  // Hosts update after the coordinator, so a current coordinator still talks
  // plain JSON with base64 process data to a host that offers no features.
  it("talks plain JSON with an older host", async () => {
    startAgent("host-1", { linkFeatures: [] });
    const output = await runEcho("host-1", ["hello\n"], (out) => out.toString() === "hello\n");
    expect(output.toString()).toBe("hello\n");
    const link = links[0]!;
    expect(welcomeFeatures(link)).toBeUndefined();
    expect(link.frames.every(({ frame }) => typeof frame === "string")).toBe(true);
    const stdin = link.sentToHost.find((message) => message.t === "command" && message.command.kind === "stdin");
    expect(stdin).toMatchObject({ command: { data: Buffer.from("hello\n").toString("base64") } });
  });

  // A host updated before its coordinator (or a coordinator rolled back)
  // gets a welcome without features and keeps to plain JSON.
  it("talks plain JSON with an older coordinator", async () => {
    // An older coordinator does not know the field, which is the same as the host not sending it.
    startAgent("host-1", {}, (message) => {
      if (message.t !== "hello") return message;
      const { features: _ignored, ...older } = message;
      return older;
    });
    const output = await runEcho("host-1", ["hello\n"], (out) => out.toString() === "hello\n");
    expect(output.toString()).toBe("hello\n");
    const link = links[0]!;
    expect(link.frames.every(({ frame }) => typeof frame === "string")).toBe(true);
    const stdout = link.sentToCoordinator.find((message) => message.t === "event" && message.event.kind === "stdout");
    expect(stdout).toMatchObject({ event: { data: Buffer.from("hello\n").toString("base64") } });
  });

  // This machine's own node talks over loopback: text saves the base64
  // step, but compressing would only cost time.
  it("does not compress the link to this machine's node", async () => {
    startAgent(LOCAL_HOST_ID);
    await runEcho(LOCAL_HOST_ID, ["hello\n"], (out) => out.toString() === "hello\n");
    const link = links[0]!;
    expect(welcomeFeatures(link)).toEqual(["text"]);
    expect(link.frames.every(({ frame }) => typeof frame === "string")).toBe(true);
  });

  // If the two sides ever disagree on the compression history, the
  // coordinator drops the connection; the host reconnects with fresh
  // histories and its processes carry on.
  it("starts the connection over when a compressed message does not decode", async () => {
    startAgent("host-1");
    const proc = manager.spawn("host-1", { command: process.execPath, args: ["-e", PROGRAM], env: {} });
    const output = collect(proc);
    await once(proc, "spawn");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    manager.handleMessage("host-1", links[0]!.coordinatorSide, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x00]));
    expect(manager.status("host-1").online).toBe(false);
    expect(warn).toHaveBeenCalled();
    await waitFor(() => links.length === 2 && manager.status("host-1").online);
    proc.stdin.write("after\n");
    await waitFor(() => output().toString() === "after\n");
    proc.kill("SIGTERM");
    await once(proc, "exit");
  });
});

describe("event acknowledgements", () => {
  // Acknowledgements are cumulative, so a burst of events is acknowledged
  // with one message per process instead of one per event.
  it("acknowledges a burst of events with one message per process", async () => {
    const manager = new HostLinkManager();
    const sent: string[] = [];
    const socket: HostLinkSocket = { send: (data) => void sent.push(String(data)), close: () => {} };
    manager.attach("host-1", socket);
    manager.handleMessage(
      "host-1",
      socket,
      JSON.stringify({ t: "hello", protocol: 3, instanceId: "h1", appliedCommandSeq: 0, appliedFrom: null }),
    );
    for (const [procId, seq] of [
      ["p1", 1],
      ["p1", 2],
      ["p2", 1],
      ["p1", 3],
    ] as const) {
      manager.handleMessage("host-1", socket, JSON.stringify({ t: "event", procId, seq, event: { kind: "spawned" } }));
    }
    await new Promise((resolve) => setImmediate(resolve));
    const acks = sent.map((data) => JSON.parse(data)).filter((message) => message.t === "event_ack");
    expect(acks).toEqual([
      { t: "event_ack", procId: "p1", seq: 3 },
      { t: "event_ack", procId: "p2", seq: 1 },
    ]);
  });
});
