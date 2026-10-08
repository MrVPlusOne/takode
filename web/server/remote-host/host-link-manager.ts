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
  type HostRequest,
  type HostResponse,
  type HostToCoordinator,
} from "../../shared/host-protocol.js";
import { shortCommit } from "./host-update.js";

/** The host could not be asked: it is offline or the link dropped before it answered. */
export class HostUnavailableError extends Error {
  constructor(hostName: string) {
    super(`Host ${hostName} is offline`);
    this.name = "HostUnavailableError";
  }
}

interface PendingRequest {
  resolve: (response: HostResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

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
  /** Git commit the host's `takode node` runs, as last reported; null when unknown. */
  build: string | null;
  /** The host runs a different (or unknown) build than this coordinator. */
  buildMismatch: boolean;
  /** The host lets this coordinator update it (`takode node --auto-update`). */
  autoUpdate: boolean;
  /** An update to this coordinator's commit was sent to the running host instance and has not failed. */
  updating: boolean;
  /** Why the host's last update attempt failed, until it restarts. */
  updateError: string | null;
}

/** What a caller needs to start a process on a host; mirrors the Agent SDK's spawn options. */
export interface RemoteSpawnOptions {
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** A launch the host prepared itself; `command`, `args` and `cwd` are then ignored. */
  preparedLaunchId?: string;
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
  /** Home directory reported by the host. */
  homeDir: string | null;
  /** Whether the host last reported a usable network of its own. */
  network: boolean;
  build: string | null;
  autoUpdate: boolean;
  /** Commit this coordinator asked the current host instance to switch to. */
  updateRequested: string | null;
  updateError: string | null;
  /** A host operation was already logged as sent to a mismatched build of this host instance. */
  mismatchWarned: boolean;
  nextCommandSeq: number;
  unacked: QueuedCommand[];
  processes: Map<string, RemoteProcess>;
  /** One-shot requests waiting for this host's answer; they fail if the link drops. */
  requests: Map<string, PendingRequest>;
}

/**
 * Coordinator side of the host links: one reliable link per registered host,
 * carrying process commands out and process events back. Sessions talk to
 * {@link RemoteProcess} objects and never see whether the host is connected:
 * commands wait in order while it is away and output replays when it returns.
 * Host processes outlive this coordinator; a restarted coordinator takes them
 * over with {@link HostLinkManager.adopt}.
 */
export class HostLinkManager {
  /** Changes every time the coordinator starts, so hosts can tell they must hand over their processes again. */
  readonly instanceId = randomUUID();
  private readonly links = new Map<string, HostLink>();
  private readonly statusListeners = new Set<(status: HostLinkStatus) => void>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  /**
   * This coordinator's start counter (see `coordinator-lock.ts`); hosts refuse
   * older ones. Zero until the server has claimed it.
   */
  epoch: number;
  /**
   * Git commit this coordinator runs, which hosts are compared against and
   * auto-updated to. Null when unknown, which disables both.
   */
  build: string | null;
  /**
   * Whether a host can be restarted now without ending a turn. Hosts are
   * auto-updated only when this says yes; without it they never are.
   */
  canRestartHost: ((hostId: string) => boolean) | null = null;
  private readonly now: () => number;

  constructor(options: { epoch?: number; build?: string | null; now?: () => number } = {}) {
    this.epoch = options.epoch ?? 0;
    this.build = options.build ?? null;
    this.now = options.now ?? Date.now;
  }

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
      build: link?.build ?? null,
      buildMismatch: link ? this.buildMismatch(link) : false,
      autoUpdate: link?.autoUpdate ?? false,
      updating: Boolean(link?.updateRequested && link.updateRequested === this.build && !link.updateError),
      updateError: link?.updateError ?? null,
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
      case "response": {
        const pending = link.requests.get(message.id);
        if (!pending) return;
        link.requests.delete(message.id);
        clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.response);
        else pending.reject(new Error(message.error));
        return;
      }
      case "heartbeat":
        if (typeof message.network === "boolean") link.network = message.network;
        return;
      case "update_failed":
        if (message.commit !== link.updateRequested) return;
        link.updateError = message.error;
        console.warn(`[host-link] Host ${hostId} could not update to ${shortCommit(message.commit)}: ${message.error}`);
        return;
    }
  }

  /**
   * Ask a host to perform one operation now. Fails at once with
   * HostUnavailableError when the host is offline, and fails if it does not
   * answer within `timeoutMs` or the link drops first.
   */
  request<K extends HostRequest["kind"]>(
    hostId: string,
    request: Extract<HostRequest, { kind: K }>,
    timeoutMs: number,
  ): Promise<Extract<HostResponse, { kind: K }>> {
    const link = this.links.get(hostId);
    if (!link?.online || !link.socket) return Promise.reject(new HostUnavailableError(hostId));
    const socket = link.socket;
    const id = randomUUID();
    const operation = request.kind === "operation" ? (request as { name: string }).name : null;
    const mismatch = operation && this.buildMismatch(link) ? this.mismatchText(hostId, link) : null;
    if (mismatch && !link.mismatchWarned) {
      link.mismatchWarned = true;
      console.warn(`[host-link] Sending host operation ${operation} although ${mismatch}`);
    }
    const answer = new Promise<HostResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        link.requests.delete(id);
        reject(new Error(`Host ${hostId} did not answer within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      timer.unref?.();
      link.requests.set(id, { resolve, reject, timer });
      send(socket, { t: "request", id, request });
    }) as Promise<Extract<HostResponse, { kind: K }>>;
    if (!mismatch) return answer;
    // An operation the host's build lacks or implements differently fails there;
    // name the likely cause instead of leaving a bare error.
    return answer.catch((error: Error) => {
      if (error instanceof HostUnavailableError) throw error;
      throw new Error(`${error.message} (${mismatch}; update takode on the host)`);
    });
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

  /**
   * Whether a host can currently reach the network: connected to this
   * coordinator and reporting a usable interface of its own.
   */
  hasUsableNetwork(hostId: string): boolean {
    const link = this.links.get(hostId);
    return Boolean(link?.online && link.network);
  }

  /** The host's home directory as last reported, or null before it ever connected. */
  homeDir(hostId: string): string | null {
    return this.links.get(hostId)?.homeDir ?? null;
  }

  /**
   * Write a file on a host in order with later process input. If the host is
   * away, the write waits with the other commands.
   */
  writeFileInOrder(hostId: string, path: string, data: Buffer): void {
    this.enqueue(this.link(hostId), { kind: "write_file", path, data: data.toString("base64") });
  }

  /** Start a process on a host. If the host is away, the process starts when it returns. */
  spawn(hostId: string, options: RemoteSpawnOptions): RemoteProcess {
    const proc = this.startProcess(hostId, (procId) => ({
      kind: "spawn",
      procId,
      command: options.command,
      args: options.args,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: sessionEnv(options.env),
      ...(options.preparedLaunchId ? { preparedLaunchId: options.preparedLaunchId } : {}),
    }));
    options.signal?.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
    return proc;
  }

  /**
   * Start the host user's login shell in a pseudo-terminal. Like {@link spawn},
   * it starts when the host returns if the host is away, and its output replays
   * across link drops.
   */
  spawnTerminal(hostId: string, options: { cwd: string; cols: number; rows: number }): RemoteProcess {
    return this.startProcess(hostId, (procId) => ({ kind: "spawn_terminal", procId, ...options }));
  }

  private startProcess(hostId: string, startCommand: (procId: string) => HostCommand): RemoteProcess {
    const link = this.link(hostId);
    const procId = randomUUID();
    const proc = new RemoteProcess(procId, (command) => this.enqueue(link, command));
    link.processes.set(procId, proc);
    proc.once("exit", () => link.processes.delete(procId));
    this.enqueue(link, startCommand(procId));
    return proc;
  }

  /**
   * Take over a process a previous coordinator instance started on a host,
   * by the id it saved. The process counts as started; its output since the
   * old coordinator's last acknowledgement arrives once the host connects.
   * It fails if the host no longer runs it, including when the host already
   * connected to this coordinator without it.
   */
  adopt(hostId: string, procId: string): RemoteProcess {
    const link = this.link(hostId);
    const proc = new RemoteProcess(procId, (command) => this.enqueue(link, command));
    proc.started = true;
    link.processes.set(procId, proc);
    proc.once("exit", () => link.processes.delete(procId));
    if (link.hostInstanceId !== null) queueMicrotask(() => proc.fail("The host no longer runs this process"));
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
      // The first host instance since this coordinator started keeps the
      // processes it reports, which this coordinator may have adopted. A later
      // instance is a restarted `takode node` that has lost everything the old
      // one ran. Either way command numbering starts over, and commands for
      // processes that never started (queued while no host was connected) still apply.
      const firstContact = link.hostInstanceId === null;
      const running = new Set(firstContact ? (hello.processes ?? []) : []);
      for (const proc of link.processes.values()) {
        if (!proc.started || running.has(proc.procId)) continue;
        proc.fail(firstContact ? "The host no longer runs this process" : "The host restarted and its processes ended");
      }
      link.unacked = link.unacked
        .filter((queued) => !("procId" in queued.command) || link.processes.has(queued.command.procId))
        // File writes are kept: the new host instance still needs them.
        .map((queued, index) => ({ seq: index + 1, command: queued.command }));
      link.nextCommandSeq = link.unacked.length + 1;
      link.hostInstanceId = hello.instanceId;
      link.build = hello.build ?? null;
      link.autoUpdate = hello.autoUpdate === true;
      link.updateRequested = null;
      link.updateError = null;
      link.mismatchWarned = false;
    }
    if (hello.homeDir) link.homeDir = hello.homeDir;
    const received: Record<string, number> = {};
    for (const [procId, proc] of link.processes) received[procId] = proc.lastEventSeq;
    send(socket, { t: "welcome", instanceId: this.instanceId, epoch: this.epoch, received });
    // Applied sequence numbers only mean something for commands this coordinator instance numbered.
    const applied = hello.appliedFrom === this.instanceId ? hello.appliedCommandSeq : 0;
    for (const queued of link.unacked) {
      if (queued.seq > applied) send(socket, { t: "command", seq: queued.seq, command: queued.command });
    }
    this.setOnline(hostId, link, true);
    // Auto-update is checked on the next heartbeat tick, not here: sessions are
    // still taking over this host's processes right after it connects.
  }

  /** Whether the host runs a build other than this coordinator's, or one it does not report. */
  private buildMismatch(link: HostLink): boolean {
    return link.hostInstanceId !== null && this.build !== null && link.build !== this.build;
  }

  private mismatchText(hostId: string, link: HostLink): string {
    const hostBuild = link.build ? `Takode ${shortCommit(link.build)}` : "an unknown Takode build";
    return `host ${hostId} runs ${hostBuild} and this server runs ${shortCommit(this.build ?? "")}`;
  }

  /**
   * Ask an auto-updating host that runs another build to switch to this
   * coordinator's commit, once per host instance, when it can restart without
   * ending a turn. A failed attempt is not repeated until the host restarts.
   */
  private updateIfIdle(hostId: string, link: HostLink): void {
    if (!link.online || !link.socket || !link.autoUpdate || !this.build || !this.buildMismatch(link)) return;
    if (link.updateRequested === this.build || !this.canRestartHost?.(hostId)) return;
    link.updateRequested = this.build;
    link.updateError = null;
    console.log(`[host-link] Updating host ${hostId} to ${shortCommit(this.build)}`);
    send(link.socket, { t: "update", commit: this.build });
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
        homeDir: null,
        network: true,
        build: null,
        autoUpdate: false,
        updateRequested: null,
        updateError: null,
        mismatchWarned: false,
        nextCommandSeq: 1,
        unacked: [],
        processes: new Map(),
        requests: new Map(),
      };
      this.links.set(hostId, link);
    }
    return link;
  }

  private setOnline(hostId: string, link: HostLink, online: boolean): void {
    if (link.online === online) return;
    link.online = online;
    if (!online) {
      for (const pending of link.requests.values()) {
        clearTimeout(pending.timer);
        pending.reject(new HostUnavailableError(hostId));
      }
      link.requests.clear();
    }
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
      this.updateIfIdle(hostId, link);
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

  /** Resize the pseudo-terminal of a process started with `spawnTerminal`. */
  resize(cols: number, rows: number): void {
    if (!this.exited) this.sendCommand({ kind: "resize", procId: this.procId, cols, rows });
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
        this.emitError(event.message);
        return;
      case "exit":
        this.finish(event.code, event.signal as NodeJS.Signals | null);
        return;
    }
  }

  /** End the process from the coordinator's side when the host lost it. */
  fail(message: string): void {
    if (this.exited) return;
    this.emitError(message);
    this.finish(null, "SIGKILL");
  }

  /** An adopted process may fail before anything reads it; an unheard error must not throw. */
  private emitError(message: string): void {
    if (this.listenerCount("error") > 0) this.emit("error", new Error(message));
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
