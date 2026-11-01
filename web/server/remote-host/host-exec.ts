import { createReadStream, mkdirSync } from "node:fs";
import { appendFile, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { inheritedLaunchEnv } from "../cli-launcher-env.js";
import { getEnrichedPath } from "../path-resolver.js";
import { LOCAL_HOST_ID } from "../../shared/host-protocol.js";
import { describeExecOutcome, HOST_EXEC_MESSAGE_TAG, type ExecJob } from "../../shared/host-exec.js";
import { formatLeaseWaitDuration as formatDuration } from "../../shared/resource-lease-message.js";
import type { BackgroundTaskSnapshot } from "../bridge/adapter-interface.js";
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
  links: Pick<HostLinkManager, "spawn" | "adopt" | "startBlocker">;
  /** The machine a name or id names: a registered host, or this machine as `local`. */
  resolveHost: (nameOrId: string) => Promise<{ id: string; name: string } | null>;
  /** Names of every machine `takode exec` can reach, for the unknown-host error. */
  machineNames: () => Promise<string[]>;
  /** Whether the user turned commands off for a machine in Settings. */
  execDisabled: (hostId: string) => boolean;
  /** Tell a session that its background command finished. */
  notify: (sessionId: string, text: string) => void;
  /** A session's running commands changed, which its waits and the board's stall check read. */
  onSessionChange?: (sessionId: string) => void;
  /** Where job records and output logs are kept. */
  dir: string;
  now?: () => number;
  /** Override of RESULT_PICKUP_MS for tests. */
  resultPickupMs?: number;
}

export interface ExecStartInput {
  sessionId: string;
  sessionNum: number | null;
  questId: string | null;
  host: string;
  command: string;
  cwd?: string | null;
  background: boolean;
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
const LOGIN_SHELL_SCRIPT = [
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
/** How long after a foreground command ends its caller has to collect the result before the session is sent it instead. */
const RESULT_PICKUP_MS = 15_000;
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
const KILL_GRACE_MS = 10_000;
const LOG_FLUSH_MS = 200;

interface StoredJob extends ExecJob {
  /** The host-link process id, for taking the process over after a coordinator restart. */
  procId: string;
}

interface StoredFile {
  nextId: number;
  jobs: StoredJob[];
}

interface RunningJob {
  proc: RemoteProcess;
  log: JobLog;
  /** When it last wrote output, or started: a sign it is not hung. */
  lastOutputAt: number;
  /** Callers waiting for the job to end. */
  waiters: Set<() => void>;
}

/**
 * `takode exec`: commands sessions run on any machine with a `takode node`
 * (registered hosts and the coordinator's own machine). Every call is recorded
 * with its session, quest, machine, command, outcome and times, and its output
 * is kept in a log on the coordinator. A command is a host-link process, so it
 * outlives its caller and replays output across link drops; a restarted
 * coordinator takes running ones over. The session that started a background
 * command, or a foreground one whose caller never collected the result, is
 * told when it ends.
 */
export class HostExec {
  private readonly jobs = new Map<string, StoredJob>();
  private readonly running = new Map<string, RunningJob>();
  /** Finished foreground commands whose caller has read the result. */
  private readonly collected = new Set<string>();
  private nextId = 1;
  private pendingSave: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly deps: HostExecDeps) {
    this.now = deps.now ?? Date.now;
    mkdirSync(this.logDir, { recursive: true }); // sync-ok: cold path, once during construction
  }

  /** Load the records and take over the commands a previous coordinator left running. Call before hosts connect. */
  async restore(): Promise<void> {
    const file = await readStoredFile(this.recordsPath);
    this.nextId = file.nextId;
    for (const job of file.jobs) this.jobs.set(job.id, job);
    for (const job of file.jobs) {
      if (job.status !== "running") continue;
      const logged = await stat(this.logPath(job.id)).then(
        (info) => info.size,
        () => 0,
      );
      this.attach(job, this.deps.links.adopt(job.hostId, job.procId), logged);
    }
  }

  async start(input: ExecStartInput): Promise<ExecJob> {
    const command = input.command.trim();
    if (!command) throw new HostExecError(400, "Give the command to run after --");
    if (command.length > MAX_COMMAND_LENGTH) throw new HostExecError(400, "The command is too long");
    const machine = await this.deps.resolveHost(input.host.trim());
    if (!machine) {
      const names = await this.deps.machineNames();
      throw new HostExecError(404, `No machine named ${input.host}; machines: ${names.join(", ") || "none"}`);
    }
    if (this.deps.execDisabled(machine.id)) {
      throw new HostExecError(403, `Running commands on ${machine.name} is turned off in Settings → Hosts`);
    }
    const blocker = this.deps.links.startBlocker(machine.id);
    if (blocker) throw new HostExecError(409, `Host ${machine.name} ${blocker}`);
    const cwd = input.cwd?.trim() || null;
    const proc = this.deps.links.spawn(machine.id, {
      command: "/bin/sh",
      args: ["-c", LOGIN_SHELL_SCRIPT, "takode-exec", command, cwd ?? ""],
      // This machine's own node takes a complete environment; other hosts use their own.
      env: machine.id === LOCAL_HOST_ID ? { ...inheritedLaunchEnv(process.env), PATH: getEnrichedPath() } : {},
      group: true,
    });
    // Like `ssh -n`: a command waiting for input would otherwise hang.
    proc.stdin.end();
    const job: StoredJob = {
      id: `x-${this.nextId++}`,
      procId: proc.procId,
      hostId: machine.id,
      host: machine.name,
      command,
      cwd,
      sessionId: input.sessionId,
      sessionNum: input.sessionNum,
      questId: input.questId,
      background: input.background,
      status: "running",
      startedAt: this.now(),
      endedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      outputBytes: 0,
    };
    this.jobs.set(job.id, job);
    this.attach(job, proc, 0);
    this.pruneFinished();
    await this.save();
    this.deps.onSessionChange?.(job.sessionId);
    console.log(`[host-exec] ${job.id} started on ${job.host} for session ${job.sessionNum ?? job.sessionId}`);
    return publicJob(job);
  }

  get(id: string): ExecJob | null {
    const job = this.jobs.get(id);
    return job ? publicJob(job) : null;
  }

  /** Records newest first, optionally only one session's. */
  list(options: { sessionId?: string; limit?: number } = {}): ExecJob[] {
    const jobs = [...this.jobs.values()]
      .filter((job) => !options.sessionId || job.sessionId === options.sessionId)
      .sort((a, b) => b.startedAt - a.startedAt);
    return jobs.slice(0, options.limit ?? jobs.length).map(publicJob);
  }

  /**
   * The session's running commands, as background jobs it is told about when
   * they end, for its waits and the board's stall check. A command counts as
   * live for as long after its latest output as a job after its start;
   * `changedAt` is when one of its commands last started or ended.
   */
  backgroundTasks(sessionId: string): BackgroundTaskSnapshot | null {
    const own = [...this.jobs.values()].filter((job) => job.sessionId === sessionId);
    if (own.length === 0) return null;
    const tasks = own.flatMap((job) => {
      const running = this.running.get(job.id);
      if (!running) return [];
      const command = job.command.length > 80 ? `${job.command.slice(0, 80)}...` : job.command;
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
    const running = this.running.get(id);
    if (running) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(done, ms);
        function done() {
          clearTimeout(timer);
          running!.waiters.delete(done);
          resolve();
        }
        running.waiters.add(done);
      });
    }
    return this.get(id);
  }

  /** The caller of a foreground command stops waiting; the session is told when it ends. */
  async detach(id: string): Promise<ExecJob | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === "running" && !job.background) {
      job.background = true;
      await this.save();
    }
    return publicJob(job);
  }

  /** Stop a running command and everything it started: SIGTERM, then SIGKILL if it is still running after a grace period. */
  kill(id: string): ExecJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    const running = this.running.get(id);
    if (running && running.proc.kill("SIGTERM")) {
      setTimeout(() => running.proc.kill("SIGKILL"), KILL_GRACE_MS).unref?.();
    }
    return publicJob(job);
  }

  /**
   * The job's output as a foreground run shows it: all of it when short,
   * else both ends with a note on reading the rest ({@link readLog});
   * `tailLines` for its last lines. The owning session reading a finished
   * command's output has its result.
   */
  async readOutput(
    id: string,
    options: { tailLines?: number; readerSessionId?: string } = {},
  ): Promise<ExecOutput | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status !== "running" && options.readerSessionId === job.sessionId) this.collected.add(id);
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
   * of its lines or bytes. Reading a finished command counts as its owner
   * collecting the result, as for {@link readOutput}.
   */
  async readLog(
    id: string,
    options: { lines?: [number, number]; bytes?: [number, number]; readerSessionId?: string } = {},
  ): Promise<Readable | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status !== "running" && options.readerSessionId === job.sessionId) this.collected.add(id);
    await this.running.get(id)?.log.flush();
    const path = this.logPath(id);
    if ((await logSize(path)) === 0) return Readable.from([]);
    if (options.bytes) return createReadStream(path, { start: options.bytes[0] - 1, end: options.bytes[1] - 1 });
    if (options.lines) return Readable.from(lineRange(path, options.lines[0], options.lines[1]));
    return createReadStream(path);
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
    const running: RunningJob = { proc, log, lastOutputAt: this.now(), waiters: new Set() };
    this.running.set(job.id, running);
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
    job.status = job.error ? "failed" : "exited";
    job.exitCode = code;
    job.signal = job.error ? null : signal;
    job.endedAt = now;
    job.outputBytes = running.log.total;
    await this.save();
    for (const done of [...running.waiters]) done();
    this.deps.onSessionChange?.(job.sessionId);
    console.log(`[host-exec] ${job.id} on ${job.host}: ${describeExecOutcome(job)}`);
    if (job.background) {
      this.deps.notify(job.sessionId, await this.finishedMessage(job));
      return;
    }
    // A foreground caller that was killed or went away never collects the result; send it instead.
    const pickup = setTimeout(() => {
      if (this.collected.delete(job.id)) return;
      job.background = true;
      void this.save();
      void this.finishedMessage(job).then((text) => this.deps.notify(job.sessionId, text));
    }, this.deps.resultPickupMs ?? RESULT_PICKUP_MS);
    pickup.unref?.();
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
      .filter((job) => job.status !== "running")
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

function publicJob({ procId: _procId, ...job }: StoredJob): ExecJob {
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

let configured: HostExec | null = null;

/** Called once at server startup, so session waits and the board read each session's commands. */
export function configureHostExec(exec: HostExec | null): void {
  configured = exec;
}

/** A session's running `takode exec` commands as background jobs (see {@link HostExec.backgroundTasks}). */
export function execBackgroundTasks(sessionId: string): BackgroundTaskSnapshot | null {
  return configured?.backgroundTasks(sessionId) ?? null;
}
