import { spawn as spawnChild, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { hasUsableNetwork } from "../network-availability.js";
import { dirname } from "node:path";
import { getEnrichedPath } from "../path-resolver.js";
import { performHostOperation } from "./host-operations.js";
import {
  HOST_HEARTBEAT_MS,
  HOST_LINK_PATH,
  HOST_LINK_STALE_MS,
  HOST_PROTOCOL_VERSION,
  type CoordinatorToHost,
  type HostCommand,
  type HostProcessEvent,
  type HostRequest,
  type HostResponse,
  type HostToCoordinator,
} from "../../shared/host-protocol.js";

/** The part of a WebSocket the host agent needs; Bun's and the browser's both fit. */
export interface AgentSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export interface HostAgentOptions {
  /** Base URL of the coordinator, e.g. `https://takode.example.com` or `http://127.0.0.1:3456`. */
  coordinatorUrl: string;
  /** Token issued when this host was registered on the coordinator. */
  token: string;
  /** Loopback port of this host's API proxy; agent CLIs on this host use it as COMPANION_PORT. */
  apiProxyPort: number;
  /**
   * Programs the coordinator names abstractly, resolved on this host. The
   * coordinator asks for `claude`; a host can map it to its own installation.
   */
  commands?: Record<string, string>;
  /** Codex launch preparation; the real one (`prepareCodexSpawn`) unless a test supplies another. */
  prepareCodexLaunch?: (
    sessionId: string,
    info: unknown,
    options: Record<string, unknown>,
  ) => Promise<{
    spawnCmd: string[];
    spawnEnv: Record<string, string | undefined>;
    spawnCwd: string | undefined;
    [setting: string]: unknown;
  }>;
  /** First reconnect delay after a link drop; doubles up to 15s. */
  reconnectDelayMs?: number;
  /** Overrides for tests. */
  connect?: (url: string, headers: Record<string, string>) => AgentSocket;
  spawnProcess?: (command: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  log?: (message: string) => void;
}

interface HostedProcess {
  child: ChildProcess | null;
  nextSeq: number;
  /** Events the coordinator has not acknowledged yet, oldest first. */
  pending: { seq: number; event: HostProcessEvent }[];
  exited: boolean;
}

const OPEN = 1;
const MAX_RECONNECT_DELAY_MS = 15_000;

/**
 * The `takode node` side of a host link. It dials out to the coordinator, runs
 * the processes the coordinator asks for, and keeps their output until the
 * coordinator acknowledges it, replaying it after any reconnect.
 */
export class HostAgent {
  readonly instanceId = randomUUID();
  private socket: AgentSocket | null = null;
  private coordinatorInstanceId: string | null = null;
  private appliedCommandSeq = 0;
  private readonly processes = new Map<string, HostedProcess>();
  /** Launches prepared by `prepare_codex`, waiting for their `spawn` command. */
  private readonly preparedLaunches = new Map<
    string,
    { argv: string[]; env: Record<string, string | undefined>; cwd: string | undefined }
  >();
  private lastHeardAt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs: number;
  private stopped = false;
  private readonly log: (message: string) => void;

  constructor(private readonly options: HostAgentOptions) {
    this.log = options.log ?? ((message) => console.log(`[takode node] ${message}`));
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  }

  start(): void {
    this.stopped = false;
    this.connect();
    this.heartbeat = setInterval(() => this.tick(), HOST_HEARTBEAT_MS);
  }

  /** Stop reconnecting and end every hosted process. */
  stop(): void {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "Host stopping");
    this.socket = null;
    for (const hosted of this.processes.values()) hosted.child?.kill("SIGTERM");
  }

  get connected(): boolean {
    return this.socket?.readyState === OPEN && this.coordinatorInstanceId !== null;
  }

  private connect(): void {
    if (this.stopped) return;
    const url = linkUrl(this.options.coordinatorUrl);
    const headers = { Authorization: `Bearer ${this.options.token}` };
    const socket = this.options.connect
      ? this.options.connect(url, headers)
      : (new WebSocket(url, { headers } as unknown as string[]) as unknown as AgentSocket);
    this.socket = socket;
    socket.onopen = () => {
      this.lastHeardAt = Date.now();
      this.send({
        t: "hello",
        protocol: HOST_PROTOCOL_VERSION,
        instanceId: this.instanceId,
        appliedCommandSeq: this.appliedCommandSeq,
        appliedFrom: this.coordinatorInstanceId,
        homeDir: homedir(),
      });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.lastHeardAt = Date.now();
      this.handleMessage(String(event.data));
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // `onclose` follows and schedules the reconnect.
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
    this.log(`Coordinator link down; reconnecting in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private handleMessage(raw: string): void {
    let message: CoordinatorToHost;
    try {
      message = JSON.parse(raw) as CoordinatorToHost;
    } catch {
      return;
    }
    switch (message.t) {
      case "welcome":
        this.handleWelcome(message.instanceId, message.received);
        return;
      case "command":
        if (message.seq <= this.appliedCommandSeq) {
          this.send({ t: "command_ack", seq: message.seq });
          return;
        }
        if (message.seq !== this.appliedCommandSeq + 1) return; // A gap is resent after the next welcome.
        this.apply(message.command);
        this.appliedCommandSeq = message.seq;
        this.send({ t: "command_ack", seq: message.seq });
        return;
      case "event_ack": {
        const hosted = this.processes.get(message.procId);
        if (!hosted) return;
        hosted.pending = hosted.pending.filter((pending) => pending.seq > message.seq);
        this.forgetIfDone(message.procId, hosted);
        return;
      }
      case "request":
        void this.answer(message.id, message.request);
        return;
      case "rejected":
        this.log(`Coordinator rejected this host: ${message.reason}`);
        this.stop();
        return;
      case "heartbeat":
        return;
    }
  }

  private handleWelcome(coordinatorInstanceId: string, received: Record<string, number>): void {
    this.reconnectDelayMs = this.options.reconnectDelayMs ?? 1_000;
    if (this.coordinatorInstanceId !== coordinatorInstanceId) {
      // A restarted coordinator has lost the sessions reading these processes and
      // numbers its commands from 1 again.
      if (this.coordinatorInstanceId !== null)
        this.log("Coordinator restarted; ending processes it can no longer read");
      for (const hosted of this.processes.values()) hosted.child?.kill("SIGTERM");
      this.processes.clear();
      this.coordinatorInstanceId = coordinatorInstanceId;
      this.appliedCommandSeq = 0;
      this.log("Connected to coordinator");
      return;
    }
    for (const [procId, hosted] of this.processes) {
      const lastReceived = received[procId];
      if (lastReceived === undefined) {
        // The coordinator no longer tracks this process.
        hosted.child?.kill("SIGTERM");
        this.processes.delete(procId);
        continue;
      }
      hosted.pending = hosted.pending.filter((pending) => pending.seq > lastReceived);
      for (const pending of hosted.pending) {
        this.send({ t: "event", procId, seq: pending.seq, event: pending.event });
      }
    }
    this.log("Reconnected to coordinator");
  }

  private async answer(id: string, request: HostRequest): Promise<void> {
    try {
      const response =
        request.kind === "prepare_codex" ? await this.prepareCodex(request) : await performHostRequest(request);
      this.send({ t: "response", id, ok: true, response });
    } catch (error) {
      this.send({ t: "response", id, ok: false, error: errorMessage(error) });
    }
  }

  /**
   * Prepare a Codex launch here, with this host's Codex binary, home and
   * configuration, and keep the command for the `spawn` that follows.
   */
  private async prepareCodex(request: Extract<HostRequest, { kind: "prepare_codex" }>): Promise<HostResponse> {
    const options = {
      ...(request.options as Record<string, unknown>),
      // The coordinator's binary and Codex home paths describe its own machine.
      codexBinary: this.options.commands?.codex,
      codexHome: undefined,
    };
    const prepare = this.options.prepareCodexLaunch ?? prepareCodexWithThisInstall;
    const spec = await prepare(request.sessionId, request.info, options);
    const launchId = randomUUID();
    this.preparedLaunches.set(launchId, { argv: spec.spawnCmd, env: spec.spawnEnv, cwd: spec.spawnCwd });
    const { spawnCmd: _cmd, spawnEnv: _env, spawnCwd: _cwd, ...adapterSettings } = spec;
    return { kind: "prepare_codex", launchId, adapterSettings: adapterSettings as Record<string, unknown> };
  }

  private apply(command: HostCommand): void {
    switch (command.kind) {
      case "spawn":
        this.spawn(command);
        return;
      case "write_file": {
        // `~/` stands for this host's home when the coordinator did not know it yet.
        const path = command.path.startsWith("~/") ? `${homedir()}${command.path.slice(1)}` : command.path;
        void mkdir(dirname(path), { recursive: true })
          .then(() => writeFile(path, Buffer.from(command.data, "base64")))
          .catch((error) => this.log(`Could not write ${path}: ${errorMessage(error)}`));
        return;
      }
      case "stdin":
        this.processes.get(command.procId)?.child?.stdin?.write(Buffer.from(command.data, "base64"));
        return;
      case "stdin_end":
        this.processes.get(command.procId)?.child?.stdin?.end();
        return;
      case "kill":
        this.processes.get(command.procId)?.child?.kill(command.signal as NodeJS.Signals);
        return;
    }
  }

  private spawn(command: Extract<HostCommand, { kind: "spawn" }>): void {
    const hosted: HostedProcess = { child: null, nextSeq: 1, pending: [], exited: false };
    this.processes.set(command.procId, hosted);
    const port = String(this.options.apiProxyPort);
    const prepared = command.preparedLaunchId ? this.preparedLaunches.get(command.preparedLaunchId) : undefined;
    if (command.preparedLaunchId) this.preparedLaunches.delete(command.preparedLaunchId);
    if (command.preparedLaunchId && !prepared) {
      this.emit(command.procId, { kind: "error", message: "The prepared launch is gone; the host may have restarted" });
      this.emit(command.procId, { kind: "exit", code: null, signal: null });
      return;
    }
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(prepared?.env ?? command.env),
      // Like on the coordinator, agents find Takode's CLI wrappers and the user's
      // shell tools first. A prepared Codex launch already built this PATH here.
      ...(prepared ? {} : { PATH: getEnrichedPath() }),
      // Agent CLIs on this host reach the coordinator through the local API proxy.
      COMPANION_PORT: port,
      ...(command.env.TAKODE_API_PORT ? { TAKODE_API_PORT: port } : {}),
    };
    const program = prepared ? prepared.argv[0]! : (this.options.commands?.[command.command] ?? command.command);
    const programArgs = prepared ? prepared.argv.slice(1) : command.args;
    const cwd = prepared ? prepared.cwd : command.cwd;
    const start = this.options.spawnProcess ?? defaultSpawn;
    let child: ChildProcess;
    try {
      child = start(program, programArgs, { ...(cwd ? { cwd } : {}), env });
    } catch (error) {
      this.emit(command.procId, { kind: "error", message: errorMessage(error) });
      this.emit(command.procId, { kind: "exit", code: null, signal: null });
      return;
    }
    hosted.child = child;
    let spawned = false;
    child.once("spawn", () => {
      spawned = true;
      this.emit(command.procId, { kind: "spawned", ...(child.pid ? { pid: child.pid } : {}) });
    });
    child.stdout?.on("data", (chunk: Buffer) =>
      this.emit(command.procId, { kind: "stdout", data: chunk.toString("base64") }),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      this.emit(command.procId, { kind: "stderr", data: chunk.toString("base64") }),
    );
    child.once("error", (error) => {
      this.emit(command.procId, { kind: "error", message: error.message });
      // A process that never started reports no close of its own.
      if (!spawned) this.emit(command.procId, { kind: "exit", code: null, signal: null });
    });
    child.once("close", (code, signal) => this.emit(command.procId, { kind: "exit", code, signal }));
  }

  /** Record an event for the coordinator and send it if the link is up. */
  private emit(procId: string, event: HostProcessEvent): void {
    const hosted = this.processes.get(procId);
    if (!hosted || hosted.exited) return;
    if (event.kind === "exit") hosted.exited = true;
    const seq = hosted.nextSeq++;
    hosted.pending.push({ seq, event });
    if (this.connected) this.send({ t: "event", procId, seq, event });
  }

  private forgetIfDone(procId: string, hosted: HostedProcess): void {
    if (hosted.exited && hosted.pending.length === 0) this.processes.delete(procId);
  }

  private tick(): void {
    if (!this.socket || this.socket.readyState !== OPEN) return;
    if (Date.now() - this.lastHeardAt > HOST_LINK_STALE_MS) {
      const socket = this.socket;
      this.socket = null;
      socket.close(4002, "Heartbeat timeout");
      this.scheduleReconnect();
      return;
    }
    this.send({ t: "heartbeat", network: hasUsableNetwork() });
  }

  private send(message: HostToCoordinator): void {
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify(message));
  }
}

/**
 * Serve the coordinator's `/api` on a loopback port of this host, so agent CLIs
 * running here keep using `http://localhost:$COMPANION_PORT/api` unchanged.
 * Requests and responses pass through as-is, including session auth headers
 * and the Server-Timing header the CLI latency log reads.
 */
export function startApiProxy(options: { coordinatorUrl: string; port: number }): { port: number; stop: () => void } {
  const base = options.coordinatorUrl.replace(/\/+$/, "");
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: options.port,
    async fetch(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
      const headers = new Headers(request.headers);
      headers.delete("host");
      const started = performance.now();
      const response = await fetch(`${base}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { body: await request.arrayBuffer() }),
        redirect: "manual",
      });
      // Report the hop to the coordinator so the CLI latency log can separate it from local overhead.
      const relayed = new Headers(response.headers);
      relayed.append("server-timing", `takode-node-hop;dur=${(performance.now() - started).toFixed(1)}`);
      return new Response(response.body, { status: response.status, headers: relayed });
    },
  });
  return { port: server.port!, stop: () => server.stop(true) };
}

/**
 * Refuse to send the host token and session traffic unencrypted to another
 * machine. Plain http is accepted only for a coordinator on this machine (or
 * reached through a local tunnel), unless the caller explicitly allows it, for
 * example inside a private network that already encrypts traffic.
 */
export function insecureCoordinatorUrlProblem(coordinatorUrl: string, allowInsecure: boolean): string | null {
  let url: URL;
  try {
    url = new URL(coordinatorUrl);
  } catch {
    return `Not a valid coordinator URL: ${coordinatorUrl}`;
  }
  if (url.protocol === "https:") return null;
  if (url.protocol !== "http:") return `The coordinator URL must start with https:// or http://: ${coordinatorUrl}`;
  if (allowInsecure || isLoopbackHost(url.hostname)) return null;
  return (
    `${coordinatorUrl} is not encrypted, so the host token and session traffic would cross the network in the clear. ` +
    "Use an https:// coordinator URL, a local tunnel (http://127.0.0.1:...), or pass --allow-insecure if the network already encrypts traffic."
  );
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "[::1]" || hostname === "::1" || /^127\./.test(hostname);
}

/** Perform one coordinator request on this machine. */
export async function performHostRequest(request: HostRequest): Promise<HostResponse> {
  switch (request.kind) {
    case "exec":
      return runShell(request);
    case "read_file": {
      const handle = await open(request.path, "r");
      try {
        const size = (await handle.stat()).size;
        const length = Math.min(size, request.maxBytes);
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, 0);
        return { kind: "read_file", data: buffer.toString("base64"), truncated: size > request.maxBytes };
      } finally {
        await handle.close();
      }
    }
    case "stat": {
      const info = await stat(request.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw error;
      });
      return {
        kind: "stat",
        stat: info
          ? { size: info.size, isFile: info.isFile(), isDirectory: info.isDirectory(), mtimeMs: info.mtimeMs }
          : null,
      };
    }
    case "prepare_codex":
      throw new Error("Codex launches are prepared by the host agent");
    case "operation":
      return { kind: "operation", result: await performHostOperation(request.name, request.args) };
    case "write_file":
      await mkdir(dirname(request.path), { recursive: true });
      await writeFile(request.path, Buffer.from(request.data, "base64"), { mode: request.mode });
      return { kind: "write_file" };
  }
}

function runShell(request: Extract<HostRequest, { kind: "exec" }>): Promise<HostResponse> {
  return new Promise((resolve, reject) => {
    const child = spawnChild("/bin/sh", ["-c", request.command], {
      cwd: request.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    const capture = (target: Buffer[]) => (chunk: Buffer) => {
      if (bytes >= request.maxOutputBytes) {
        truncated = true;
        return;
      }
      const room = request.maxOutputBytes - bytes;
      const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (kept.length < chunk.length) truncated = true;
      bytes += kept.length;
      target.push(kept);
    };
    child.stdout?.on("data", capture(out));
    child.stderr?.on("data", capture(err));
    const timer = setTimeout(() => child.kill("SIGKILL"), request.timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({
        kind: "exec",
        code,
        signal,
        stdout: Buffer.concat(out).toString("utf-8"),
        stderr: Buffer.concat(err).toString("utf-8"),
        truncated,
      });
    });
  });
}

async function prepareCodexWithThisInstall(sessionId: string, info: unknown, options: Record<string, unknown>) {
  const { prepareCodexSpawn } = await import("../cli-launcher-codex.js");
  return prepareCodexSpawn(
    sessionId,
    info as Parameters<typeof prepareCodexSpawn>[1],
    options as Parameters<typeof prepareCodexSpawn>[2],
  );
}

function linkUrl(coordinatorUrl: string): string {
  const url = new URL(coordinatorUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = HOST_LINK_PATH;
  url.search = "";
  return url.toString();
}

function defaultSpawn(command: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv }) {
  return spawnChild(command, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
