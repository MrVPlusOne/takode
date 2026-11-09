import { createReadStream, mkdirSync } from "node:fs";
import { appendFile, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { inheritedLaunchEnv } from "../cli-launcher-env.js";
import { getEnrichedPath } from "../path-resolver.js";
import { LOCAL_HOST_ID, type HostProcessEvent } from "../../shared/host-protocol.js";
import { describeExecOutcome, HOST_EXEC_MESSAGE_TAG, type ExecJob } from "../../shared/host-exec.js";
import { formatLeaseWaitDuration as formatDuration } from "../../shared/resource-lease-message.js";
import type { BackgroundTaskSnapshot } from "../bridge/adapter-interface.js";
import type { ResourceLeaseManager } from "../resource-lease-manager.js";
import type { ResourceLease } from "../resource-lease-types.js";
import type { HostLinkManager, RemoteProcess } from "./host-link-manager.js";

/** A request `takode exec` cannot carry out, with the HTTP status to answer with. */
export class HostExecError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = "HostExecError";
  }
}

export interface HostExecDeps {
  links: Pick<HostLinkManager, "spawn" | "adopt" | "startBlocker" | "supports">;
  /** The machine a name or id names: a registered host, or this machine as `local`. */
  resolveHost: (nameOrId: string) => Promise<{ id: string; name: string } | null>;
  /** Names of every machine `takode exec` can reach, for the unknown-host error. */
  machineNames: () => Promise<string[]>;
  /** Whether the user turned commands off for a machine in Settings. */
  execDisabled: (hostId: string) => boolean;
  /**
   * Tell a session that a command it started with the retired `--background`
   * flag finished. Only commands a previous coordinator left running use it.
   */
  notify: (sessionId: string, text: string) => void;
  /** A session's running commands changed, which its waits and the board's stall check read. */
  onSessionChange?: (sessionId: string) => void;
  /**
   * Lease pools, for `--pool`: each command holds a slot of its pool while it
   * runs. Without them `--pool` is refused.
   */
  leases?: Pick<ResourceLeaseManager, "hold" | "renewHold" | "releaseHold" | "registerSystemOwner" | "capacities">;
  /** Where job records and output logs are kept. */
  dir: string;
  now?: () => number;
  /** Override of CALLER_GONE_MS for tests. */
  callerGoneMs?: number;
  /** Override of CALLER_CHECK_MS for tests. */
  callerCheckMs?: number;
  /** Override of SLOT_START_WAIT_MS for tests. */
  slotStartWaitMs?: number;
}

export interface ExecStartInput {
  sessionId: string;
  sessionNum: number | null;
  questId: string | null;
  host: string;
  command: string;
  cwd?: string | null;
  /** Kill it all once its processes use more memory than this together. */
  memoryLimitBytes?: number | null;
  /**
   * Run it while holding a slot of this lease pool, waiting in line when the
   * pool is full. `name@machine` pins a machine, as does `host`; with neither,
   * any machine where `name@<machine>` has a configured capacity.
   */
  pool?: string | null;
}

export interface ExecOutput {
  output: string;
  /** Bytes of the stored output; more than `output` holds when it was shortened. */
  bytes: number;
  truncated: boolean;
}

/**
 * Runs the command (`$1`) as a login shell of the machine user's own shell
 * (their passwd entry, since a node started by a scheduler may have no
 * `$SHELL`), so their profile's PATH, tools and shell syntax apply, in the
 * folder `$2` (their home when empty; a leading `~` is their home too). The
 * machine's shell resolves all of these, since only it knows them; a missing
 * folder fails with the shell's own message.
 *
 * For POSIX-family shells, whatever the profile prints (cluster profiles warn
 * about completion packages, banners) is dropped: the command's own output
 * is all that comes back. Other shells (fish, csh) run the command plainly.
 */
export const LOGIN_SHELL_SCRIPT = [
  'dir=${2:-$HOME}; case $dir in "~") dir=$HOME ;; "~/"*) dir=$HOME/${dir#"~/"} ;; esac',
  'cd -- "$dir" || exit 1',
  "user=$(id -un 2>/dev/null)",
  'sh=$(getent passwd "$user" 2>/dev/null | cut -d: -f7)',
  '[ -n "$sh" ] || sh=$(dscl . -read "/Users/$user" UserShell 2>/dev/null | sed "s/^UserShell: *//")',
  '[ -x "$sh" ] || sh=${SHELL:-/bin/sh}',
  '[ -x "$sh" ] || sh=/bin/sh',
  "SHELL=$sh; export SHELL",
  "case ${sh##*/} in",
  '  bash|zsh|sh|dash|ksh|mksh) exec "$sh" -lc \'exec 1>&3 2>&4 3>&- 4>&-; eval "$1"\' "$sh" "$1" 3>&1 4>&2 >/dev/null 2>&1 ;;',
  '  *) exec "$sh" -lc "$1" ;;',
  "esac",
].join("\n");
/**
 * How long a command keeps running without its caller asking about it. The
 * CLI asks at least every 30 s and keeps retrying as long as this while the
 * coordinator is unreachable, so past it the caller is gone (killed without a
 * chance to stop the command) and the command is stopped, as a local command
 * ends with its shell.
 */
const CALLER_GONE_MS = 5 * 60_000;
/** How often running commands are checked for a caller that is gone. */
const CALLER_CHECK_MS = 15_000;
/** Finished records kept; older ones are dropped with their logs. */
const MAX_FINISHED_RECORDS = 500;
const MAX_COMMAND_LENGTH = 100_000;
/** Output kept from the start of a command; past it only the last LOG_TAIL_BYTES are kept. */
const LOG_HEAD_BYTES = 100 * 1024 * 1024;
const LOG_TAIL_BYTES = 4 * 1024 * 1024;
/** Output shown by default: this much from both ends of longer output. */
export const EXEC_EXCERPT_BYTES = 20_000;
const TAIL_READ_BYTES = 256 * 1024;
const NOTIFY_TAIL_LINES = 15;
const NOTIFY_TAIL_CHARS = 2_000;
const LOG_FLUSH_MS = 200;
/** Holder IDs of the pool slots commands hold, `exec:<job id>`. */
const EXEC_HOLDER_PREFIX = "exec:";
/**
 * How long a command's slot, or place in line, outlasts the coordinator's last
 * renewal (every CALLER_CHECK_MS), so a restart keeps it.
 */
const EXEC_HOLD_TTL_MS = 10 * 60_000;
const POOL_NAME = /^[a-z0-9][a-z0-9._:/-]*$/;
/** How long a command that got its slot waits for its machine to come back (reconnecting or updating) before failing. */
const SLOT_START_WAIT_MS = 5 * 60_000;
const SLOT_START_RETRY_MS = 2_000;

interface StoredJob extends ExecJob {
  /** The host-link process id, for taking the process over after a coordinator restart. */
  procId: string;
  /**
   * Started with the retired `--background` flag by an earlier coordinator:
   * it has no caller waiting, so it runs to the end and its session is sent
   * the outcome, as it was promised. Remove once no such command can remain.
   */
  legacyBackground?: boolean;
  /** The pools (one per machine it may run on) a command waiting for a slot is in line for. */
  poolKeys?: string[];
}

interface StoredFile {
  nextId: number;
  jobs: StoredJob[];
}

/** A command waiting for a slot of its pool. */
interface QueuedJob {
  /** When its caller last asked about it, or it was queued or taken over. */
  callerSeenAt: number;
  /** Callers waiting for it to start or end. */
  waiters: Set<() => void>;
}

interface RunningJob {
  proc: RemoteProcess;
  log: JobLog;
  /** When it last wrote output, or started: a sign it is not hung. */
  lastOutputAt: number;
  /** When its caller last asked about it, or it started or was taken over. */
  callerSeenAt: number;
  /** Callers waiting for the job to end. */
  waiters: Set<() => void>;
}

/**
 * `takode exec`: commands sessions run on any machine with a `takode node`
 * (registered hosts and the coordinator's own machine). Every call is recorded
 * with its session, quest, machine, command, outcome and times, and its output
 * is kept in a log on the coordinator. A command is a host-link process, so it
 * replays output across link drops and a restarted coordinator takes running
 * ones over. Its caller waits for it to end, like for a local command; a
 * command whose caller went away is stopped.
 */
export class HostExec {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly running = new Map<string, RunningJob>();
  private readonly queued = new Map<string, QueuedJob>();
  private callerCheck: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private pendingSave: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly deps: HostExecDeps) {
    this.now = deps.now ?? Date.now;
    mkdirSync(this.logDir, { recursive: true }); // sync-ok: cold path, once during construction
    deps.leases?.registerSystemOwner(EXEC_HOLDER_PREFIX, (lease) => {
      void this.onSlot(lease).catch((error) => console.error(`[host-exec] Could not start ${lease.holderId}:`, error));
    });
  }

  /** Load the records and take over the commands a previous coordinator left running. Call before hosts connect. */
  async restore(): Promise<void> {
    const file = await readStoredFile(this.recordsPath);
    this.nextId = file.nextId;
    for (const stored of file.jobs) {
      const { background, ...job } = stored as StoredJob & { background?: boolean };
      if (background && job.status === "running") job.legacyBackground = true;
      this.jobs.set(job.id, job);
      // In line before any lease call, so a slot promoted while restoring finds its command.
      if (job.status === "queued") this.queued.set(job.id, { callerSeenAt: this.now(), waiters: new Set() });
    }
    for (const job of this.jobs.values()) {
      if (job.status !== "running") continue;
      const logged = await stat(this.logPath(job.id)).then(
        (info) => info.size,
        () => 0,
      );
      this.attach(job, this.deps.links.adopt(job.hostId, job.procId), logged);
    }
    await this.restorePoolSlots();
  }

  /** A machine by name or id (`LOCAL_HOST_ID` for the coordinator's own), or null when none has it. */
  findMachine(nameOrId: string): Promise<{ id: string; name: string } | null> {
    return this.deps.resolveHost(nameOrId);
  }

  async start(input: ExecStartInput): Promise<ExecJob> {
    const command = input.command.trim();
    if (!command) throw new HostExecError(400, "Give the command to run after --");
    if (command.length > MAX_COMMAND_LENGTH) throw new HostExecError(400, "The command is too long");
    const memoryLimitBytes = input.memoryLimitBytes ?? null;
    const pool = input.pool?.trim().toLowerCase() || null;
    if (pool) return this.startPooled(input, command, pool, memoryLimitBytes);
    const machine = await this.machine(input.host.trim());
    const unusable = this.unusable(machine, memoryLimitBytes);
    if (unusable) throw unusable;
    const job = this.newJob(input, command, memoryLimitBytes, machine, null);
    this.launch(job, machine);
    this.pruneFinished();
    await this.save();
    this.deps.onSessionChange?.(job.sessionId);
    return publicJob(job);
  }

  get(id: string): ExecJob | null {
    const job = this.jobs.get(id);
    return job ? publicJob(job) : null;
  }

  /** The command running as host-link process `procId`, if it is one. */
  forProcess(procId: string): ExecJob | null {
    const job = [...this.jobs.values()].find((candidate) => candidate.procId === procId);
    return job ? publicJob(job) : null;
  }

  /**
   * The node's memory guard killed the command running as host-link process
   * `procId`: kept for its outcome. Returns the command, or null when the
   * process is not one.
   */
  memoryKilled(procId: string, kill: Extract<HostProcessEvent, { kind: "memory_kill" }>): ExecJob | null {
    const job = [...this.jobs.values()].find((candidate) => candidate.procId === procId);
    if (!job) return null;
    job.memoryKill = { reason: kill.reason ?? "machine", bytes: kill.bytes, programs: kill.programs };
    return publicJob(job);
  }

  /** Records newest first, optionally only one session's. */
  list(options: { sessionId?: string; limit?: number } = {}): ExecJob[] {
    const jobs = [...this.jobs.values()]
      .filter((job) => !options.sessionId || job.sessionId === options.sessionId)
      .sort((a, b) => b.startedAt - a.startedAt);
    return jobs.slice(0, options.limit ?? jobs.length).map(publicJob);
  }

  /**
   * The session's running commands, for its waits and the board's stall check:
   * work in progress even while the session is idle, as when its agent runs
   * the call in its own background shell or terminal. A command counts as
   * live for as long after its latest output as a job after its start;
   * `changedAt` is when one of its commands last started or ended.
   * `notifyingOnly` keeps only commands whose end sends the session a message,
   * which are the only ones that start its next turn.
   */
  backgroundTasks(sessionId: string, options: { notifyingOnly?: boolean } = {}): BackgroundTaskSnapshot | null {
    const own = [...this.jobs.values()].filter(
      (job) => job.sessionId === sessionId && (!options.notifyingOnly || job.legacyBackground),
    );
    if (own.length === 0) return null;
    const tasks = own.flatMap((job) => {
      const command = job.command.length > 80 ? `${job.command.slice(0, 80)}...` : job.command;
      if (this.queued.has(job.id)) {
        return [
          {
            taskId: job.id,
            description: `takode exec waiting for a slot of ${job.pool}: ${command}`,
            startedAt: job.startedAt,
            activeAt: job.startedAt,
          },
        ];
      }
      const running = this.running.get(job.id);
      if (!running) return [];
      return [
        {
          taskId: job.id,
          description: `takode exec on ${job.host}: ${command}`,
          startedAt: job.startedAt,
          activeAt: running.lastOutputAt,
        },
      ];
    });
    return { tasks, changedAt: Math.max(...own.map((job) => job.endedAt ?? job.startedAt)) };
  }

  /** Whether a command runs on the machine; restarting its node would end it. */
  runningOn(hostId: string): boolean {
    return [...this.running.keys()].some((id) => this.jobs.get(id)?.hostId === hostId);
  }

  /** Wait up to `ms` for the job to end, and return it. */
  async wait(id: string, ms: number): Promise<ExecJob | null> {
    const running = this.running.get(id) ?? this.queued.get(id);
    if (running) {
      running.callerSeenAt = this.now();
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          running!.waiters.delete(done);
          resolve();
        }
        running.waiters.add(done);
      });
      running.callerSeenAt = this.now();
    }
    return this.get(id);
  }

  /**
   * Answers every caller waiting on a command now, with its current state, as the server shuts
   * down. A shutdown waits for requests it already accepted, and a wait could hold it 30 s. The
   * commands keep running and the next server takes them over, so callers simply ask again.
   */
  releaseWaits(): void {
    for (const running of [...this.running.values(), ...this.queued.values()]) {
      for (const done of [...running.waiters]) done();
    }
  }

  /**
   * Stop a running command and everything it started. The host sends SIGTERM,
   * then SIGKILL to whatever still runs after a grace period, including
   * processes the command's shell left behind when it exited.
   */
  kill(id: string): ExecJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === "queued") this.stopQueued(job, `stopped while it waited for a slot of ${job.pool}`);
    this.running.get(id)?.proc.kill("SIGTERM");
    return publicJob(job);
  }

  /** Take a command that has no slot yet out of line and end it. */
  private stopQueued(job: StoredJob, error: string): void {
    const waiters = [...(this.queued.get(job.id)?.waiters ?? [])];
    this.end(job, error);
    void this.deps.leases
      ?.releaseHold(`${EXEC_HOLDER_PREFIX}${job.id}`)
      .catch((err) => console.error(`[host-exec] Could not take ${job.id} out of line:`, err));
    void this.save();
    for (const done of waiters) done();
    this.deps.onSessionChange?.(job.sessionId);
  }

  /**
   * The job's output as a foreground run shows it: all of it when short,
   * else both ends with a note on reading the rest ({@link readLog});
   * `tailLines` for its last lines.
   */
  async readOutput(id: string, options: { tailLines?: number } = {}): Promise<ExecOutput | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    await this.running.get(id)?.log.flush();
    const path = this.logPath(id);
    const bytes = await logSize(path);
    if (bytes === 0) return { output: "", bytes, truncated: false };
    if (options.tailLines !== undefined) {
      const start = Math.max(0, bytes - TAIL_READ_BYTES);
      const lines = (await readRange(path, start, bytes)).split("\n");
      if (lines.at(-1) === "") lines.pop();
      const kept = lines.slice(-Math.max(1, options.tailLines));
      return { output: `${kept.join("\n")}\n`, bytes, truncated: kept.length < lines.length || start > 0 };
    }
    if (bytes <= EXEC_EXCERPT_BYTES) return { output: await readFile(path, "utf-8"), bytes, truncated: false };
    return { output: await excerpt(path, bytes, id), bytes, truncated: true };
  }

  /**
   * The job's output as a stream: all of it, or only a 1-based inclusive range
   * of its lines or bytes.
   */
  async readLog(
    id: string,
    options: { lines?: [number, number]; bytes?: [number, number] } = {},
  ): Promise<Readable | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    await this.running.get(id)?.log.flush();
    const path = this.logPath(id);
    if ((await logSize(path)) === 0) return Readable.from([]);
    if (options.bytes) return createReadStream(path, { start: options.bytes[0] - 1, end: options.bytes[1] - 1 });
    if (options.lines) return Readable.from(lineRange(path, options.lines[0], options.lines[1]));
    return createReadStream(path);
  }

  /**
   * `--pool`: hold a slot of the pool while the command runs. It starts at
   * once on the machine with the most free slots, or waits in line on every
   * machine it may run on and starts on the first whose slot frees up.
   */
  private async startPooled(
    input: ExecStartInput,
    command: string,
    pool: string,
    memoryLimitBytes: number | null,
  ): Promise<ExecJob> {
    const leases = this.deps.leases;
    if (!leases) throw new HostExecError(400, "Lease pools are not available on this server");
    const [name, pinned] = pool.split("@", 2) as [string, string | undefined];
    if (!POOL_NAME.test(name)) {
      throw new HostExecError(400, "A pool name uses letters, numbers, dot, underscore, colon, slash or hyphen");
    }
    const host = pinned ?? input.host.trim();
    let candidates: Array<{ id: string; name: string }>;
    if (host) {
      const machine = await this.machine(host);
      const unusable = this.unusable(machine, memoryLimitBytes);
      if (unusable) throw unusable;
      candidates = [machine];
    } else {
      candidates = await this.poolMachines(name, memoryLimitBytes);
    }
    const job = this.newJob(input, command, memoryLimitBytes, null, name);
    const capacities = await leases.capacities();
    job.poolKeys = candidates.map((machine) => poolKey(name, machine, capacities));
    job.host = candidates.map((machine) => machine.name).join(" or ");
    this.queued.set(job.id, { callerSeenAt: this.now(), waiters: new Set() });
    this.startCallerCheck();
    this.pruneFinished();
    const state = await leases
      .hold({
        resourceKeys: job.poolKeys,
        holderId: `${EXEC_HOLDER_PREFIX}${job.id}`,
        callerSessionId: job.sessionId,
        ...(job.questId ? { questId: job.questId } : {}),
        purpose: `takode exec ${job.id}: ${command.length > 200 ? `${command.slice(0, 200)}...` : command}`,
        metadata: { exec: job.id },
        ttlMs: EXEC_HOLD_TTL_MS,
      })
      .catch((error: Error) => {
        this.end(job, error.message);
        throw new HostExecError(400, error.message);
      });
    if (state.status === "held") await this.onSlot(state.lease);
    else {
      await this.save();
      console.log(`[host-exec] ${job.id} waits for a slot of ${job.poolKeys.join(", ")}`);
    }
    this.deps.onSessionChange?.(job.sessionId);
    return publicJob(job);
  }

  /** Machines where the pool has a configured capacity and commands can start now. */
  private async poolMachines(
    name: string,
    memoryLimitBytes: number | null,
  ): Promise<Array<{ id: string; name: string }>> {
    const capacities = await this.deps.leases!.capacities();
    const machines: Array<{ id: string; name: string }> = [];
    const skipped: string[] = [];
    for (const machineName of await this.deps.machineNames()) {
      const machine = await this.deps.resolveHost(machineName);
      if (!machine || !Object.hasOwn(capacities, poolKey(name, machine, capacities))) continue;
      const unusable = this.unusable(machine, memoryLimitBytes);
      if (unusable) skipped.push(unusable.message);
      else machines.push(machine);
    }
    if (machines.length > 0) return machines;
    if (skipped.length > 0)
      throw new HostExecError(409, `No machine of pool ${name} can run it: ${skipped.join("; ")}`);
    throw new HostExecError(
      404,
      `No machine has a ${name} pool; a leader sets one up with takode lease configure ${name}@<machine> --capacity <n>, or name the machine with --host`,
    );
  }

  private async machine(nameOrId: string): Promise<{ id: string; name: string }> {
    const machine = await this.deps.resolveHost(nameOrId);
    if (machine) return machine;
    const names = await this.deps.machineNames();
    // Pool keys are lowercase, so a machine they name may differ in case.
    const named = names.find((name) => name.toLowerCase() === nameOrId.toLowerCase());
    const found = named ? await this.deps.resolveHost(named) : null;
    if (found) return found;
    throw new HostExecError(404, `No machine named ${nameOrId}; machines: ${names.join(", ") || "none"}`);
  }

  /** Why a command cannot start on the machine now, or null when it can. */
  private unusable(machine: { id: string; name: string }, memoryLimitBytes: number | null): HostExecError | null {
    if (this.deps.execDisabled(machine.id)) {
      return new HostExecError(403, `Running commands on ${machine.name} is turned off in Settings → Hosts`);
    }
    const blocker = this.deps.links.startBlocker(machine.id);
    if (blocker) return new HostExecError(409, `Host ${machine.name} ${blocker}`);
    if (memoryLimitBytes !== null && !this.deps.links.supports(machine.id, "memory_limit")) {
      return new HostExecError(
        409,
        `The Takode node on ${machine.name} cannot enforce --memory-limit yet; it updates itself once its sessions are idle`,
      );
    }
    return null;
  }

  private newJob(
    input: ExecStartInput,
    command: string,
    memoryLimitBytes: number | null,
    machine: { id: string; name: string } | null,
    pool: string | null,
  ): StoredJob {
    const job: StoredJob = {
      id: `x-${this.nextId++}`,
      procId: "",
      hostId: machine?.id ?? "",
      host: machine?.name ?? "",
      command,
      cwd: input.cwd?.trim() || null,
      sessionId: input.sessionId,
      sessionNum: input.sessionNum,
      questId: input.questId,
      status: machine ? "running" : "queued",
      startedAt: this.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      outputBytes: 0,
      memoryLimitBytes,
      memoryKill: null,
      ...(pool ? { pool, slot: null, runningAt: null } : {}),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  /** Start the job's process on the machine. */
  private launch(job: StoredJob, machine: { id: string; name: string }): void {
    const proc = this.deps.links.spawn(machine.id, {
      command: "/bin/sh",
      args: ["-c", LOGIN_SHELL_SCRIPT, "takode-exec", job.command, job.cwd ?? ""],
      // This machine's own node takes a complete environment; other hosts use their own.
      env: machine.id === LOCAL_HOST_ID ? { ...inheritedLaunchEnv(process.env), PATH: getEnrichedPath() } : {},
      group: true,
      ...(job.memoryLimitBytes ? { memoryLimitBytes: job.memoryLimitBytes } : {}),
    });
    // Like `ssh -n`: a command waiting for input would otherwise hang.
    proc.stdin.end();
    job.procId = proc.procId;
    job.hostId = machine.id;
    job.host = machine.name;
    job.status = "running";
    this.attach(job, proc, 0);
    console.log(`[host-exec] ${job.id} started on ${job.host} for session ${job.sessionNum ?? job.sessionId}`);
  }

  /** A queued command got its slot: start it on the slot's machine, or give the slot back. */
  private async onSlot(lease: ResourceLease): Promise<void> {
    const job = this.jobs.get(lease.holderId?.slice(EXEC_HOLDER_PREFIX.length) ?? "");
    // A restart can report the same slot twice: once promoted, once found held.
    if (job?.slot?.resourceKey === lease.resourceKey && job.slot.slot === lease.slot) return;
    const queued = job && this.queued.get(job.id);
    if (!job || !queued) {
      await this.deps.leases?.releaseHold(lease.holderId!);
      return;
    }
    // Claimed before any wait, so a second report of the slot is recognized above.
    job.slot = { resourceKey: lease.resourceKey, slot: lease.slot };
    job.poolKeys = undefined;
    const machine = await this.machineForPoolKey(lease.resourceKey);
    let unusable = machine ? this.unusable(machine, job.memoryLimitBytes ?? null) : null;
    // A machine that is reconnecting (after a coordinator restart) or updating its node is waited for.
    const deadline = this.now() + (this.deps.slotStartWaitMs ?? SLOT_START_WAIT_MS);
    while (machine && unusable && this.deps.links.startBlocker(machine.id) && this.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, SLOT_START_RETRY_MS));
      if (job.status !== "queued") return; // stopped meanwhile, which gave the slot back
      unusable = this.unusable(machine, job.memoryLimitBytes ?? null);
    }
    this.queued.delete(job.id);
    if (!machine || unusable) {
      await this.deps.leases?.releaseHold(lease.holderId!);
      this.end(job, unusable?.message ?? `No machine for ${lease.resourceKey} any more`);
    } else {
      job.runningAt = this.now();
      this.launch(job, machine);
      const running = this.running.get(job.id);
      if (running) running.callerSeenAt = queued.callerSeenAt;
    }
    await this.save();
    for (const done of [...queued.waiters]) done();
    this.deps.onSessionChange?.(job.sessionId);
  }

  /** The machine a pool key's slots are on: `name@machine`, or the coordinator's own for a bare name. */
  private async machineForPoolKey(resourceKey: string): Promise<{ id: string; name: string } | null> {
    const at = resourceKey.indexOf("@");
    if (at === -1) return this.deps.resolveHost(LOCAL_HOST_ID);
    return this.machine(resourceKey.slice(at + 1)).catch(() => null);
  }

  /** End a job that never ran: stopped before it got a slot, or its machine could not take it. */
  private end(job: StoredJob, error: string): void {
    this.queued.delete(job.id);
    job.status = "failed";
    job.error = error;
    job.endedAt = this.now();
    console.log(`[host-exec] ${job.id}: ${describeExecOutcome(job)}`);
  }

  /**
   * After a restart: renew the slots and places in line of pooled commands,
   * put back in line a waiting command whose place expired while the
   * coordinator was down, and start one whose slot came free meanwhile.
   */
  private async restorePoolSlots(): Promise<void> {
    const leases = this.deps.leases;
    if (!leases) return;
    for (const job of this.jobs.values()) {
      if (!job.pool || (job.status !== "queued" && job.status !== "running")) continue;
      const holderId = `${EXEC_HOLDER_PREFIX}${job.id}`;
      let state = await leases.renewHold(holderId);
      if (job.status === "running") {
        if (state.status !== "held")
          console.warn(`[host-exec] ${job.id} runs without its ${job.pool} slot, which expired`);
        continue;
      }
      this.startCallerCheck();
      if (state.status === "gone" && job.poolKeys?.length) {
        state = await leases.hold({
          resourceKeys: job.poolKeys,
          holderId,
          callerSessionId: job.sessionId,
          purpose: `takode exec ${job.id}: ${job.command.slice(0, 200)}`,
          metadata: { exec: job.id },
          ttlMs: EXEC_HOLD_TTL_MS,
        });
      }
      if (state.status === "held")
        void this.onSlot(state.lease).catch((error) => console.error(`[host-exec] Could not start ${job.id}:`, error));
      else if (state.status === "gone") this.stopQueued(job, `its place in line for ${job.pool} was lost`);
    }
  }

  /** Keep pooled commands' slots and places in line while they run or wait. */
  private renewPoolSlots(): void {
    const leases = this.deps.leases;
    if (!leases) return;
    for (const job of this.jobs.values()) {
      if (!job.pool || (job.status !== "queued" && job.status !== "running")) continue;
      void leases.renewHold(`${EXEC_HOLDER_PREFIX}${job.id}`).catch((error) => {
        console.warn(`[host-exec] Could not renew the ${job.pool} slot of ${job.id}:`, error);
      });
    }
  }

  private startCallerCheck(): void {
    if (this.callerCheck) return;
    this.callerCheck = setInterval(() => {
      this.stopAbandoned();
      this.renewPoolSlots();
    }, this.deps.callerCheckMs ?? CALLER_CHECK_MS);
    this.callerCheck.unref?.();
  }

  private get logDir(): string {
    return join(this.deps.dir, "logs");
  }

  private get recordsPath(): string {
    return join(this.deps.dir, "jobs.json");
  }

  private logPath(id: string): string {
    return join(this.logDir, `${id}.log`);
  }

  private attach(job: StoredJob, proc: RemoteProcess, logged: number): void {
    const log = new JobLog(this.logPath(job.id), logged, Math.max(job.outputBytes, logged));
    const running: RunningJob = { proc, log, lastOutputAt: this.now(), callerSeenAt: this.now(), waiters: new Set() };
    this.running.set(job.id, running);
    this.startCallerCheck();
    const output = (chunk: Buffer) => {
      running.lastOutputAt = this.now();
      log.write(chunk);
    };
    proc.stdout.on("data", output);
    proc.stderr.on("data", output);
    // A process the host could not start or lost reports why before it ends.
    proc.on("error", (error: Error) => {
      job.error ??= error.message;
    });
    proc.once("exit", (code: number | null, signal: string | null) => {
      void this.finish(job, running, code, signal).catch((error) =>
        console.error(`[host-exec] Could not record the end of ${job.id}:`, error),
      );
    });
  }

  private async finish(job: StoredJob, running: RunningJob, code: number | null, signal: string | null): Promise<void> {
    await Promise.all([ended(running.proc.stdout), ended(running.proc.stderr)]);
    await running.log.close();
    const now = this.now();
    this.running.delete(job.id);
    if (job.pool) {
      await this.deps.leases
        ?.releaseHold(`${EXEC_HOLDER_PREFIX}${job.id}`)
        .catch((error) => console.error(`[host-exec] Could not free the ${job.pool} slot of ${job.id}:`, error));
    }
    if (this.running.size === 0 && this.queued.size === 0 && this.callerCheck) {
      clearInterval(this.callerCheck);
      this.callerCheck = null;
    }
    job.status = job.error ? "failed" : "exited";
    job.exitCode = code;
    job.signal = job.error ? null : signal;
    job.endedAt = now;
    job.outputBytes = running.log.total;
    await this.save();
    for (const done of [...running.waiters]) done();
    this.deps.onSessionChange?.(job.sessionId);
    console.log(`[host-exec] ${job.id} on ${job.host}: ${describeExecOutcome(job)}`);
    if (job.legacyBackground) this.deps.notify(job.sessionId, await this.finishedMessage(job));
  }

  /** Stop commands nobody has asked about for CALLER_GONE_MS: their caller died without stopping them. */
  private stopAbandoned(): void {
    const cutoff = this.now() - (this.deps.callerGoneMs ?? CALLER_GONE_MS);
    for (const [id, running] of this.running) {
      const job = this.jobs.get(id);
      if (!job || job.legacyBackground || job.callerGone) continue;
      if (running.waiters.size > 0 || running.callerSeenAt > cutoff) continue;
      job.callerGone = true;
      console.log(`[host-exec] Stopping ${id} on ${job.host}: its caller stopped asking about it`);
      running.proc.kill("SIGTERM");
    }
    for (const [id, queued] of this.queued) {
      const job = this.jobs.get(id);
      if (!job || queued.waiters.size > 0 || queued.callerSeenAt > cutoff) continue;
      job.callerGone = true;
      this.stopQueued(job, "its caller went away while it waited for a slot");
    }
  }

  private async finishedMessage(job: StoredJob): Promise<string> {
    const took = formatDuration((job.endedAt ?? job.startedAt) - job.startedAt);
    const tail = (await this.readOutput(job.id, { tailLines: NOTIFY_TAIL_LINES }))?.output ?? "";
    const shownTail = tail.length > NOTIFY_TAIL_CHARS ? `...${tail.slice(-NOTIFY_TAIL_CHARS)}` : tail;
    const command = job.command.length > 500 ? `${job.command.slice(0, 500)}...` : job.command;
    const body = `$ ${command}\n${shownTail}`.trimEnd();
    const fence = codeFence(body);
    return [
      `${HOST_EXEC_MESSAGE_TAG} ${job.id} on ${job.host}: ${describeExecOutcome(job)} after ${took}.`,
      "",
      `${fence}text`,
      body,
      fence,
      "",
      `All of its output: \`takode exec logs ${job.id}\`.`,
    ].join("\n");
  }

  /** Keep the newest finished records, dropping older ones with their logs. */
  private pruneFinished(): void {
    const finished = [...this.jobs.values()]
      .filter((job) => job.status !== "running" && job.status !== "queued")
      .sort((a, b) => b.startedAt - a.startedAt);
    for (const job of finished.slice(MAX_FINISHED_RECORDS)) {
      this.jobs.delete(job.id);
      unlink(this.logPath(job.id)).catch(() => {});
    }
  }

  private save(): Promise<void> {
    const content = JSON.stringify({ nextId: this.nextId, jobs: [...this.jobs.values()] } satisfies StoredFile);
    const path = this.recordsPath;
    this.pendingSave = this.pendingSave
      .then(async () => {
        const temp = `${path}.tmp`;
        await writeFile(temp, content, "utf-8");
        await rename(temp, path);
      })
      .catch((error) => console.error("[host-exec] Could not save the command records:", error));
    return this.pendingSave;
  }
}

/**
 * A command's output log, appended in batches. Past LOG_HEAD_BYTES it keeps
 * only the newest LOG_TAIL_BYTES in memory and writes them, after a note of
 * what was left out, when the command ends: long output keeps both ends.
 */
class JobLog {
  private pending: Buffer[] = [];
  private tail: Buffer[] = [];
  private tailBytes = 0;
  private omitted = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    /** Bytes already in the file. */
    private headBytes: number,
    /** Bytes the command has produced. */
    public total: number,
  ) {}

  write(chunk: Buffer): void {
    this.total += chunk.length;
    const room = Math.max(0, LOG_HEAD_BYTES - this.headBytes);
    if (room > 0) {
      const head = chunk.subarray(0, room);
      this.pending.push(head);
      this.headBytes += head.length;
      chunk = chunk.subarray(head.length);
      this.timer ??= setTimeout(() => void this.flush(), LOG_FLUSH_MS);
    }
    if (chunk.length === 0) return;
    this.tail.push(chunk);
    this.tailBytes += chunk.length;
    while (this.tail.length > 1 && this.tailBytes - this.tail[0]!.length >= LOG_TAIL_BYTES) {
      const dropped = this.tail.shift()!;
      this.tailBytes -= dropped.length;
      this.omitted += dropped.length;
    }
  }

  /** Write what is waiting; resolves once it is in the file. */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.length > 0) {
      const data = Buffer.concat(this.pending);
      this.pending = [];
      this.append(data);
    }
    return this.chain;
  }

  /** The command ended: write everything, including the kept tail of over-long output. */
  close(): Promise<void> {
    void this.flush();
    if (this.tail.length > 0) {
      const note = this.omitted > 0 ? `\n[... ${this.omitted} bytes of output omitted ...]\n` : "";
      this.append(Buffer.concat([Buffer.from(note), ...this.tail]));
      this.tail = [];
    }
    return this.chain;
  }

  private append(data: Buffer): void {
    this.chain = this.chain
      .then(() => appendFile(this.path, data))
      .catch((error) => console.error(`[host-exec] Could not write ${this.path}:`, error));
  }
}

function publicJob({ procId: _procId, legacyBackground: _legacy, poolKeys: _poolKeys, ...job }: StoredJob): ExecJob {
  return { ...job };
}

function ended(stream: Readable): Promise<void> {
  if (stream.readableEnded || stream.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    stream.once("end", resolve);
    stream.once("close", resolve);
  });
}

async function logSize(path: string): Promise<number> {
  return stat(path).then(
    (info) => info.size,
    () => 0,
  );
}

/**
 * Both ends of long output, about EXEC_EXCERPT_BYTES together, cut at line
 * breaks where there are any, with a note naming exactly what was left out
 * and the commands that show it.
 */
async function excerpt(path: string, bytes: number, id: string): Promise<string> {
  const half = EXEC_EXCERPT_BYTES / 2;
  let head = await readRange(path, 0, half);
  let tail = await readRange(path, bytes - half, bytes);
  const headCut = head.lastIndexOf("\n");
  const tailCut = tail.indexOf("\n");
  const all = `all of it: \`takode exec logs ${id}\` (for long output, save it to a file: \`takode exec logs ${id} > ${id}.log\`)`;
  if (headCut === -1 || tailCut === -1) {
    const from = Buffer.byteLength(head) + 1;
    const to = bytes - Buffer.byteLength(tail);
    return `${head}\n[... bytes ${from}-${to} not shown; just those: \`takode exec logs ${id} --bytes ${from}-${to}\`; ${all} ...]\n${tail}`;
  }
  head = head.slice(0, headCut + 1);
  tail = tail.slice(tailCut + 1);
  const totalLines = await countLines(path);
  const from = countNewlines(head) + 1;
  const to = totalLines - countNewlines(tail) - (tail.endsWith("\n") || tail === "" ? 0 : 1);
  return `${head}[... lines ${from}-${to} not shown; just those: \`takode exec logs ${id} --lines ${from}-${to}\`; ${all} ...]\n${tail}`;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++;
  return count;
}

/** Lines in the file, counting a last line without a line break. */
async function countLines(path: string): Promise<number> {
  let count = 0;
  let last = 0x0a;
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
    for (let index = chunk.indexOf(0x0a); index !== -1; index = chunk.indexOf(0x0a, index + 1)) count++;
    last = chunk[chunk.length - 1] ?? last;
  }
  return last === 0x0a ? count : count + 1;
}

/** Lines `from` to `to` (1-based, inclusive) of a file, each with its line break. */
async function* lineRange(path: string, from: number, to: number): AsyncGenerator<string> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Number.POSITIVE_INFINITY });
  let number = 0;
  try {
    for await (const line of lines) {
      number++;
      if (number > to) break;
      if (number >= from) yield `${line}\n`;
    }
  } finally {
    lines.close();
  }
}

async function readRange(path: string, start: number, end: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(end - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    return buffer.subarray(0, bytesRead).toString("utf-8");
  } finally {
    await handle.close();
  }
}

async function readStoredFile(path: string): Promise<StoredFile> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<StoredFile>;
    const jobs = Array.isArray(parsed.jobs) ? parsed.jobs.filter((job) => typeof job?.id === "string") : [];
    return { nextId: Number.isSafeInteger(parsed.nextId) ? parsed.nextId! : jobs.length + 1, jobs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("[host-exec] Could not read the command records:", error);
    }
    return { nextId: 1, jobs: [] };
  }
}

/** A Markdown fence longer than any backtick run in `text`. */
function codeFence(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * The lease pool holding a command's slots on a machine: `name@machine`. On the
 * coordinator's own machine, where a lease key without `@` already means that
 * machine, it is the bare name unless a leader configured `name@machine`.
 */
function poolKey(name: string, machine: { id: string; name: string }, capacities: Record<string, number>): string {
  const qualified = `${name}@${machine.name.toLowerCase()}`;
  if (machine.id !== LOCAL_HOST_ID || Object.hasOwn(capacities, qualified)) return qualified;
  return name;
}

let configured: HostExec | null = null;

/** Called once at server startup, so session waits and the board read each session's commands. */
export function configureHostExec(exec: HostExec | null): void {
  configured = exec;
}

/** A session's running `takode exec` commands as background jobs (see {@link HostExec.backgroundTasks}). */
export function execBackgroundTasks(
  sessionId: string,
  options: { notifyingOnly?: boolean } = {},
): BackgroundTaskSnapshot | null {
  return configured?.backgroundTasks(sessionId, options) ?? null;
}
