import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { PassThrough, Writable } from "node:stream";
import {
  HOST_HEARTBEAT_MS,
  HOST_LINK_STALE_MS,
  HOST_PROTOCOL_VERSION,
  type CoordinatorToHost,
  type HostCommand,
  type HostLinkFeature,
  type HostMachineSettings,
  type HostProcessEvent,
  type HostProgramRole,
  type HostRequest,
  type HostResponse,
  type HostToCoordinator,
} from "../../shared/host-protocol.js";
import { HOST_LINK_FEATURES, HostLinkCodec, processBytes, processData } from "./host-link-codec.js";
import { LOCAL_HOST_ID } from "./host-registry.js";
import { shortCommit } from "./host-update.js";
import type { HostUpdateMode } from "./host-update-sessions.js";

/**
 * How long after a host connects, or a process starts there, before an update
 * may restart it. A session that just started may be about to resume a turn or
 * ask again for a permission it was waiting on, which the restart gate cannot
 * see yet.
 */
export const HOST_UPDATE_SETTLE_MS = 60_000;

/**
 * The settle time for an immediate update after the user's Restart Server:
 * turns are interrupted and continued anyway, so it only lets takeovers and
 * just-started sessions get going.
 */
export const HOST_IMMEDIATE_UPDATE_SETTLE_MS = 5_000;

/**
 * How long a host asked to update may take to come back on the new build
 * before the update counts as failed and the commands held for it go to the
 * node it still runs. Switching the checkout fetches and installs dependencies
 * (the install alone may take 10 minutes), then the node restarts.
 */
export const HOST_UPDATE_RESTART_TIMEOUT_MS = 15 * 60_000;

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
  /** Bun's server socket returns 0 when it dropped the message. */
  send(data: string | Uint8Array): unknown;
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
  /** What a pending auto-update waits for, worded to follow "It updates once"; null when none is waiting on anything. */
  updateWaitingFor: string | null;
  /** Programs the host's `takode node` was started with (`--claude`, `--codex`), which win over its settings. */
  commandOverrides: Partial<Record<HostProgramRole, string>>;
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
  /** `process.platform` and user reported by the host. */
  platform: string | null;
  user: string | null;
  /** Whether the host last reported a usable network of its own. */
  network: boolean;
  build: string | null;
  autoUpdate: boolean;
  /** When the host last connected or this coordinator last started a process on it. */
  lastStartAt: number;
  /** Commit this coordinator asked the current host instance to switch to. */
  updateRequested: string | null;
  /**
   * The update was sent and the node will restart: commands wait for its next
   * instance, so nothing starts on the old one only to end with it.
   */
  updateSent: boolean;
  /** When the update was sent, for {@link HOST_UPDATE_RESTART_TIMEOUT_MS}. */
  updateSentAt: number;
  /** This coordinator already sent the host an immediate update; later ones wait for idle. */
  immediateUpdateSent: boolean;
  updateError: string | null;
  /** A host operation was already logged as sent to a mismatched build of this host instance. */
  mismatchWarned: boolean;
  commandOverrides: Partial<Record<HostProgramRole, string>>;
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
  /** How messages are encoded on each attached host socket. */
  private readonly codecs = new WeakMap<HostLinkSocket, HostLinkCodec>();
  /** Highest event sequence per process to acknowledge on each socket, sent together shortly. */
  private readonly pendingAcks = new Map<HostLinkSocket, Map<string, number>>();
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
   * This coordinator was started by the user's Restart Server: each
   * auto-updating host on another build is updated right away, once,
   * instead of when none of its sessions is in a turn.
   */
  immediateUpdates = false;
  /**
   * What updating a host must wait for now (see {@link HostUpdateSessions.blocker}),
   * or null when it may update. Without it hosts are never auto-updated.
   */
  updateBlocker: ((hostId: string, mode: HostUpdateMode) => string | null) | null = null;
  /**
   * Get the host's sessions ready just before an update restarts it. The
   * restart ends every process there; stopped first, the sessions relaunch on
   * their next message instead of reporting a crashed process. False calls the
   * update off for now; it is tried again later.
   */
  prepareHostUpdate: ((hostId: string, mode: HostUpdateMode) => Promise<boolean>) | null = null;
  /** A host's node restarted (a new instance connected) or reported that it could not update. */
  onHostRestarted: ((hostId: string) => void) | null = null;
  /** Each host's machine settings, sent to it on every connect and by {@link pushSettings}. */
  machineSettingsFor: ((hostId: string) => HostMachineSettings) | null = null;
  /**
   * Settle a connecting host's name from the name its machine keeps (null
   * when it has none) and return the name it goes by, which `welcome` carries.
   */
  nameHost: ((hostId: string, reportedName: string | null) => string | null) | null = null;
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
      updateWaitingFor:
        link && this.wantsUpdate(link) && link.updateRequested !== this.build
          ? (this.updateBlocker?.(hostId, this.updateMode(link)) ?? null)
          : null,
      commandOverrides: { ...link?.commandOverrides },
    };
  }

  /** A newly authenticated host socket. A second socket for the same host replaces the first. */
  attach(hostId: string, socket: HostLinkSocket): void {
    const link = this.link(hostId);
    if (link.socket && link.socket !== socket) link.socket.close(4000, "Replaced by a newer connection");
    link.socket = socket;
    this.codecs.set(socket, new HostLinkCodec());
    link.lastSeenAt = this.now();
    // The link is online only after `hello` establishes which host instance this is.
  }

  detach(hostId: string, socket: HostLinkSocket): void {
    const link = this.links.get(hostId);
    if (!link || link.socket !== socket) return;
    link.socket = null;
    this.setOnline(hostId, link, false);
  }

  handleMessage(hostId: string, socket: HostLinkSocket, frame: string | ArrayBuffer | Uint8Array): void {
    const link = this.links.get(hostId);
    if (!link || link.socket !== socket) return;
    let message: HostToCoordinator;
    try {
      message = JSON.parse(this.codecs.get(socket)!.decode(frame)) as HostToCoordinator;
    } catch (error) {
      if (typeof frame === "string") return;
      // A compressed message that does not decode means the two sides no
      // longer share the compression history; start the connection over.
      console.warn(`[host-link] Could not decode a message from host ${hostId}; reconnecting:`, error);
      link.socket = null;
      this.setOnline(hostId, link, false);
      socket.close(4005, "Undecodable message");
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
        this.abandonUpdate(hostId, link, message.error);
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
    // Its launch would be prepared on the instance that is about to end.
    if (request.kind === "prepare_codex" && link.updateSent) {
      return Promise.reject(new Error(`Host ${hostId} is restarting for an update`));
    }
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
      this.send(socket, { t: "request", id, request });
    }) as Promise<Extract<HostResponse, { kind: K }>>;
    if (!mismatch) return answer;
    // An operation the host's build lacks or implements differently fails there;
    // name the likely cause instead of leaving a bare error.
    return answer.catch((error: Error) => {
      if (error instanceof HostUnavailableError) throw error;
      throw new Error(`${error.message} (${mismatch}; update takode on the host)`);
    });
  }

  /**
   * Why a new process cannot start on the host now, worded to follow "Host
   * <name>", or null when it can. Its start would wait for the host to come
   * back: indefinitely while it is offline, and until its update finishes
   * while it restarts for one.
   */
  startBlocker(hostId: string): string | null {
    const link = this.links.get(hostId);
    if (!link?.online || !link.socket) return "is offline";
    if (link.updateSent) return "is restarting for a Takode update; try again once it is back";
    return null;
  }

  /**
   * Give up on the update the host's current instance was asked for: it
   * failed or never brought the node back. The node keeps running its build,
   * so what waited for its restart is sent to it, and its interrupted turns
   * may go on. It is not asked again until it restarts.
   */
  private abandonUpdate(hostId: string, link: HostLink, error: string): void {
    link.updateError = error;
    console.warn(`[host-link] Host ${hostId} could not update to ${shortCommit(link.updateRequested ?? "")}: ${error}`);
    link.updateSent = false;
    if (link.online && link.socket) {
      for (const queued of link.unacked)
        this.send(link.socket, { t: "command", seq: queued.seq, command: queued.command });
    }
    this.onHostRestarted?.(hostId);
    this.notifyStatus(hostId);
  }

  /** Send a host its current machine settings, e.g. after they changed. A host that is away gets them when it connects. */
  pushSettings(hostId: string): void {
    const link = this.links.get(hostId);
    if (link?.online && link.socket) this.sendSettings(hostId, link.socket);
  }

  private sendSettings(hostId: string, socket: HostLinkSocket): void {
    if (this.machineSettingsFor) this.send(socket, { t: "settings", settings: this.machineSettingsFor(hostId) });
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

  /** Platform, user and home a host reported since this coordinator started; null before it connected. */
  machineDetails(hostId: string): { platform: string | null; user: string | null; home: string | null } | null {
    const link = this.links.get(hostId);
    if (!link || link.hostInstanceId === null) return null;
    return { platform: link.platform, user: link.user, home: link.homeDir };
  }

  /** Tell a connected host its new name. Returns false when it is offline. */
  pushMachineName(hostId: string, name: string): boolean {
    const link = this.links.get(hostId);
    if (!link?.online || !link.socket) return false;
    this.send(link.socket, { t: "machine_name", name });
    return true;
  }

  /**
   * Write a file on a host in order with later process input. If the host is
   * away, the write waits with the other commands.
   */
  writeFileInOrder(hostId: string, path: string, data: Buffer): void {
    this.enqueue(this.link(hostId), { kind: "write_file", path, data: data.toString("base64") });
  }

  /**
   * Start a process on a host. If the host is away, the process starts when it
   * returns. This machine's own node (`LOCAL_HOST_ID`) gets the complete
   * environment, since nothing in it describes another machine.
   */
  spawn(hostId: string, options: RemoteSpawnOptions): RemoteProcess {
    const sameMachine = hostId === LOCAL_HOST_ID;
    const proc = this.startProcess(hostId, (procId) => ({
      kind: "spawn",
      procId,
      command: options.command,
      args: options.args,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: sameMachine ? definedEnv(options.env) : sessionEnv(options.env),
      ...(sameMachine ? { fullEnv: true } : {}),
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
    link.lastStartAt = this.now();
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

  /**
   * Give up on an offline host that will not connect again, such as this
   * machine's node after it was turned off and stopped: its processes,
   * including ones waiting to be taken over, end, so their sessions start anew.
   */
  release(hostId: string, reason: string): void {
    const link = this.links.get(hostId);
    if (!link || link.online) return;
    link.unacked = link.unacked.filter((queued) => !("procId" in queued.command));
    for (const proc of [...link.processes.values()]) proc.fail(reason);
  }

  private handleHello(
    hostId: string,
    link: HostLink,
    socket: HostLinkSocket,
    hello: Extract<HostToCoordinator, { t: "hello" }>,
  ): void {
    if (hello.protocol !== HOST_PROTOCOL_VERSION) {
      this.send(socket, {
        t: "rejected",
        reason: `Host protocol ${hello.protocol} is not supported; this coordinator speaks ${HOST_PROTOCOL_VERSION}. Update takode on the host.`,
      });
      socket.close(4001, "Unsupported protocol");
      return;
    }
    let restarted = false;
    const sameInstance = link.hostInstanceId === hello.instanceId;
    if (!sameInstance) {
      // The first host instance since this coordinator started keeps the
      // processes it reports, which this coordinator may have adopted. A later
      // instance is a restarted `takode node` that has lost everything the old
      // one ran. Either way command numbering starts over, and commands for
      // processes that never started (queued while no host was connected) still apply.
      const firstContact = link.hostInstanceId === null;
      restarted = !firstContact;
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
      link.updateSent = false;
      link.updateError = null;
      link.mismatchWarned = false;
      link.commandOverrides = { ...hello.commandOverrides };
    }
    if (hello.homeDir) link.homeDir = hello.homeDir;
    link.lastStartAt = this.now();
    if (hello.platform) link.platform = hello.platform;
    if (hello.user) link.user = hello.user;
    const received: Record<string, number> = {};
    for (const [procId, proc] of link.processes) received[procId] = proc.lastEventSeq;
    const machineName = this.nameHost?.(hostId, hello.machineName ?? null);
    const features = acceptedFeatures(hostId, hello.features);
    this.send(socket, {
      t: "welcome",
      instanceId: this.instanceId,
      epoch: this.epoch,
      received,
      ...(machineName ? { machineName } : {}),
      ...(features.length > 0 ? { features } : {}),
    });
    // The host switches when it reads the welcome, which arrives before anything sent after it.
    this.codecs.get(socket)?.enable(features);
    // Before any command, so the host starts processes with its current settings.
    this.sendSettings(hostId, socket);
    // Applied sequence numbers only mean something for commands this coordinator instance numbered.
    const applied = hello.appliedFrom === this.instanceId ? hello.appliedCommandSeq : 0;
    for (const queued of link.unacked) {
      if (queued.seq > applied && !link.updateSent)
        this.send(socket, { t: "command", seq: queued.seq, command: queued.command });
    }
    // The node is back without restarting while its update is outstanding. If
    // the update failed while the link was down, the node's report was lost
    // with it, so ask again: it retries and reports on this link, or ignores
    // the request while the first attempt is still running.
    if (sameInstance && link.updateSent && link.updateRequested) {
      this.send(socket, { t: "update", commit: link.updateRequested });
    }
    this.setOnline(hostId, link, true);
    if (restarted) this.onHostRestarted?.(hostId);
  }

  /** Whether the host runs a build other than this coordinator's, or one it does not report. */
  private buildMismatch(link: HostLink): boolean {
    return link.hostInstanceId !== null && this.build !== null && link.build !== this.build;
  }

  private mismatchText(hostId: string, link: HostLink): string {
    const hostBuild = link.build ? `Takode ${shortCommit(link.build)}` : "an unknown Takode build";
    return `host ${hostId} runs ${hostBuild} and this server runs ${shortCommit(this.build ?? "")}`;
  }

  /** Whether the host is one this coordinator should update: connected, opted in and on another build. */
  private wantsUpdate(link: HostLink): boolean {
    return Boolean(link.online && link.socket && link.autoUpdate && this.build && this.buildMismatch(link));
  }

  private updateMode(link: HostLink): HostUpdateMode {
    return this.immediateUpdates && !link.immediateUpdateSent ? "immediate" : "when_idle";
  }

  /**
   * Ask an auto-updating host that runs another build to switch to this
   * coordinator's commit, once per host instance, when nothing started there
   * recently and nothing the update must wait for is under way: right after
   * the user's Restart Server even while sessions are in turns, otherwise only
   * when none is. Its sessions are stopped first. A failed attempt is not
   * repeated until the host restarts.
   */
  private maybeUpdate(hostId: string, link: HostLink): void {
    if (!this.wantsUpdate(link) || link.updateRequested === this.build) return;
    const mode = this.updateMode(link);
    const settleMs = mode === "immediate" ? HOST_IMMEDIATE_UPDATE_SETTLE_MS : HOST_UPDATE_SETTLE_MS;
    if (this.now() - link.lastStartAt < settleMs) return;
    if (!this.updateBlocker || this.updateBlocker(hostId, mode) !== null) return;
    const commit = this.build!;
    const instanceId = link.hostInstanceId;
    link.updateRequested = commit;
    link.updateError = null;
    console.log(`[host-link] Updating host ${hostId} to ${shortCommit(commit)}${mode === "immediate" ? " now" : ""}`);
    void Promise.resolve(this.prepareHostUpdate?.(hostId, mode) ?? true)
      .catch((error) => {
        console.warn(`[host-link] Could not stop the sessions on host ${hostId} before updating it:`, error);
        return true;
      })
      .then((ready) => {
        // A new host instance starts over; one that dropped off is asked again once it is back.
        if (link.hostInstanceId !== instanceId || link.updateRequested !== commit) return;
        if (!ready || !link.online || !link.socket) {
          link.updateRequested = null;
          return;
        }
        if (mode === "immediate") link.immediateUpdateSent = true;
        link.updateSent = true;
        link.updateSentAt = this.now();
        this.send(link.socket, { t: "update", commit });
      });
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
    if (!proc || seq <= proc.lastEventSeq) this.acknowledge(socket, procId, seq);
  }

  /**
   * Acknowledge an event. Acknowledgements are cumulative, so the events of
   * one burst (everything read from the socket before the event loop moves
   * on) are acknowledged with one message per process.
   */
  private acknowledge(socket: HostLinkSocket, procId: string, seq: number): void {
    let acks = this.pendingAcks.get(socket);
    if (!acks) {
      acks = new Map();
      this.pendingAcks.set(socket, acks);
      setImmediate(() => this.flushAcks(socket));
    }
    acks.set(procId, Math.max(seq, acks.get(procId) ?? 0));
  }

  private flushAcks(socket: HostLinkSocket): void {
    const acks = this.pendingAcks.get(socket);
    this.pendingAcks.delete(socket);
    // A replaced or dropped socket's events are replayed to the next one anyway.
    if (!acks || ![...this.links.values()].some((link) => link.socket === socket)) return;
    for (const [procId, seq] of acks) this.send(socket, { t: "event_ack", procId, seq });
  }

  /** Send a message in the socket's encoding, with process input as text where the host reads it. */
  private send(socket: HostLinkSocket, message: CoordinatorToHost): void {
    const codec = this.codecs.get(socket);
    if (message.t === "command" && message.command.kind === "stdin" && message.command.data !== undefined) {
      const { data, ...command } = message.command;
      message = { ...message, command: { ...command, ...processData(data, codec?.has("text") ?? false) } };
    }
    const sent = socket.send(codec ? codec.encode(message) : JSON.stringify(message));
    // A dropped compressed message would leave the host decoding against the wrong history.
    if (sent === 0 && codec?.has("deflate")) socket.close(4006, "Message dropped");
  }

  private enqueue(link: HostLink, command: HostCommand): void {
    const queued = { seq: link.nextCommandSeq++, command };
    link.unacked.push(queued);
    if (link.online && link.socket && !link.updateSent)
      this.send(link.socket, { t: "command", seq: queued.seq, command });
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
        platform: null,
        user: null,
        network: true,
        build: null,
        autoUpdate: false,
        lastStartAt: 0,
        updateRequested: null,
        updateSent: false,
        updateSentAt: 0,
        immediateUpdateSent: false,
        updateError: null,
        mismatchWarned: false,
        commandOverrides: {},
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
    this.notifyStatus(hostId);
  }

  private notifyStatus(hostId: string): void {
    const status = this.status(hostId);
    for (const listener of this.statusListeners) listener(status);
  }

  private tick(): void {
    const now = this.now();
    for (const [hostId, link] of this.links) {
      if (link.updateSent && now - link.updateSentAt > HOST_UPDATE_RESTART_TIMEOUT_MS) {
        const minutes = HOST_UPDATE_RESTART_TIMEOUT_MS / 60_000;
        this.abandonUpdate(hostId, link, `The node did not come back on the new build within ${minutes} minutes`);
      }
      if (!link.socket) continue;
      if (link.lastSeenAt !== null && now - link.lastSeenAt > HOST_LINK_STALE_MS) {
        const socket = link.socket;
        link.socket = null;
        this.setOnline(hostId, link, false);
        socket.close(4002, "Heartbeat timeout");
        continue;
      }
      this.send(link.socket, { t: "heartbeat" });
      this.maybeUpdate(hostId, link);
    }
  }
}

/**
 * A process running on a remote host, shaped like the Agent SDK's
 * `SpawnedProcess`. Stdin writes become ordered commands; stdout and stderr
 * carry the host's replayed output. `input` and `output` events show the
 * stdin and stdout bytes to observers without consuming the streams.
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
        this.emit("input", data);
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
      case "stdout": {
        const data = processBytes(event);
        this.emit("output", data);
        this.stdout.write(data);
        return;
      }
      case "stderr":
        this.stderr.write(processBytes(event));
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

function definedEnv(env: Record<string, string | undefined>): Record<string, string> {
  const defined: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) if (typeof value === "string") defined[key] = value;
  return defined;
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

/**
 * The link features to use with a host: the ones it offered that this build
 * knows. This machine's own node talks over loopback, where compressing would
 * only cost time.
 */
function acceptedFeatures(hostId: string, offered: HostLinkFeature[] | undefined): HostLinkFeature[] {
  return (offered ?? []).filter(
    (feature) => HOST_LINK_FEATURES.includes(feature) && !(feature === "deflate" && hostId === LOCAL_HOST_ID),
  );
}
