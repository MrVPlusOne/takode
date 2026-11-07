import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupDataBranch, backupMemoryBranch, restoreFromBackup, runBackup, testBackupRestore } from "./backup-job.js";
import { spawn } from "node:child_process";
import { Hono } from "hono";
import { startApiProxy } from "../remote-host/host-agent.js";
import { createBackupRoutes } from "../routes/backup.js";
import type { HostRunner } from "./backup-host-sync.js";
import { BackupService } from "./backup-service.js";
import {
  checkBackupSnapshot,
  readBackupManifest,
  readRestoredQuestCounts,
  restoreBackupSnapshot,
  writeBackupSnapshot,
} from "./backup-snapshot.js";

// Fixture: a coordinator's `.companion` with quests, settings holding secrets,
// state that must stay out of backups, a memory repo, and the user's
// instructions linked from a checkout elsewhere. The backup repository is a
// local bare repo. Everything lives under one throwaway folder; nothing
// touches the real ~/.companion or any remote.

const SERVER_ID = "server-1";
const PORT = 3456;
const QUESTS = [
  { id: "q-3", questId: "q-3", title: "Third", feedback: [{ text: "note" }] },
  { id: "q-1", questId: "q-1", title: "First" },
  { id: "q-2", questId: "q-2", title: "Second", tags: ["ui"] },
];
const STORE = { format: "mutable_current_record", version: 1, quests: QUESTS, nextQuestNumber: 4, updatedAt: 5 };

let root: string;
let companion: string;
let bare: string;
let workDir: string;

async function put(path: string, content: unknown): Promise<void> {
  const file = join(companion, path);
  await mkdir(join(file, ".."), { recursive: true });
  await writeFile(file, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd })
    .toString()
    .trim();
}

async function commitMemoryNote(name: string): Promise<string> {
  const repo = join(companion, "memory", "prod", "Takode");
  await writeFile(join(repo, name), `${name}\n`);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", name);
  return git(repo, "rev-parse", "HEAD");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "takode-backup-"));
  companion = join(root, "home", ".companion");
  bare = join(root, "backup.git");
  workDir = join(root, "home", ".companion", "backup", "repo");
  await put(`settings-${PORT}.json`, {
    serverId: SERVER_ID,
    serverSlug: "prod",
    pushoverUserKey: "user-key",
    pushoverApiToken: "app-token",
    namerConfig: { backend: "openai", apiKey: "sk-inline", model: "m" },
    theme: "dark",
  });
  await put(`settings-secrets-${PORT}.json`, { transcriptionApiKey: "sk-secret" });
  await put("machine.json", { name: "devbox" });
  await put("questmaster-live/store.json", STORE);
  await put("questmaster-live/store.json.123.abc.tmp", "half-written");
  await put("questmaster-live/images/abc.webp", "image-bytes");
  await put("todos/todo-list.json", { items: [{ id: "td-1", markdown: "Call the bank" }] });
  await put(`library/${SERVER_ID}/index.json`, { posts: 1 });
  await put(`library/${SERVER_ID}/files/f.png`, "png");
  await put(`landing-gates/${SERVER_ID}.json`, { gate: true });
  await put(`hosts/${SERVER_ID}.json`, { hosts: [], local: { nodeTokenSha256: "hash" } });
  await put(`hosts/${SERVER_ID}-local-node.token`, "node-token");
  await put("session-names.json", { abc: "Backups" });
  await put(`sessions/${PORT}/launcher.json`, [{ sessionId: "abc", sessionNum: 7, pid: 4242, state: "connected" }]);
  await put(`sessions/${PORT}/abc.json`, { history: "long" });
  await put("envs/work.json", { variables: { API_KEY: "sk-env" } });
  await put(`browser-login/${SERVER_ID}.json`, { passwordHash: "hash" });
  await put(`web-push/${SERVER_ID}.json`, { privateKey: "vapid" });
  // The user's instructions are a link into a checkout, like the real store.
  const checkout = join(root, "personal-agent-instructions");
  await mkdir(join(checkout, "user-instructions"), { recursive: true });
  await mkdir(join(checkout, ".git"), { recursive: true });
  await writeFile(join(checkout, "user-instructions", "all.md"), "# Rules\n");
  await symlink(join(checkout, "user-instructions"), join(companion, "user-instructions"));

  const memory = join(companion, "memory", "prod", "Takode");
  await mkdir(memory, { recursive: true });
  git(memory, "init", "-q", "-b", "main");
  await commitMemoryNote("first.md");
  // An empty memory space has nothing to back up.
  await mkdir(join(companion, "memory", "prod", "Personal"), { recursive: true });
  git(join(companion, "memory", "prod", "Personal"), "init", "-q");

  git(root, "init", "-q", "--bare", bare);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("backup snapshot", () => {
  it("keeps durable data, splits quests, and leaves secrets and session histories out", async () => {
    const snapshot = join(root, "snapshot");
    const manifest = await writeBackupSnapshot({ companion, port: PORT, target: snapshot });
    const files = Object.keys(manifest.files);

    expect(manifest.quests).toEqual({ count: 3, nextQuestNumber: 4 });
    expect(files).toEqual(
      expect.arrayContaining([
        "questmaster-live/quests/q-1.json",
        "questmaster-live/quests/_meta.json",
        "questmaster-live/images/abc.webp",
        "todos/todo-list.json",
        `library/${SERVER_ID}/files/f.png`,
        "user-instructions/all.md",
        `sessions/${PORT}/launcher.json`,
        `hosts/${SERVER_ID}.json`,
        "session-names.json",
      ]),
    );
    // Secrets, session histories, temporary files and the whole quest store stay out.
    for (const left of [
      `settings-secrets-${PORT}.json`,
      "envs/work.json",
      `browser-login/${SERVER_ID}.json`,
      `web-push/${SERVER_ID}.json`,
      `hosts/${SERVER_ID}-local-node.token`,
      `sessions/${PORT}/abc.json`,
      "questmaster-live/store.json",
      "questmaster-live/store.json.123.abc.tmp",
    ]) {
      expect(files).not.toContain(left);
    }
    const settings = JSON.parse(await readFile(join(snapshot, `settings-${PORT}.json`), "utf-8"));
    expect(settings).toMatchObject({ pushoverUserKey: "", pushoverApiToken: "", theme: "dark" });
    expect(settings.namerConfig.apiKey).toBe("");
    // The session list keeps sessions and numbers, but no process IDs a restored server could act on.
    const sessions = JSON.parse(await readFile(join(snapshot, `sessions/${PORT}/launcher.json`), "utf-8"));
    expect(sessions).toEqual([{ sessionId: "abc", sessionNum: 7, state: "exited" }]);
    expect(await checkBackupSnapshot(snapshot)).toEqual([]);
  });

  it("restores a .companion folder with one file per quest, exactly", async () => {
    // A store the server has not moved yet is split into the quest folder a current server reads.
    const snapshot = join(root, "snapshot");
    await writeBackupSnapshot({ companion, port: PORT, target: snapshot });
    const restored = join(root, "restored");
    await restoreBackupSnapshot(snapshot, restored);

    for (const quest of QUESTS) {
      expect(await readFile(join(restored, `questmaster-live/quests/${quest.questId}.json`), "utf-8")).toBe(
        `${JSON.stringify(quest, null, 2)}\n`,
      );
    }
    expect(await readRestoredQuestCounts(restored)).toEqual({ count: 3, nextQuestNumber: 4 });
    expect(await readFile(join(restored, "user-instructions/all.md"), "utf-8")).toBe("# Rules\n");
    expect(await readFile(join(restored, "todos/todo-list.json"), "utf-8")).toBe(
      await readFile(join(companion, "todos/todo-list.json"), "utf-8"),
    );
    // Restoring over existing data is refused.
    await expect(restoreBackupSnapshot(snapshot, restored)).rejects.toThrow(/not empty/);
  });

  it("rewrites nothing when nothing changed, and removes files the data no longer has", async () => {
    const snapshot = join(root, "snapshot");
    const first = await writeBackupSnapshot({ companion, port: PORT, target: snapshot, now: new Date(1000) });
    const again = await writeBackupSnapshot({ companion, port: PORT, target: snapshot, now: new Date(2000) });
    // Same content keeps the first manifest, so a commit of the folder would be empty.
    expect(again.createdAt).toBe(first.createdAt);

    await rm(join(companion, "questmaster-live/images/abc.webp"));
    const third = await writeBackupSnapshot({ companion, port: PORT, target: snapshot, now: new Date(3000) });
    expect(third.files["questmaster-live/images/abc.webp"]).toBeUndefined();
    expect(await readdir(join(snapshot, "questmaster-live"))).not.toContain("images");
  });

  it("copies the quest folder as it is and leaves migration leftovers out", async () => {
    await rm(join(companion, "questmaster-live/store.json"));
    await put("questmaster-live/quests/q-1.json", `${JSON.stringify(QUESTS[1], null, 2)}\n`);
    await put("questmaster-live/quests/q-3.json", `${JSON.stringify(QUESTS[0], null, 2)}\n`);
    await put("questmaster-live/quests/_meta.json", { format: "quest_per_file", version: 2, nextQuestNumber: 5 });
    await put("questmaster-live/quests/.q-1.json.99.abc.tmp", "half-written");
    await put("questmaster-live/store.json.before-per-quest-files", STORE);
    await put("questmaster-live/quests.migrating-2026/q-1.json", "{}");
    await put("questmaster-live/_store.lock/owner", "x");
    const snapshot = join(root, "snapshot");

    const manifest = await writeBackupSnapshot({ companion, port: PORT, target: snapshot });

    expect(manifest.quests).toEqual({ count: 2, nextQuestNumber: 5 });
    expect(
      Object.keys(manifest.files)
        .filter((path) => path.startsWith("questmaster-live/"))
        .sort(),
    ).toEqual([
      "questmaster-live/images/abc.webp",
      "questmaster-live/quests/_meta.json",
      "questmaster-live/quests/q-1.json",
      "questmaster-live/quests/q-3.json",
    ]);
    const restored = join(root, "restored");
    await restoreBackupSnapshot(snapshot, restored);
    expect(await readFile(join(restored, "questmaster-live/quests/q-3.json"), "utf-8")).toBe(
      await readFile(join(companion, "questmaster-live/quests/q-3.json"), "utf-8"),
    );
  });

  it("restores a snapshot written before one file per quest by joining its quests back", async () => {
    // Such snapshots split the store with store-meta.json; restore rebuilds store.json, which the server moves.
    const snapshot = join(root, "snapshot");
    await writeBackupSnapshot({ companion, port: PORT, target: snapshot });
    const manifest = JSON.parse(await readFile(join(snapshot, "manifest.json"), "utf-8"));
    const meta = `${JSON.stringify({ format: STORE.format, version: 1, nextQuestNumber: 4, updatedAt: 5, questOrder: ["q-3", "q-1", "q-2"] })}`;
    await writeFile(join(snapshot, "questmaster-live/store-meta.json"), meta);
    await rm(join(snapshot, "questmaster-live/quests/_meta.json"));
    delete manifest.files["questmaster-live/quests/_meta.json"];
    manifest.files["questmaster-live/store-meta.json"] = createHash("sha256").update(meta).digest("hex");
    await writeFile(join(snapshot, "manifest.json"), JSON.stringify(manifest));

    const restored = join(root, "restored");
    await restoreBackupSnapshot(snapshot, restored);
    expect(JSON.parse(await readFile(join(restored, "questmaster-live/store.json"), "utf-8"))).toEqual(STORE);
    expect(await readRestoredQuestCounts(restored)).toEqual({ count: 3, nextQuestNumber: 4 });
  });

  it("reports a damaged snapshot instead of restoring it", async () => {
    const snapshot = join(root, "snapshot");
    await writeBackupSnapshot({ companion, port: PORT, target: snapshot });
    await writeFile(join(snapshot, "questmaster-live/quests/q-2.json"), "{}");
    await rm(join(snapshot, "todos/todo-list.json"));

    expect(await checkBackupSnapshot(snapshot)).toEqual([
      "questmaster-live/quests/q-2.json does not match its recorded hash",
      "todos/todo-list.json is missing",
    ]);
    await expect(restoreBackupSnapshot(snapshot, join(root, "restored"))).rejects.toThrow(/damaged/);
  });
});

describe("backup job", () => {
  it("pushes the data and memory branches, commits only changes, and restores both", async () => {
    const first = await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    expect(first).toMatchObject({ ok: true, changed: true, quests: 3, errors: [] });
    expect(first.memory.map((entry) => entry.space)).toEqual(["Takode"]);
    expect(git(bare, "rev-parse", backupDataBranch("prod"))).toBe(first.commit);
    expect(git(bare, "rev-parse", backupMemoryBranch("prod", "Takode"))).toBe(first.memory[0]!.head);

    // Nothing changed: no new commit.
    const second = await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    expect(second).toMatchObject({ ok: true, changed: false, commit: first.commit });

    // A new quest and a new memory note arrive with the next run.
    await put("questmaster-live/store.json", { ...STORE, quests: [{ questId: "q-4", id: "q-4" }, ...QUESTS] });
    const note = await commitMemoryNote("second.md");
    const third = await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    expect(third).toMatchObject({ ok: true, changed: true, quests: 4 });
    expect(git(bare, "rev-parse", backupMemoryBranch("prod", "Takode"))).toBe(note);

    expect(await testBackupRestore({ repoUrl: bare, serverSlug: "prod" })).toMatchObject({ ok: true, quests: 4 });

    const target = join(root, "restored");
    const restored = await restoreFromBackup({ repoUrl: bare, target });
    expect(restored).toMatchObject({ serverSlug: "prod", quests: 4, memory: ["Takode"] });
    expect((await readdir(join(target, "questmaster-live/quests"))).sort()).toEqual([
      "_meta.json",
      "q-1.json",
      "q-2.json",
      "q-3.json",
      "q-4.json",
    ]);
    const memory = join(target, "memory", "prod", "Takode");
    expect(git(memory, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(memory, "log", "--format=%s")).toBe("second.md\nfirst.md");
  });

  it("refuses a rewound memory repo, keeps its backed-up history and reports it", async () => {
    await commitMemoryNote("second.md");
    const before = await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    const backedUp = before.memory[0]!.head;
    // A mistake on the machine rewinds the memory repo.
    git(join(companion, "memory", "prod", "Takode"), "reset", "-q", "--hard", "HEAD~1");

    const after = await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    expect(after.ok).toBe(false);
    expect(after.errors[0]).toMatch(/memory Takode was not backed up/);
    expect(git(bare, "rev-parse", backupMemoryBranch("prod", "Takode"))).toBe(backedUp);
  });

  it("continues the repository's history from a new clone, as after a machine move", async () => {
    const first = await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    await rm(workDir, { recursive: true });
    await put("todos/todo-list.json", { items: [] });

    const next = await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    expect(next).toMatchObject({ ok: true, changed: true });
    expect(git(bare, "rev-parse", `${backupDataBranch("prod")}~1`)).toBe(first.commit);
    expect((await readBackupManifest(workDir)).quests.count).toBe(3);
  });

  it("reports a repository it cannot reach", async () => {
    const missing = join(root, "missing.git");
    // A first run needs the repository to know whether it already holds a backup.
    await expect(runBackup({ companion, port: PORT, repoUrl: missing, workDir })).rejects.toThrow(/ls-remote/);

    await runBackup({ companion, port: PORT, repoUrl: bare, workDir });
    await put("todos/todo-list.json", { items: [] });
    const result = await runBackup({ companion, port: PORT, repoUrl: missing, workDir });
    expect(result).toMatchObject({ ok: false, changed: true });
    expect(result.errors[0]).toMatch(/push to the backup repository failed/);
  });

  it("runs as the server's child process and passes its restore test", async () => {
    const service = new BackupService({
      port: PORT,
      companion,
      getTargets: () => ({ repoUrl: bare, host: null }),
      getServerSlug: () => "prod",
      hostName: (hostId) => hostId,
      sendAlert: () => {},
    });
    expect((await service.backUp()).lastRun).toMatchObject({ ok: true, changed: true, quests: 3, errors: [] });
    expect((await service.testRestore()).lastTest).toMatchObject({ ok: true, problems: [] });
  });
});

describe("copy on another machine", () => {
  // The machine is simulated on this one: its sync script runs in /bin/sh with
  // its own HOME and reaches the server's backup Git route through a real node
  // API proxy over loopback. Everything stays under the fixture.
  it("pulls the backup into a new repository, refuses rewritten history, and restores from it", async () => {
    const machineHome = join(root, "laptop-home");
    await mkdir(machineHome, { recursive: true });
    const service = new BackupService({
      port: PORT,
      companion,
      getTargets: () => ({ repoUrl: "", host: { hostId: "laptop-id", path: "~/Backups/takode.git" } }),
      getServerSlug: () => "prod",
      hostName: () => "laptop",
      hosts: localMachine(machineHome, () => proxy.port),
      sendAlert: () => {},
    });
    const app = new Hono();
    app.route(
      "/api",
      createBackupRoutes(service, {
        getTargets: () => ({ repoUrl: "", host: null }),
        setTargets: () => {},
        isHost: () => true,
      }),
    );
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: app.fetch });
    // The machine reaches the coordinator through its node's API proxy, as on a real host.
    const proxy = startApiProxy({ coordinatorUrl: `http://127.0.0.1:${server.port}`, port: 0 });
    try {
      const first = await service.backUp();
      expect(first.lastRun).toMatchObject({ ok: true, changed: true });
      expect(first.hostSync).toMatchObject({ error: null, consecutiveFailures: 0 });
      const copy = join(machineHome, "Backups", "takode.git");
      const backedUp = git(workDir, "rev-parse", backupDataBranch("prod"));
      expect(git(copy, "rev-parse", backupDataBranch("prod"))).toBe(backedUp);
      expect(git(copy, "rev-parse", backupMemoryBranch("prod", "Takode"))).toBe(
        git(workDir, "rev-parse", backupMemoryBranch("prod", "Takode")),
      );

      // A request without the sync's token gets nothing.
      const anonymous = await fetch(
        `http://127.0.0.1:${server.port}/api/backup/git/repo/info/refs?service=git-upload-pack`,
      );
      expect(anonymous.status).toBe(403);

      // A mistake on the coordinator rewrites the data branch: the copy keeps what it had.
      git(workDir, "commit", "-q", "--amend", "-m", "rewritten");
      const rewritten = await service.syncHost();
      expect(rewritten.hostSync!.error).toMatch(/fetching into ~\/Backups\/takode.git failed/);
      expect(git(copy, "rev-parse", backupDataBranch("prod"))).toBe(backedUp);

      // The copy restores like the repository would.
      const restored = await restoreFromBackup({ repoUrl: copy, target: join(root, "restored") });
      expect(restored).toMatchObject({ serverSlug: "prod", quests: 3, memory: ["Takode"] });
    } finally {
      proxy.stop();
      server.stop(true);
    }
  });

  it("refuses a folder that holds something else", async () => {
    const machineHome = join(root, "laptop-home");
    await mkdir(join(machineHome, "Backups", "takode.git"), { recursive: true });
    await writeFile(join(machineHome, "Backups", "takode.git", "notes.txt"), "mine");
    const service = new BackupService({
      port: PORT,
      companion,
      getTargets: () => ({ repoUrl: "", host: { hostId: "laptop-id", path: "~/Backups/takode.git" } }),
      getServerSlug: () => "prod",
      hostName: () => "laptop",
      hosts: localMachine(machineHome, () => 1),
      sendAlert: () => {},
    });
    const status = await service.backUp();
    expect(status.hostSync!.error).toMatch(/neither empty nor a bare Git repository/);
    expect(await readFile(join(machineHome, "Backups", "takode.git", "notes.txt"), "utf-8")).toBe("mine");
  });
});

/** A {@link HostRunner} that runs the sync script here, as a machine whose home is `home`. */
function localMachine(home: string, port: () => number): HostRunner {
  return {
    blocker: () => null,
    run: (_hostId, script, env) =>
      new Promise((resolve) => {
        const child = spawn("/bin/sh", ["-c", script], {
          env: { ...process.env, ...env, HOME: home, COMPANION_PORT: String(port()) },
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
      }),
  };
}
