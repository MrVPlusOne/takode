/**
 * Runs backups on a schedule and keeps their status. A backup goes to up to
 * two destinations the user picked: a Git repository URL, which each run
 * pushes to, and a repository on another machine with a `takode node` (such
 * as their laptop), which is brought up to date after each run while that
 * machine is online and catches up when it comes back.
 *
 * A run happens once an hour while a destination is set, and right away when
 * one is set or changed; a restore test runs once a week. Runs and tests are
 * child processes (`backup-job.ts`), so reading the stores and running Git
 * never block the server.
 *
 * The user hears about trouble on their phone: once when three runs (or three
 * syncs to the machine) in a row have failed, and whenever a restore test
 * fails. A machine that is offline is waiting, not failing. Settings shows the
 * status.
 */

import { execFile, spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { bunCommandArgs, bunCommandEnv } from "../../shared/bun-command-launch.js";
import type { BackupStatus, BackupTargets } from "../../shared/backup-status.js";
import { getEnrichedPath } from "../path-resolver.js";
import { BACKUP_GIT_PATH } from "./backup-git-server.js";
import { type HostRunner, syncHostCopy } from "./backup-host-sync.js";
import type { RestoreTestResult, RunBackupResult } from "./backup-job.js";

export const BACKUP_INTERVAL_MS = 60 * 60_000;
export const RESTORE_TEST_INTERVAL_MS = 7 * 24 * 60 * 60_000;
/** Failures in a row before the user is alerted; one failure is usually a passing network problem. */
export const FAILURES_BEFORE_ALERT = 3;
const CHECK_INTERVAL_MS = 5 * 60_000;
const JOB_TIMEOUT_MS = 60 * 60_000;
const JOB_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "backup-job.ts");
const execFileAsync = promisify(execFile);

export interface BackupAlert {
  title: string;
  body: string;
  path: string;
}

export type BackupJobRequest =
  | { kind: "backup"; companion: string; port: number; repoUrl: string; workDir: string }
  | { kind: "test"; repoUrl: string; serverSlug: string };

export interface BackupServiceDeps {
  port: number;
  /** The destinations from settings; backups are off while both are empty. */
  getTargets: () => BackupTargets;
  getServerSlug: () => string;
  /** A registered machine's name. */
  hostName: (hostId: string) => string;
  /** Runs the sync on a machine; without it a machine destination waits. */
  hosts?: HostRunner;
  sendAlert: (alert: BackupAlert) => void;
  /** The `.companion` folder; defaults to the home one. */
  companion?: string;
  /** Runs one job; defaults to a child process. Tests replace it. */
  runJob?: (request: BackupJobRequest) => Promise<RunBackupResult | RestoreTestResult>;
  now?: () => number;
}

type SavedState = Omit<BackupStatus, keyof BackupTargets | "hostName" | "running">;
type HostSync = NonNullable<BackupStatus["hostSync"]>;

export class BackupService {
  private readonly companion: string;
  private readonly workDir: string;
  private readonly statusPath: string;
  private readonly now: () => number;
  private readonly runJob: (request: BackupJobRequest) => Promise<RunBackupResult | RestoreTestResult>;
  private state: SavedState | null = null;
  private running: BackupStatus["running"] = null;
  /** Opens the backup's Git path to the machine syncing now. */
  private fetchToken: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingWrite: Promise<void> = Promise.resolve();

  constructor(private readonly deps: BackupServiceDeps) {
    this.companion = deps.companion ?? join(homedir(), ".companion");
    this.workDir = join(this.companion, "backup", "repo");
    this.statusPath = join(this.companion, "backup", "status.json");
    this.now = deps.now ?? Date.now;
    this.runJob = deps.runJob ?? ((request) => runJobProcess(request));
  }

  /** The folder holding the backup clone (`repo`), which machine destinations fetch from. */
  get gitRoot(): string {
    return dirname(this.workDir);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick().catch(logTickError), CHECK_INTERVAL_MS);
    this.timer.unref?.();
    void this.tick().catch(logTickError);
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async status(): Promise<BackupStatus> {
    const targets = this.deps.getTargets();
    return {
      ...targets,
      hostName: targets.host ? this.deps.hostName(targets.host.hostId) : null,
      running: this.running,
      ...(await this.load()),
    };
  }

  /**
   * The destinations changed: failure streaks of the old ones no longer
   * count, and a new destination gets its first backup right away.
   */
  async targetsChanged(): Promise<void> {
    const state = await this.load();
    const { hostSync: _previousHost, ...rest } = state;
    await this.save({ ...rest, consecutiveFailures: 0, failureAlerted: false });
    if (this.enabled() && !this.running) {
      void this.backUp().catch((error) => console.error("[backup] Backup failed:", error));
    }
  }

  /**
   * Run whatever is due: a backup an hour after the last one; the machine
   * copy when it is behind (it may have been offline); a restore test a week
   * after the last one.
   */
  async tick(): Promise<void> {
    if (!this.enabled() || this.running) return;
    const state = await this.load();
    const now = this.now();
    if (!state.lastRun || now - state.lastRun.startedAt >= BACKUP_INTERVAL_MS) {
      await this.backUp();
    } else if (this.hostBehind(state)) {
      await this.syncHost();
    } else if (state.lastSuccessAt && (!state.lastTest || now - state.lastTest.at >= RESTORE_TEST_INTERVAL_MS)) {
      await this.testRestore();
    }
  }

  /** Back up now (then bring the machine copy up to date); resolves when done. Refused while something runs. */
  async backUp(): Promise<BackupStatus> {
    const { repoUrl } = this.claim("backup");
    const startedAt = this.now();
    try {
      const result = (await this.runJob({
        kind: "backup",
        companion: this.companion,
        port: this.deps.port,
        repoUrl,
        workDir: this.workDir,
      }).catch((error: unknown) => failedRun(error))) as RunBackupResult;
      const state = await this.load();
      state.lastRun = {
        startedAt,
        finishedAt: this.now(),
        ok: result.ok,
        changed: result.changed ?? false,
        commit: result.commit ?? null,
        quests: result.quests ?? 0,
        errors: result.errors ?? [],
      };
      if (result.ok) {
        state.lastSuccessAt = startedAt;
        state.consecutiveFailures = 0;
        state.failureAlerted = false;
      } else {
        state.consecutiveFailures++;
        if (state.consecutiveFailures >= FAILURES_BEFORE_ALERT && !state.failureAlerted) {
          state.failureAlerted = true;
          this.deps.sendAlert({
            title: "Takode backups are failing",
            body: `${state.consecutiveFailures} backups in a row failed: ${result.errors?.[0] ?? "unknown error"}`,
            path: "/#/settings",
          });
        }
      }
      await this.save(state);
    } finally {
      this.running = null;
    }
    if (this.hostBehind(await this.load())) await this.syncHost();
    return this.status();
  }

  /**
   * Bring the copy on the destination machine up to the latest backup. A
   * machine that cannot run it now (offline, updating) is recorded as
   * waiting; the scheduled check tries again.
   */
  async syncHost(): Promise<BackupStatus> {
    const target = this.deps.getTargets().host;
    if (!target) throw new Error("No backup machine is set.");
    const state = await this.load();
    const hostSync: HostSync = state.hostSync ?? {
      waiting: null,
      error: null,
      consecutiveFailures: 0,
      failureAlerted: false,
    };
    const name = this.deps.hostName(target.hostId);
    const blocker = this.deps.hosts ? this.deps.hosts.blocker(target.hostId) : "cannot be reached from here";
    if (blocker || !state.lastRun?.commit) {
      await this.save({
        ...state,
        hostSync: { ...hostSync, waiting: blocker ? `${name} ${blocker}` : "no backup yet" },
      });
      return this.status();
    }
    const syncing = state.lastRun.startedAt;
    this.claim("host");
    this.fetchToken = randomBytes(32).toString("base64url");
    try {
      const result = await syncHostCopy({
        runner: this.deps.hosts!,
        hostId: target.hostId,
        path: target.path,
        token: this.fetchToken,
        localHeads: await this.localHeads(),
      }).catch((error: unknown) => ({
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      }));
      const next: HostSync = { ...hostSync, waiting: null, lastAttemptAt: this.now() };
      if (result.ok) {
        Object.assign(next, { error: null, syncedRunAt: syncing, lastSuccessAt: this.now() });
        Object.assign(next, { consecutiveFailures: 0, failureAlerted: false });
      } else {
        next.error = result.error;
        next.consecutiveFailures++;
        if (next.consecutiveFailures >= FAILURES_BEFORE_ALERT && !next.failureAlerted) {
          next.failureAlerted = true;
          this.deps.sendAlert({
            title: `Takode backups to ${name} are failing`,
            body: result.error,
            path: "/#/settings",
          });
        }
      }
      await this.save({ ...(await this.load()), hostSync: next });
    } finally {
      this.fetchToken = null;
      this.running = null;
    }
    return this.status();
  }

  /**
   * Restore the latest backup into a scratch folder and check it; resolves
   * when the test ends. It restores from the backup repository, or from this
   * machine's clone when only a machine destination is set (whose copy each
   * sync checks against that clone).
   */
  async testRestore(): Promise<BackupStatus> {
    const { repoUrl } = this.claim("test");
    try {
      const source = repoUrl || this.workDir;
      const result = (await this.runJob({ kind: "test", repoUrl: source, serverSlug: this.deps.getServerSlug() }).catch(
        (error: unknown) => failedRun(error),
      )) as RestoreTestResult;
      const state = await this.load();
      const problems = result.problems ?? [];
      state.lastTest = { at: this.now(), ok: result.ok, snapshotAt: result.snapshotAt ?? null, problems };
      if (!result.ok) {
        this.deps.sendAlert({
          title: "Takode backup restore test failed",
          body: problems[0] ?? "The backup could not be restored.",
          path: "/#/settings",
        });
      }
      await this.save(state);
    } finally {
      this.running = null;
    }
    return this.status();
  }

  /** Whether `request` fetches the backup over Git with the current sync's token. */
  isFetchRequest(request: Request): boolean {
    if (!this.fetchToken || !new URL(request.url).pathname.startsWith(`${BACKUP_GIT_PATH}/`)) return false;
    const given = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${this.fetchToken}`);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  private enabled(): boolean {
    const targets = this.deps.getTargets();
    return !!targets.repoUrl || !!targets.host;
  }

  /** Mark `kind` as running, or refuse when nothing is set or something else runs. */
  private claim(kind: NonNullable<BackupStatus["running"]>): BackupTargets {
    const targets = this.deps.getTargets();
    if (!targets.repoUrl && !targets.host) throw new Error("No backup destination is set.");
    if (this.running) throw new Error(`A backup ${RUNNING_LABELS[this.running]} is under way.`);
    this.running = kind;
    return targets;
  }

  /** Whether the machine copy has not taken the latest backup run yet. */
  private hostBehind(state: SavedState): boolean {
    if (!this.deps.getTargets().host || !state.lastRun?.commit) return false;
    return (state.hostSync?.syncedRunAt ?? 0) < state.lastRun.startedAt;
  }

  private async localHeads(): Promise<Map<string, string>> {
    const { stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/takode/"],
      { cwd: this.workDir },
    );
    const heads = new Map<string, string>();
    for (const line of stdout.trim().split("\n")) {
      const [sha, ref] = line.split(" ");
      if (sha && ref) heads.set(ref, sha);
    }
    return heads;
  }

  private async load(): Promise<SavedState> {
    if (!this.state) {
      const saved = await readFile(this.statusPath, "utf-8")
        .then((text) => JSON.parse(text) as Partial<SavedState>)
        .catch((error: NodeJS.ErrnoException): Partial<SavedState> => {
          if (error.code !== "ENOENT") console.error("[backup] Unreadable status, starting over:", error);
          return {};
        });
      this.state = { consecutiveFailures: 0, failureAlerted: false, ...saved };
    }
    return this.state;
  }

  private save(state: SavedState): Promise<void> {
    this.state = state;
    const text = JSON.stringify(state, null, 2);
    this.pendingWrite = this.pendingWrite.then(async () => {
      await mkdir(dirname(this.statusPath), { recursive: true });
      await writeFile(`${this.statusPath}.tmp`, text);
      await rename(`${this.statusPath}.tmp`, this.statusPath);
    });
    return this.pendingWrite.catch((error) => console.error("[backup] Could not save status:", error));
  }
}

const RUNNING_LABELS: Record<NonNullable<BackupStatus["running"]>, string> = {
  backup: "run",
  test: "restore test",
  host: "sync to the backup machine",
};

function logTickError(error: unknown): void {
  console.error("[backup] Scheduled check failed:", error);
}

function failedRun(error: unknown): { ok: false; errors: string[]; problems: string[] } {
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, errors: [message], problems: [message] };
}

/** Run one job as `bun backup-job.ts '<request>'` and read its one-line JSON result. */
function runJobProcess(request: BackupJobRequest): Promise<RunBackupResult | RestoreTestResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, bunCommandArgs(JOB_SCRIPT, [JSON.stringify(request)]), {
      stdio: ["ignore", "pipe", "pipe"],
      env: bunCommandEnv({ ...process.env, PATH: getEnrichedPath() }, homedir()),
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr = (stderr + chunk).slice(-4000)));
    const timeout = setTimeout(() => child.kill("SIGKILL"), JOB_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      const line = stdout.trim().split("\n").pop() ?? "";
      try {
        resolve(JSON.parse(line) as RunBackupResult | RestoreTestResult);
      } catch {
        const ended = signal ? `was stopped (${signal})` : `ended with code ${code}`;
        reject(new Error(`The backup job ${ended}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
      }
    });
  });
}
