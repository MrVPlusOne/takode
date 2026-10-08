import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import {
  HOST_HEARTBEAT_MS,
  HOST_LINK_STALE_MS,
  HOST_PROTOCOL_VERSION,
  type CoordinatorToHost,
  type HostCommand,
  type HostProcessEvent,
  type HostToCoordinator,
} from "../../shared/host-protocol.js";

/** The part of a WebSocket the link manager needs. */
export interface HostLinkSocket {
  send(data: string): unknown;
  close(code?: number, reason?: string): void;
}

export interface HostLinkStatus {
  hostId: string;
  online: boolean;
  lastSeenAt: number | null;
  /** Processes this coordinator is running on the host, including ones waiting for it to come back. */
  processes: number;
}

/** What a caller needs to start a process on a host; mirrors the Agent SDK's spawn options. */
export interface RemoteSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
}

/**
 * Variables that describe the coordinator's own machine and must never be
 * forwarded; the host supplies its own.
 */
const HOST_LOCAL_ENV = new Set(["PATH", "HOME", "PWD", "OLDPWD", "SHELL", "USER", "LOGNAME", "TMPDIR", "TERM"]);

interface QueuedCommand {
  seq: number;
  command: HostCommand;
}

interface HostLink {
  socket: HostLinkSocket | null;
  online: boolean;
  lastSeenAt: number | null;
  /** The `takode node` instance currently or last connected. */
  hostInstanceId: string | null;
  nextCommandSeq: number;
  unacked: QueuedCommand[];
  processes: Map<string, RemoteProcess>;
}

/**
 * Coordinator side of the host links: one reliable link per registered host,
 * carrying process commands out and process events back. Sessions talk to
 * {@link RemoteProcess} objects and never see whether the host is connected:
 * commands wait in order while it is away and output replays when it returns.
 */
export class HostLinkManager {
  /** Changes every time the coordinator starts, so hosts can drop processes it can no longer read. */
  readonly instanceId = randomUUID();
  private readonly links = new Map<string, HostLink>();
  private readonly statusListeners = new Set<(status: HostLinkStatus) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Start sending heartbeats and dropping links that went silent. */
  start(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.tick(), HOST_HEARTBEAT_MS);
    this.heartbeat.unref?.();
  }

  stop(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  onStatusChange(listener: (status: HostLinkStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  status(hostId: string): HostLinkStatus {
    const link = this.links.get(hostId);
    return {
      hostId,
      online: link?.online ?? false,
      lastSeenAt: link?.lastSeenAt ?? null,
      processes: link?.processes.size ?? 0,
    };
  }

  /** A newly authenticated host socket. A second socket for the same host replaces the first. */
  attach(hostId: string, socket: HostLinkSocket): void {
    const link = this.link(hostId);
    if (link.socket && link.socket !== socket) link.socket.close(4000, "Replaced by a newer connection");
    link.socket = socket;
    link.lastSeenAt = this.now();
    // The link is online only after `hello` establishes which host instance this is.
  }

  detach(hostId: string, socket: HostLinkSocket): void {
    const link = this.links.get(hostId);
    if (!link || link.socket !== socket) return;
    link.socket = null;
    this.setOnline(hostId, link, false);
  }

  handleMessage(hostId: string, socket: HostLinkSocket, raw: string): void {
    const link = this.links.get(hostId);
    if (!link || link.socket !== socket) return;
    let message: HostToCoordinator;
    try {
      message = JSON.parse(raw) as HostToCoordinator;
    } catch {
      return;
    }
    link.lastSeenAt = this.now();
    switch (message.t) {
      case "hello":
        this.handleHello(hostId, link, socket, message);
        return;
      case "event":
        this.handleEvent(link, socket, message.procId, message.seq, message.event);
        return;
      case "command_ack":
        link.unacked = link.unacked.filter((queued) => queued.seq > message.seq);
        return;
      case "heartbeat":
        return;
    }
  }

  /** Close a host's link, e.g. after its registration is removed. Its processes wait as if it were away. */
  disconnect(hostId: string, reason: string): void {
    const link = this.links.get(hostId);
    if (!link?.socket) return;
    const socket = link.socket;
    link.socket = null;
    this.setOnline(hostId, link, false);
    socket.close(4003, reason);
  }

  /** Start a process on a host. If the host is away, the process starts when it returns. */
  spawn(hostId: string, options: RemoteSpawnOptions): RemoteProcess {
    const link = this.link(hostId);
    const procId = randomUUID();
    const proc = new RemoteProcess(procId, (command) => this.enqueue(link, command));
    link.processes.set(procId, proc);
    proc.once("exit", () => link.processes.delete(procId));
    this.enqueue(link, {
      kind: "spawn",
      procId,
      command: options.command,
      args: options.args,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: sessionEnv(options.env),
    });
    options.signal?.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
    return proc;
  }

  private handleHello(
    hostId: string,
    link: HostLink,
    socket: HostLinkSocket,
    hello: Extract<HostToCoordinator, { t: "hello" }>,
  ): void {
    if (hello.protocol !== HOST_PROTOCOL_VERSION) {
      send(socket, {
        t: "rejected",
        reason: `Host protocol ${hello.protocol} is not supported; this coordinator speaks ${HOST_PROTOCOL_VERSION}. Update takode on the host.`,
      });
      socket.close(4001, "Unsupported protocol");
      return;
    }
    if (link.hostInstanceId !== hello.instanceId) {
      // A different `takode node` process: everything the old one ran is gone, and
      // its command numbering starts over. Commands for processes that never
      // started (queued while no host was connected) still apply.
      for (const proc of link.processes.values()) {
        if (proc.started) proc.fail("The host restarted and its processes ended");
      }
      link.unacked = link.unacked
        .filter((queued) => !("procId" in queued.command) || link.processes.has(queued.command.procId))
        .map((queued, index) => ({ seq: index + 1, command: queued.command }));
      link.nextCommandSeq = link.unacked.length + 1;
      link.hostInstanceId = hello.instanceId;
    }
    const received: Record<string, number> = {};
    for (const [procId, proc] of link.processes) received[procId] = proc.lastEventSeq;
    send(socket, { t: "welcome", instanceId: this.instanceId, received });
    // Applied sequence numbers only mean something for commands this coordinator instance numbered.
    const applied = hello.appliedFrom === this.instanceId ? hello.appliedCommandSeq : 0;
    for (const queued of link.unacked) {
      if (queued.seq > applied) send(socket, { t: "command", seq: queued.seq, command: queued.command });
    }
    this.setOnline(hostId, link, true);
  }

  private handleEvent(
    link: HostLink,
    socket: HostLinkSocket,
    procId: string,
    seq: number,
    event: HostProcessEvent,
  ): void {
    const proc = link.processes.get(procId);
    if (proc && seq === proc.lastEventSeq + 1) {
      proc.lastEventSeq = seq;
      proc.apply(event);
    }
    // Duplicates and events for processes this coordinator no longer tracks are
    // acknowledged so the host can drop them; a gap waits for the host's replay.
    if (!proc || seq <= proc.lastEventSeq) send(socket, { t: "event_ack", procId, seq });
  }

  private enqueue(link: HostLink, command: HostCommand): void {
    const queued = { seq: link.nextCommandSeq++, command };
    link.unacked.push(queued);
    if (link.online && link.socket) send(link.socket, { t: "command", seq: queued.seq, command });
  }

  private link(hostId: string): HostLink {
    let link = this.links.get(hostId);
    if (!link) {
      link = {
        socket: null,
        online: false,
        lastSeenAt: null,
        hostInstanceId: null,
        nextCommandSeq: 1,
        unacked: [],
        processes: new Map(),
      };
      this.links.set(hostId, link);
    }
    return link;
  }

  private setOnline(hostId: string, link: HostLink, online: boolean): void {
    if (link.online === online) return;
    link.online = online;
    const status = this.status(hostId);
    for (const listener of this.statusListeners) listener(status);
  }

  private tick(): void {
    const now = this.now();
    for (const [hostId, link] of this.links) {
      if (!link.socket) continue;
      if (link.lastSeenAt !== null && now - link.lastSeenAt > HOST_LINK_STALE_MS) {
        const socket = link.socket;
        link.socket = null;
        this.setOnline(hostId, link, false);
        socket.close(4002, "Heartbeat timeout");
        continue;
      }
      send(link.socket, { t: "heartbeat" });
    }
  }
}

/**
 * A process running on a remote host, shaped like the Agent SDK's
 * `SpawnedProcess`. Stdin writes become ordered commands; stdout and stderr
 * carry the host's replayed output.
 */
export class RemoteProcess extends EventEmitter {
  readonly stdin: Writable;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid: number | undefined;
  killed = false;
  exitCode: number | null = null;
  started = false;
  lastEventSeq = 0;
  private exited = false;

  constructor(
    readonly procId: string,
    private readonly sendCommand: (command: HostCommand) => void,
  ) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, encoding, callback) => {
        const data = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
        this.sendCommand({ kind: "stdin", procId, data: data.toString("base64") });
        callback();
      },
      final: (callback) => {
        this.sendCommand({ kind: "stdin_end", procId });
        callback();
      },
    });
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    if (this.exited) return false;
    this.killed = true;
    this.sendCommand({ kind: "kill", procId: this.procId, signal });
    return true;
  }

  /** Apply one in-order event from the host. */
  apply(event: HostProcessEvent): void {
    switch (event.kind) {
      case "spawned":
        this.started = true;
        this.pid = event.pid;
        this.emit("spawn");
        return;
      case "stdout":
        this.stdout.write(Buffer.from(event.data, "base64"));
        return;
      case "stderr":
        this.stderr.write(Buffer.from(event.data, "base64"));
        return;
      case "error":
        this.emit("error", new Error(event.message));
        return;
      case "exit":
        this.finish(event.code, event.signal as NodeJS.Signals | null);
        return;
    }
  }

  /** End the process from the coordinator's side when the host lost it. */
  fail(message: string): void {
    if (this.exited) return;
    this.emit("error", new Error(message));
    this.finish(null, "SIGKILL");
  }

  private finish(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = code;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", code, signal);
  }
}

function sessionEnv(env: Record<string, string | undefined>): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || HOST_LOCAL_ENV.has(key)) continue;
    // Values inherited from the coordinator's own process describe this machine,
    // not the session; credentials in particular stay with each host.
    if (process.env[key] === value) continue;
    forwarded[key] = value;
  }
  return forwarded;
}

function send(socket: HostLinkSocket, message: CoordinatorToHost): void {
  socket.send(JSON.stringify(message));
}
