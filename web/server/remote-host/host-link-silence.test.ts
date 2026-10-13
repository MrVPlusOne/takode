import { HOST_HEARTBEAT_MS, HOST_LINK_STALE_MS, HOST_PROTOCOL_VERSION } from "../../shared/host-protocol.js";
import { HostLinkManager, type HostLinkSocket } from "./host-link-manager.js";

/**
 * A host that vanishes without its connection closing: a relay or tunnel in
 * between keeps its own end open, so the coordinator's socket stays up and
 * its sends succeed. This is how the Condor host disappeared when Slurm moved
 * its job to another node.
 */
describe("host link silence", () => {
  const hostId = "host-1";
  let clock: number;
  let manager: HostLinkManager;
  let logs: string[];

  function openSocket(): HostLinkSocket & { sent: unknown[]; closed: { code?: number; reason?: string } | null } {
    const socket = {
      sent: [] as unknown[],
      closed: null as { code?: number; reason?: string } | null,
      send(data: string | Uint8Array) {
        socket.sent.push(JSON.parse(String(data)));
        return 1;
      },
      close(code?: number, reason?: string) {
        socket.closed = { code, reason };
      },
    };
    manager.attach(hostId, socket);
    manager.handleMessage(
      hostId,
      socket,
      JSON.stringify({ t: "hello", protocol: HOST_PROTOCOL_VERSION, instanceId: "node-1", processes: [] }),
    );
    return socket;
  }

  function tick(elapsedMs: number): void {
    clock += elapsedMs;
    (manager as unknown as { tick(): void }).tick();
  }

  beforeEach(() => {
    clock = 1_000_000;
    manager = new HostLinkManager({ now: () => clock });
    logs = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void logs.push(line));
    vi.spyOn(console, "warn").mockImplementation((line: string) => void logs.push(line));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The coordinator's heartbeats keep "succeeding" into the open socket, so
  // only the host's silence can show it is gone. Past the stale time the link
  // goes offline, the socket is closed and the outage is logged.
  it("takes a silent host offline although its connection stays open", () => {
    const socket = openSocket();
    expect(manager.status(hostId).online).toBe(true);

    tick(HOST_HEARTBEAT_MS);
    tick(HOST_HEARTBEAT_MS);
    expect(manager.status(hostId).online).toBe(true);

    tick(HOST_LINK_STALE_MS);
    expect(manager.status(hostId).online).toBe(false);
    expect(socket.closed).toEqual({ code: 4002, reason: "Heartbeat timeout" });
    expect(logs.some((line) => line.includes(`Host ${hostId} is offline: nothing heard from it for`))).toBe(true);
  });

  // Process input written while the host is silent waits on the coordinator;
  // when the same node reconnects it receives it, and the return is logged
  // with how long the host was away.
  it("delivers input queued during the silence when the same node reconnects", () => {
    openSocket();
    const proc = manager.spawn(hostId, { command: "cat", args: [], env: {} });
    tick(HOST_LINK_STALE_MS + HOST_HEARTBEAT_MS);
    expect(manager.status(hostId).online).toBe(false);
    expect(manager.hasProcess(hostId, proc.procId)).toBe(true);

    proc.stdin.write("while away\n");
    clock += 5 * 60_000;
    const back = openSocket();
    expect(manager.status(hostId).online).toBe(true);
    const stdin = back.sent.filter(
      (message: any) =>
        message.t === "command" && message.command.kind === "stdin" && message.command.procId === proc.procId,
    );
    expect(stdin).toHaveLength(1);
    expect(logs.some((line) => line.includes(`Host ${hostId} is online again after 5m`))).toBe(true);
  });
});
