import { Hono, type Context } from "hono";
import type { BackupHostTarget, BackupTargets } from "../../shared/backup-status.js";
import { BACKUP_GIT_PATH, serveBackupGit } from "../backup/backup-git-server.js";
import type { BackupService } from "../backup/backup-service.js";

/**
 * Backups of the coordinator's data to destinations the user picked: a Git
 * repository URL and/or a repository on a registered machine (see
 * `docs/backups.md`). Runs take minutes, so starting one returns at once and
 * the status shows its progress.
 */
export function createBackupRoutes(
  service: BackupService,
  deps: {
    getTargets: () => BackupTargets;
    setTargets: (targets: BackupTargets) => void;
    /** Whether a registered machine (not this one) has this id. */
    isHost: (hostId: string) => boolean;
  },
) {
  const api = new Hono();

  api.get("/backup", async (c) => c.json(await service.status()));

  /**
   * Set the destinations; a field left out keeps its value, and empty turns it
   * off. A new destination gets its first backup right away.
   */
  api.put("/backup", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { repoUrl?: unknown; host?: unknown };
    const next = { ...deps.getTargets() };
    if (body.repoUrl !== undefined) {
      if (typeof body.repoUrl !== "string") return c.json({ error: "repoUrl must be a string" }, 400);
      const problem = repoUrlProblem(body.repoUrl.trim());
      if (problem) return c.json({ error: problem }, 400);
      next.repoUrl = body.repoUrl.trim();
    }
    if (body.host !== undefined) {
      const host = parseHost(body.host, deps.isHost);
      if (typeof host === "string") return c.json({ error: host }, 400);
      next.host = host;
    }
    deps.setTargets(next);
    await service.targetsChanged();
    return c.json(await service.status());
  });

  api.post("/backup/run", (c) => start(c, () => service.backUp()));
  api.post("/backup/test", (c) => start(c, () => service.testRestore()));

  /** Git fetches by the backup machine during a sync; the gates let them in with the sync's token. */
  api.on(["GET", "POST"], `${BACKUP_GIT_PATH.slice("/api".length)}/*`, async (c) => {
    if (!service.isFetchRequest(c.req.raw)) return c.json({ error: "Not a backup sync." }, 403);
    const pathInfo = new URL(c.req.url).pathname.slice(BACKUP_GIT_PATH.length);
    return serveBackupGit(c.req.raw, service.gitRoot, pathInfo);
  });

  async function start(c: Context, run: () => Promise<unknown>) {
    const status = await service.status();
    if (!status.repoUrl && !status.host) return c.json({ error: "No backup destination is set." }, 409);
    if (status.running) return c.json({ error: "A backup run or restore test is under way." }, 409);
    void run().catch((error) => console.error("[backup] Run failed:", error));
    return c.json(await service.status());
  }

  return api;
}

/** Why a repository URL is not accepted, or null. */
export function repoUrlProblem(repoUrl: string): string | null {
  if (!repoUrl) return null;
  if (/\s/.test(repoUrl)) return "The repository URL must not contain spaces.";
  // Credentials belong in Git's credential store, not in settings shown on screen.
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/]*@/i.test(repoUrl) && !/^ssh:\/\/[^/:@]+@/i.test(repoUrl)) {
    return "Leave credentials out of the URL; Git takes them from this machine's credential store.";
  }
  if (/^(https?|ssh|git|file):\/\//i.test(repoUrl) || /^[\w.-]+@[\w.-]+:/.test(repoUrl) || repoUrl.startsWith("/")) {
    return null;
  }
  return "Use the repository's Git URL, such as https://github.com/<owner>/<repo>.git.";
}

/** The machine destination from a request (null turns it off), or why it is not accepted. */
function parseHost(value: unknown, isHost: (hostId: string) => boolean): BackupHostTarget | null | string {
  if (value === null) return null;
  const { hostId, path } = (value ?? {}) as { hostId?: unknown; path?: unknown };
  if (typeof hostId !== "string" || !isHost(hostId)) return "Pick a registered machine other than this one.";
  if (typeof path !== "string" || !path.trim()) return "Give the folder of the repository on that machine.";
  const folder = path.trim();
  // The path is passed to the machine's shell in an environment variable; refuse what would not be a plain folder.
  if (!/^(~|\/)/.test(folder) || /['"`$\\\n]/.test(folder)) {
    return "Give an absolute folder, or one starting with ~, without quotes, $ or backslashes.";
  }
  return { hostId, path: folder };
}
