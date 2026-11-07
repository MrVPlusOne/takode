/**
 * The Git side of backups, run in a child process of the server (or by the
 * `takode backup restore` CLI) so that reading the stores and running Git
 * never block the server.
 *
 * One repository the user picks holds everything, on branches named by the
 * server's slug:
 * - `takode/<slug>/data`: the snapshot (`backup-snapshot.ts`), one commit per
 *   run that changed something;
 * - `takode/<slug>/memory/<space>`: each memory repo's own history, so memory
 *   commit IDs that quests cite stay valid. These are branches rather than
 *   submodules: a submodule only records a commit and would still need the
 *   memory repo pushed somewhere of its own.
 *
 * Nothing is ever force-pushed or force-fetched. A memory repo that was
 * rewound or rewritten is refused and reported, and the backup keeps the
 * history it had; together with a repository rule against force-pushes, a
 * mistake on this machine cannot rewrite what is already backed up.
 */

import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  checkBackupSnapshot,
  readBackupManifest,
  readRestoredQuestCounts,
  restoreBackupSnapshot,
  writeBackupSnapshot,
} from "./backup-snapshot.js";

const execFileAsync = promisify(execFile);

export function backupDataBranch(serverSlug: string): string {
  return `takode/${serverSlug}/data`;
}

export function backupMemoryBranch(serverSlug: string, space: string): string {
  return `takode/${serverSlug}/memory/${space}`;
}

export interface RunBackupInput {
  /** The `.companion` folder to back up. */
  companion: string;
  port: number;
  /** The backup repository's Git URL; empty to keep the backup only in `workDir` (for other destinations). */
  repoUrl: string;
  /** Local clone the snapshot is written and committed in; created on first use. */
  workDir: string;
}

export interface RunBackupResult {
  ok: boolean;
  /** The data branch's commit after the run, null when nothing was ever committed. */
  commit: string | null;
  /** Whether this run committed a change. */
  changed: boolean;
  quests: number;
  memory: Array<{ space: string; head: string }>;
  /** What went wrong; anything here makes the run count as failed. */
  errors: string[];
}

/**
 * Write a snapshot, commit it if it changed, bring the memory branches up to
 * date, and push everything to `repoUrl` when one is set.
 */
export async function runBackup(input: RunBackupInput): Promise<RunBackupResult> {
  const { companion, port, repoUrl, workDir } = input;
  const settings = JSON.parse(await readFile(join(companion, `settings-${port}.json`), "utf-8")) as {
    serverSlug?: string;
  };
  if (!settings.serverSlug) throw new Error(`settings-${port}.json has no serverSlug`);
  const slug = settings.serverSlug;
  const dataBranch = backupDataBranch(slug);
  const errors: string[] = [];

  await prepareRepo(workDir, repoUrl);
  await checkOutBranch(workDir, dataBranch);

  const memory: RunBackupResult["memory"] = [];
  const memoryRoot = join(companion, "memory", slug);
  for (const space of (await readdir(memoryRoot).catch(() => [] as string[])).sort()) {
    const repo = join(memoryRoot, space);
    if (!(await exists(join(repo, ".git")))) continue;
    const head = await git(repo, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => "");
    if (!head) continue;
    try {
      await git(workDir, ["fetch", "-q", repo, `HEAD:refs/heads/${backupMemoryBranch(slug, space)}`]);
      memory.push({ space, head });
    } catch (error) {
      errors.push(
        `memory ${space} was not backed up: its history no longer continues what the backup has ` +
          `(rewound or rewritten), so the backup kept its earlier history. ${message(error)}`,
      );
    }
  }

  const manifest = await writeBackupSnapshot({ companion, port, target: workDir, memory });
  await git(workDir, ["add", "-A"]);
  const changed = (await git(workDir, ["status", "--porcelain"])) !== "";
  if (changed) {
    await git(workDir, ["commit", "-q", "-m", `Backup ${manifest.createdAt}: ${manifest.quests.count} quests`]);
  }
  const commit = (await git(workDir, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => "")) || null;

  const memoryRefs = (await git(workDir, ["for-each-ref", "--format=%(refname)", `refs/heads/takode/${slug}/memory/`]))
    .split("\n")
    .filter(Boolean);
  const refs = [...(commit ? [`refs/heads/${dataBranch}`] : []), ...memoryRefs];
  if (repoUrl && refs.length > 0) {
    try {
      await git(workDir, ["push", "--atomic", "-q", "origin", ...refs.map((ref) => `${ref}:${ref}`)]);
    } catch (error) {
      errors.push(`push to the backup repository failed: ${message(error)}`);
    }
  }
  return { ok: errors.length === 0, commit, changed, quests: manifest.quests.count, memory, errors };
}

export interface RestoreTestResult {
  ok: boolean;
  problems: string[];
  /** When the snapshot that was tested was written. */
  snapshotAt: string | null;
  quests: number;
}

/**
 * Check that the backup repository can be restored: clone the latest data
 * snapshot into a scratch folder, check every file against the manifest,
 * restore it to a `.companion` folder and read the quest store back, and
 * check that each memory branch holds the commit the snapshot recorded.
 */
export async function testBackupRestore(input: { repoUrl: string; serverSlug: string }): Promise<RestoreTestResult> {
  const scratch = await mkdtemp(join(tmpdir(), "takode-backup-test-"));
  try {
    const snapshot = join(scratch, "snapshot");
    await cloneBranch(input.repoUrl, backupDataBranch(input.serverSlug), snapshot, true);
    const manifest = await readBackupManifest(snapshot);
    const problems = await checkBackupSnapshot(snapshot);
    if (problems.length === 0) {
      const restored = join(scratch, "restored");
      await restoreBackupSnapshot(snapshot, restored);
      const store = await readRestoredQuestCounts(restored);
      if (manifest.quests.count > 0 && store?.count !== manifest.quests.count) {
        problems.push(`the restored quest store does not hold the ${manifest.quests.count} quests backed up`);
      }
      if (store && store.nextQuestNumber !== manifest.quests.nextQuestNumber) {
        problems.push("the restored quest store's next quest number differs from the backup's");
      }
    }
    const heads = await remoteHeads(input.repoUrl, `refs/heads/takode/${input.serverSlug}/memory/`);
    for (const { space, head } of manifest.memory) {
      const remote = heads.get(`refs/heads/${backupMemoryBranch(input.serverSlug, space)}`);
      if (remote !== head) problems.push(`memory branch ${space} does not hold the commit the snapshot recorded`);
    }
    return { ok: problems.length === 0, problems, snapshotAt: manifest.createdAt, quests: manifest.quests.count };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * Restore a backup repository into `target` (missing or empty): the data
 * snapshot becomes a `.companion` folder, and each memory branch becomes the
 * memory repo `memory/<slug>/<space>` on its `main` branch. `serverSlug` may be
 * left out when the repository backs up a single server.
 */
export async function restoreFromBackup(input: {
  repoUrl: string;
  target: string;
  serverSlug?: string;
}): Promise<{ serverSlug: string; files: number; quests: number; memory: string[]; snapshotAt: string }> {
  const heads = await remoteHeads(input.repoUrl, "refs/heads/takode/");
  const slugs = [...heads.keys()].map((ref) => /^refs\/heads\/takode\/(.+)\/data$/.exec(ref)?.[1]).filter(Boolean);
  const serverSlug = input.serverSlug ?? (slugs.length === 1 ? slugs[0]! : undefined);
  if (!serverSlug || !slugs.includes(serverSlug)) {
    throw new Error(
      slugs.length === 0
        ? `${input.repoUrl} holds no Takode backup.`
        : `Name the server to restore with --slug: this repository backs up ${slugs.join(", ")}.`,
    );
  }
  const scratch = await mkdtemp(join(tmpdir(), "takode-backup-restore-"));
  try {
    const snapshot = join(scratch, "snapshot");
    await cloneBranch(input.repoUrl, backupDataBranch(serverSlug), snapshot, true);
    const { manifest, files } = await restoreBackupSnapshot(snapshot, input.target);
    const memory: string[] = [];
    for (const { space } of manifest.memory) {
      const repo = join(input.target, "memory", serverSlug, space);
      await cloneBranch(input.repoUrl, backupMemoryBranch(serverSlug, space), repo, false);
      await git(repo, ["branch", "-m", "main"]);
      await git(repo, ["remote", "remove", "origin"]);
      memory.push(space);
    }
    return { serverSlug, files, quests: manifest.quests.count, memory, snapshotAt: manifest.createdAt };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

// ─── Git ─────────────────────────────────────────────────────────────────────

async function prepareRepo(workDir: string, repoUrl: string): Promise<void> {
  await mkdir(workDir, { recursive: true });
  if (!(await exists(join(workDir, ".git")))) await git(workDir, ["init", "-q"]);
  for (const [key, value] of [
    ["user.name", "Takode backup"],
    ["user.email", "takode-backup@localhost"],
    ["commit.gpgsign", "false"],
    ["core.autocrlf", "false"],
    ["core.quotepath", "false"],
    // The first push carries every image and Library file at once.
    ["http.postBuffer", "524288000"],
  ]) {
    await git(workDir, ["config", key, value]);
  }
  if (!repoUrl) return;
  const current = await git(workDir, ["remote", "get-url", "origin"]).catch(() => null);
  if (current === null) await git(workDir, ["remote", "add", "origin", repoUrl]);
  else if (current !== repoUrl) await git(workDir, ["remote", "set-url", "origin", repoUrl]);
}

/**
 * Make `branch` the clone's current branch without touching its files (the
 * snapshot rewrites them): the local branch, else the repository's (when this
 * clone is new and an earlier one already backed up, say before a machine
 * move), else a new branch.
 */
async function checkOutBranch(workDir: string, branch: string): Promise<void> {
  const ref = `refs/heads/${branch}`;
  if ((await git(workDir, ["symbolic-ref", "-q", "HEAD"]).catch(() => "")) === ref) return;
  const local = await git(workDir, ["rev-parse", "-q", "--verify", ref]).catch(() => "");
  const origin = await git(workDir, ["remote", "get-url", "origin"]).catch(() => "");
  if (!local && origin && (await remoteHeads("origin", ref, workDir)).has(ref)) {
    await git(workDir, ["fetch", "-q", "origin", `${ref}:${ref}`]);
  }
  await git(workDir, ["symbolic-ref", "HEAD", ref]);
  if (await git(workDir, ["rev-parse", "-q", "--verify", "HEAD"]).catch(() => "")) {
    await git(workDir, ["reset", "-q"]);
  }
}

async function cloneBranch(repoUrl: string, branch: string, target: string, shallow: boolean): Promise<void> {
  const depth = shallow ? ["--depth", "1"] : [];
  await git(tmpdir(), ["clone", "-q", ...depth, "--single-branch", "--branch", branch, repoUrl, target]);
}

/** The repository's branch heads whose ref names start with `prefix`, by full ref name. */
async function remoteHeads(repo: string, prefix: string, cwd = tmpdir()): Promise<Map<string, string>> {
  const heads = new Map<string, string>();
  for (const line of (await git(cwd, ["ls-remote", repo, `${prefix}*`])).split("\n")) {
    const [sha, ref] = line.split("\t");
    if (sha && ref?.startsWith(prefix)) heads.set(ref, sha);
  }
  return heads;
}

async function git(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["--no-optional-locks", ...args], {
      cwd,
      maxBuffer: 64 * 1024 * 1024,
      // Never wait for a password prompt nobody can answer.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return stdout.trim();
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(`git ${args[0]} failed${stderr ? `: ${stderr}` : `: ${message(error)}`}`);
  }
}

function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false,
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Run by the server as `bun backup-job.ts '<json request>'`; prints one JSON result line.
if (import.meta.main) {
  const request = JSON.parse(process.argv[2] ?? "{}") as
    | ({ kind: "backup" } & RunBackupInput)
    | { kind: "test"; repoUrl: string; serverSlug: string };
  try {
    const result = request.kind === "backup" ? await runBackup(request) : await testBackupRestore(request);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({ ok: false, errors: [message(error)], problems: [message(error)] }));
    process.exitCode = 1;
  }
}
