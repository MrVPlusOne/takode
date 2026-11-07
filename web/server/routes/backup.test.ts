import { Hono } from "hono";
import type { BackupStatus, BackupTargets } from "../../shared/backup-status.js";
import type { BackupService } from "../backup/backup-service.js";
import { createBackupRoutes, repoUrlProblem } from "./backup.js";

// The backup routes with a fake service: setting destinations, starting runs,
// refusing URLs that would put credentials into settings, and keeping the
// backup's Git path closed without a sync's token.

function setup(initial: Partial<BackupTargets> & Partial<BackupStatus> = {}) {
  let targets: BackupTargets = { repoUrl: initial.repoUrl ?? "", host: initial.host ?? null };
  const calls: string[] = [];
  const service = {
    status: async (): Promise<BackupStatus> => ({
      hostName: null,
      running: initial.running ?? null,
      consecutiveFailures: 0,
      failureAlerted: false,
      ...targets,
    }),
    targetsChanged: async () => void calls.push("targetsChanged"),
    backUp: async () => void calls.push("backUp"),
    testRestore: async () => void calls.push("testRestore"),
    isFetchRequest: () => false,
    gitRoot: "/nonexistent",
  } as unknown as BackupService;
  const app = new Hono();
  app.route(
    "/api",
    createBackupRoutes(service, {
      getTargets: () => targets,
      setTargets: (next) => {
        targets = next;
      },
      isHost: (hostId) => hostId === "laptop-id",
    }),
  );
  const put = (body: unknown) => app.request("/api/backup", { method: "PUT", body: JSON.stringify(body) });
  return { app, calls, put, targets: () => targets };
}

describe("backup routes", () => {
  it("sets each destination on its own and starts a backup", async () => {
    const { put, calls, targets } = setup();
    expect((await put({ repoUrl: " https://github.com/owner/takode-backup.git " })).status).toBe(200);
    expect((await put({ host: { hostId: "laptop-id", path: " ~/Backups/takode.git " } })).status).toBe(200);
    expect(targets()).toEqual({
      repoUrl: "https://github.com/owner/takode-backup.git",
      host: { hostId: "laptop-id", path: "~/Backups/takode.git" },
    });
    expect(calls).toEqual(["targetsChanged", "targetsChanged"]);

    // Turning the machine off keeps the repository.
    await put({ host: null });
    expect(targets()).toEqual({ repoUrl: "https://github.com/owner/takode-backup.git", host: null });
  });

  it("refuses an unknown machine and folders that are not plain paths", async () => {
    const { put, targets } = setup();
    for (const host of [
      { hostId: "unknown", path: "~/b.git" },
      { hostId: "laptop-id", path: "relative/b.git" },
      { hostId: "laptop-id", path: "~/b'; rm -rf ~; '" },
      { hostId: "laptop-id", path: "" },
    ]) {
      expect((await put({ host })).status).toBe(400);
    }
    expect(targets()).toEqual({ repoUrl: "", host: null });
  });

  it("refuses runs without a destination or while one is under way", async () => {
    expect((await setup().app.request("/api/backup/run", { method: "POST" })).status).toBe(409);
    const busy = setup({ repoUrl: "https://github.com/o/r.git", running: "backup" });
    expect((await busy.app.request("/api/backup/test", { method: "POST" })).status).toBe(409);
    expect(busy.calls).toEqual([]);

    const idle = setup({ host: { hostId: "laptop-id", path: "~/b.git" } });
    expect((await idle.app.request("/api/backup/test", { method: "POST" })).status).toBe(200);
    expect(idle.calls).toEqual(["testRestore"]);
  });

  it("serves the backup's Git path only to a sync's fetch", async () => {
    const response = await setup().app.request("/api/backup/git/repo/info/refs?service=git-upload-pack");
    expect(response.status).toBe(403);
  });

  it("accepts Git URLs and empty (off), and refuses credentials in the URL", () => {
    for (const url of [
      "",
      "https://github.com/owner/repo.git",
      "git@github.com:owner/repo.git",
      "ssh://git@github.com/owner/repo.git",
      "/srv/backups/takode.git",
    ]) {
      expect(repoUrlProblem(url)).toBeNull();
    }
    expect(repoUrlProblem("https://user:token@github.com/owner/repo.git")).toMatch(/credentials/);
    expect(repoUrlProblem("owner/repo")).toMatch(/Git URL/);
  });
});
