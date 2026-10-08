import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { HOST_HEARTBEAT_MS, HOST_LINK_STALE_MS } from "../../shared/host-protocol.js";
import type { HostLinkManager } from "./host-link-manager.js";
import { LOCAL_HOST_ID, type HostRegistry } from "./host-registry.js";

const execFileAsync = promisify(execFile);

/** How long a running node may stay disconnected before it is replaced. */
const CONNECT_GRACE_MS = HOST_LINK_STALE_MS;

export interface LocalNodeOptions {
  serverId: string;
  /** This server's own address on the loopback interface, e.g. `http://127.0.0.1:3456`. */
  coordinatorUrl: string;
  /** `takode-node.ts` in this server's checkout. */
  nodeScript: string;
  registry: HostRegistry;
  links: HostLinkManager;
  /** Holds the node's token, pid and log; `~/.companion` unless a test supplies another. */
  companionDir?: string;
  now?: () => number;
  /** Start the node detached from this server and return its pid; tests supply a stand-in. */
  startProcess?: (args: string[], logPath: string) => Promise<number>;
  /** Whether `pid` is this server's node, recognized by its token file argument. */
  isNodeProcess?: (pid: number, tokenFile: string) => Promise<boolean>;
  signal?: (pid: number, signal: NodeJS.Signals) => void;
  log?: (message: string) => void;
}

/**
 * This machine's own `takode node`. While it is turned on (Settings > Hosts >
 * This machine), the server keeps the node running and sessions without a
 * remote host run their processes under it. Those processes then outlive a
 * server restart: the restarted server takes them over when the node
 * reconnects, exactly as for a remote host.
 *
 * The node runs detached, so it outlives the server. A starting server finds
 * the node by its saved pid, checked against the process's command line so a
 * reused pid is never mistaken for it, and lets it reconnect. A node that is
 * gone, or stays disconnected for longer than the grace period, is replaced.
 * Once turned off, a node still running from before keeps its processes until
 * they end, and is then stopped. Stopping the server ends the node too; only a
 * restart leaves it running for the next server.
 */
export class LocalNode {
  private readonly tokenFile: string;
  private readonly pidFile: string;
  private readonly logFile: string;
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  /** When the node was last seen disconnected without having connected since; null while connected. */
  private offlineSince: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking: Promise<void> | null = null;
  /** A node did not connect within the grace period, and none has connected since. */
  private failedToConnect = false;
  /** Set when the server stops, so nothing starts the node again. */
  private shutDown = false;

  constructor(private readonly options: LocalNodeOptions) {
    const dir = options.companionDir ?? join(homedir(), ".companion");
    this.tokenFile = join(dir, "hosts", `${options.serverId}-local-node.token`);
    this.pidFile = join(dir, "hosts", `${options.serverId}-local-node.pid`);
    this.logFile = join(dir, "logs", `local-node-${options.serverId}.log`);
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((message) => console.log(`[local-node] ${message}`));
  }

  /** Start supervising: now, on every heartbeat, and whenever the node's link changes. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), HOST_HEARTBEAT_MS);
    this.timer.unref?.();
    this.options.links.onStatusChange((status) => {
      if (status.hostId === LOCAL_HOST_ID) void this.check();
    });
    void this.check();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * End the node for good when the server stops; its sessions should already
   * be stopped, and the node ends any process still running under it.
   */
  async shutdown(): Promise<void> {
    this.shutDown = true;
    this.stop();
    await this.checking;
    const pid = await this.runningPid();
    if (pid === null) return;
    this.log(`Stopping the local node (pid ${pid}) with the server`);
    this.signal(pid, "SIGTERM");
  }

  /**
   * Whether sessions without a host should start their processes under the
   * node now. A node that is starting or reconnecting takes them too, and they
   * start once it connects, so sessions launched just after a server start do
   * not miss it. Once a node fails to connect in time, launches start directly
   * until one connects.
   */
  ready(): boolean {
    if (!this.options.registry.localNodeEnabled()) return false;
    if (this.options.links.status(LOCAL_HOST_ID).online) return true;
    return this.offlineSince !== null && !this.failedToConnect;
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.options.registry.setLocalNodeEnabled(enabled);
    // A check already running may have read the old setting.
    await this.checking;
    await this.check();
  }

  /** Bring the node in line with the setting. Concurrent calls share one run. */
  check(): Promise<void> {
    if (this.shutDown) return Promise.resolve();
    this.checking ??= this.reconcile()
      .catch((error) => this.log(`Check failed: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        this.checking = null;
      });
    return this.checking;
  }

  private async reconcile(): Promise<void> {
    const { registry, links } = this.options;
    const enabled = registry.localNodeEnabled();
    const status = links.status(LOCAL_HOST_ID);
    if (status.online) {
      this.offlineSince = null;
      this.failedToConnect = false;
      if (!enabled && status.processes === 0) {
        const pid = await this.runningPid();
        if (pid !== null) {
          this.log(`Stopping the local node (pid ${pid}); it was turned off and runs no sessions`);
          this.signal(pid, "SIGTERM");
        }
      }
      return;
    }
    const now = this.now();
    this.offlineSince ??= now;
    const waitedOut = now - this.offlineSince >= CONNECT_GRACE_MS;
    const pid = await this.runningPid();
    // A node that is starting or reconnecting gets the grace period.
    if (pid !== null && !waitedOut) return;
    if (pid !== null) {
      this.log(`The local node (pid ${pid}) has not connected for ${CONNECT_GRACE_MS / 1000}s; replacing it`);
      this.signal(pid, "SIGTERM");
    }
    if (waitedOut) this.failedToConnect = true;
    // Nothing will take over processes still waiting for a node that is gone.
    if (!enabled || waitedOut) links.release(LOCAL_HOST_ID, "This machine's node is not running");
    if (enabled) await this.launch();
  }

  private async launch(): Promise<void> {
    await this.ensureTokenFile();
    await mkdir(dirname(this.logFile), { recursive: true });
    const args = [
      this.options.nodeScript,
      "--coordinator",
      this.options.coordinatorUrl,
      "--token-file",
      this.tokenFile,
      "--shared-checkout",
      // The URL is an address of this machine, so the token never crosses a network.
      "--allow-insecure",
    ];
    const pid = await (this.options.startProcess ?? startDetached)(args, this.logFile);
    await writeFile(this.pidFile, String(pid), "utf-8");
    this.offlineSince = this.now();
    this.log(`Started the local node (pid ${pid}); its log is ${this.logFile}`);
  }

  /** Keep the node's token file valid, issuing a new token when it is missing or no longer accepted. */
  private async ensureTokenFile(): Promise<void> {
    const saved = (await readFile(this.tokenFile, "utf-8").catch(() => "")).trim();
    if (saved && (await this.options.registry.authenticate(saved))?.id === LOCAL_HOST_ID) return;
    const token = await this.options.registry.issueLocalNodeToken();
    await mkdir(dirname(this.tokenFile), { recursive: true });
    await writeFile(this.tokenFile, token, { encoding: "utf-8", mode: 0o600 });
  }

  /** The pid of this server's running node, or null. */
  private async runningPid(): Promise<number | null> {
    const pid = Number((await readFile(this.pidFile, "utf-8").catch(() => "")).trim());
    if (!Number.isInteger(pid) || pid <= 0) return null;
    return (await (this.options.isNodeProcess ?? isNodeProcess)(pid, this.tokenFile)) ? pid : null;
  }

  private signal(pid: number, signal: NodeJS.Signals): void {
    try {
      (this.options.signal ?? process.kill)(pid, signal);
    } catch (error) {
      this.log(`Could not signal pid ${pid}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * This server's URL for a node on the same machine: loopback when the server
 * listens on every interface, else the one address it listens on.
 */
export function localCoordinatorUrl(listenHost: string, port: number): string {
  const host = listenHost === "0.0.0.0" || listenHost === "::" ? "127.0.0.1" : listenHost;
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}

/** Start the node in its own session, so it outlives this server, with its output appended to `logPath`. */
async function startDetached(args: string[], logPath: string): Promise<number> {
  const log = await open(logPath, "a");
  try {
    const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", log.fd, log.fd] });
    child.once("error", (error) => console.error(`[local-node] Could not start the local node: ${error.message}`));
    child.unref();
    if (!child.pid) throw new Error("The local node did not start");
    return child.pid;
  } finally {
    await log.close();
  }
}

async function isNodeProcess(pid: number, tokenFile: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "command=", "-p", String(pid)]);
    return stdout.includes(tokenFile);
  } catch {
    // `ps` fails when no process has this pid.
    return false;
  }
}
