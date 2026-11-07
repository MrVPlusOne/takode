import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { BackupHostTarget } from "../../shared/backup-status.js";
import type { HostCommandResult, HostRunner } from "./backup-host-sync.js";
import type { RestoreTestResult, RunBackupResult } from "./backup-job.js";
import {
  BACKUP_INTERVAL_MS,
  BackupService,
  type BackupAlert,
  type BackupJobRequest,
  RESTORE_TEST_INTERVAL_MS,
} from "./backup-service.js";

// The schedule, status and alerts of backups, with the Git job replaced by a
// fake: what the job itself does is covered in backup-job.test.ts. Status is
// kept under a throwaway `.companion` folder.

const OK_RUN: RunBackupResult = { ok: true, commit: "abc", changed: true, quests: 3, memory: [], errors: [] };
const FAILED_RUN: RunBackupResult = {
  ok: false,
  commit: "abc",
  changed: false,
  quests: 3,
  memory: [],
  errors: ["push failed"],
};

let companion: string;
let now: number;
let repoUrl: string;
let host: BackupHostTarget | null;
let alerts: BackupAlert[];
let jobs: BackupJobRequest[];
let nextResults: Array<RunBackupResult | RestoreTestResult>;

function service(hosts?: HostRunner): BackupService {
  return new BackupService({
    ...(hosts ? { hosts } : {}),
    port: 3456,
    companion,
    getTargets: () => ({ repoUrl, host }),
    hostName: () => "laptop",
    getServerSlug: () => "prod",
    sendAlert: (alert) => alerts.push(alert),
    now: () => now,
    runJob: async (request) => {
      jobs.push(request);
      return nextResults.shift() ?? OK_RUN;
    },
  });
}

beforeEach(async () => {
  companion = await mkdtemp(join(tmpdir(), "takode-backup-service-"));
  now = 1_000_000;
  repoUrl = "https://example.com/backup.git";
  host = null;
  alerts = [];
  jobs = [];
  nextResults = [];
});

afterEach(async () => {
  await rm(companion, { recursive: true, force: true });
});

describe("BackupService", () => {
  it("does nothing while no destination is set", async () => {
    repoUrl = "";
    await service().tick();
    expect(jobs).toEqual([]);
  });

  it("backs up hourly and tests a restore weekly after a success", async () => {
    const backups = service();
    await backups.tick();
    expect(jobs.map((job) => job.kind)).toEqual(["backup"]);
    expect(jobs[0]).toMatchObject({ repoUrl, port: 3456, workDir: join(companion, "backup", "repo") });

    // The first restore test follows the first successful backup at the next check.
    now += 5 * 60_000;
    await backups.tick();
    expect(jobs.map((job) => job.kind)).toEqual(["backup", "test"]);
    expect(jobs[1]).toEqual({ kind: "test", repoUrl, serverSlug: "prod" });

    // Nothing is due until an hour after the last backup.
    now += 10 * 60_000;
    await backups.tick();
    expect(jobs).toHaveLength(2);
    now += BACKUP_INTERVAL_MS;
    await backups.tick();
    expect(jobs.map((job) => job.kind)).toEqual(["backup", "test", "backup"]);

    const status = await backups.status();
    expect(status).toMatchObject({ repoUrl, running: null, consecutiveFailures: 0, lastSuccessAt: now });
    expect(status.lastTest).toMatchObject({ ok: true });
    expect(RESTORE_TEST_INTERVAL_MS).toBeGreaterThan(BACKUP_INTERVAL_MS);
  });

  it("alerts once when three runs in a row fail, and again only after a success", async () => {
    const backups = service();
    nextResults = [FAILED_RUN, FAILED_RUN, FAILED_RUN, FAILED_RUN, OK_RUN, FAILED_RUN, FAILED_RUN, FAILED_RUN];
    for (let run = 0; run < 4; run++) await backups.backUp();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ title: "Takode backups are failing", path: "/#/settings" });
    expect(alerts[0]!.body).toContain("push failed");

    await backups.backUp();
    expect((await backups.status()).consecutiveFailures).toBe(0);
    for (let run = 0; run < 3; run++) await backups.backUp();
    expect(alerts).toHaveLength(2);
  });

  it("counts a job that crashed as a failed run", async () => {
    const backups = new BackupService({
      port: 3456,
      companion,
      getTargets: () => ({ repoUrl, host }),
      hostName: () => "laptop",
      getServerSlug: () => "prod",
      sendAlert: (alert) => alerts.push(alert),
      now: () => now,
      runJob: async () => {
        throw new Error("The backup job ended with code 1");
      },
    });
    const status = await backups.backUp();
    expect(status.lastRun).toMatchObject({ ok: false, errors: ["The backup job ended with code 1"] });
    expect(status.consecutiveFailures).toBe(1);
  });

  it("alerts when a restore test fails", async () => {
    nextResults = [{ ok: false, problems: ["todos/todo-list.json is missing"], snapshotAt: null, quests: 0 }];
    const status = await service().testRestore();
    expect(status.lastTest).toMatchObject({ ok: false, problems: ["todos/todo-list.json is missing"] });
    expect(alerts).toEqual([
      { title: "Takode backup restore test failed", body: "todos/todo-list.json is missing", path: "/#/settings" },
    ]);
  });

  it("keeps its status across restarts", async () => {
    nextResults = [FAILED_RUN];
    await service().backUp();
    const restarted = await service().status();
    expect(restarted).toMatchObject({ consecutiveFailures: 1, lastRun: { ok: false, errors: ["push failed"] } });
  });

  it("starts over on a new destination: the old failure streak is dropped and a backup starts", async () => {
    const backups = service();
    nextResults = [FAILED_RUN, FAILED_RUN];
    await backups.backUp();
    await backups.backUp();
    repoUrl = "https://example.com/other.git";
    await backups.targetsChanged();
    // The new repository's first backup started right away (the fake job finishes at once).
    await vi.waitFor(() => expect(jobs).toHaveLength(3));
    expect(jobs[2]).toMatchObject({ kind: "backup", repoUrl });
  });

  it("refuses a second run while one is under way", async () => {
    let finish: (result: RunBackupResult) => void = () => {};
    const backups = new BackupService({
      port: 3456,
      companion,
      getTargets: () => ({ repoUrl, host }),
      hostName: () => "laptop",
      getServerSlug: () => "prod",
      sendAlert: () => {},
      runJob: () => new Promise((resolve) => (finish = resolve)),
    });
    const first = backups.backUp();
    expect((await backups.status()).running).toBe("backup");
    await expect(backups.testRestore()).rejects.toThrow(/under way/);
    finish(OK_RUN);
    await first;
    expect((await backups.status()).running).toBeNull();
  });

  describe("copy on a machine", () => {
    // The fake runner stands in for the host link; what it runs is covered in backup-job.test.ts.
    let runs: Array<{ hostId: string; env: Record<string, string> }>;
    let blocker: string | null;
    let answer: (heads: string) => HostCommandResult;

    function runner(): HostRunner {
      return {
        blocker: () => blocker,
        run: async (hostId, _script, env) => {
          runs.push({ hostId, env });
          return answer(git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/takode/"));
        },
      };
    }

    function git(...args: string[]): string {
      return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: join(companion, "backup", "repo"),
      })
        .toString()
        .trim();
    }

    beforeEach(() => {
      runs = [];
      blocker = null;
      answer = (heads) => ({ code: 0, stdout: `${heads}\n`, stderr: "" });
      repoUrl = "";
      host = { hostId: "laptop-id", path: "~/Backups/takode.git" };
      // The backup clone the machine fetches from, with one backup on its data branch.
      execFileSync("git", ["init", "-q", "-b", "takode/prod/data", join(companion, "backup", "repo")]);
      git("commit", "-q", "--allow-empty", "-m", "backup");
    });

    it("waits while the machine is offline and catches up when it is back", async () => {
      blocker = "is offline";
      const backups = service(runner());
      await backups.backUp();
      expect(runs).toEqual([]);
      expect((await backups.status()).hostSync).toMatchObject({ waiting: "laptop is offline", error: null });
      // Waiting is not failing: no alert, however long it lasts.
      expect(alerts).toEqual([]);

      blocker = null;
      now += 5 * 60_000;
      await backups.tick();
      expect(runs).toHaveLength(1);
      expect(runs[0]!.hostId).toBe("laptop-id");
      expect(runs[0]!.env.TAKODE_BACKUP_PATH).toBe("~/Backups/takode.git");
      const status = await backups.status();
      expect(status.hostSync).toMatchObject({ waiting: null, error: null, lastSuccessAt: now });
      expect(status.hostName).toBe("laptop");

      // Up to date: the next check runs the restore test instead of syncing again.
      now += 5 * 60_000;
      await backups.tick();
      expect(runs).toHaveLength(1);
      expect(jobs.map((job) => job.kind)).toEqual(["backup", "test"]);
      // With no repository, the test restores from the clone the machine copies.
      expect(jobs[1]).toMatchObject({ repoUrl: join(companion, "backup", "repo") });
    });

    it("lets in only the current sync's fetch, with its token, on the backup Git path", async () => {
      let seen: Request[] = [];
      let accepted: boolean[] = [];
      const backups = service({
        blocker: () => null,
        run: async (_hostId, _script, env) => {
          const header = env.GIT_CONFIG_VALUE_0!.replace(/^Authorization: /, "");
          const url = "http://127.0.0.1:1/api/backup/git/repo/info/refs?service=git-upload-pack";
          seen = [
            new Request(url, { headers: { authorization: header } }),
            new Request(url, { headers: { authorization: "Bearer wrong" } }),
            new Request("http://127.0.0.1:1/api/quests", { headers: { authorization: header } }),
          ];
          accepted = seen.map((request) => backups.isFetchRequest(request));
          return answer(git("for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/takode/"));
        },
      });
      await backups.backUp();
      expect(accepted).toEqual([true, false, false]);
      // After the sync the token no longer opens anything.
      expect(backups.isFetchRequest(seen[0]!)).toBe(false);
    });

    it("reports a copy that does not match, and alerts after three failures in a row", async () => {
      answer = () => ({
        code: 0,
        stdout: "0000000000000000000000000000000000000000 refs/heads/takode/prod/data\n",
        stderr: "",
      });
      const backups = service(runner());
      for (let run = 0; run < 3; run++) {
        now += BACKUP_INTERVAL_MS;
        await backups.backUp();
      }
      const status = await backups.status();
      expect(status.hostSync).toMatchObject({ consecutiveFailures: 3, failureAlerted: true });
      expect(status.hostSync!.error).toMatch(/does not match the backup on refs\/heads\/takode\/prod\/data/);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.title).toBe("Takode backups to laptop are failing");
    });
  });
});
