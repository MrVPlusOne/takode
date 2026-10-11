import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import {
  linesOnlyHere,
  skillFilesOnlyHere,
  skillFolderDigest,
  USER_CONTENT_SCOPES,
  type UserContent,
  type UserContentScope,
  type UserLevelPaths,
  userLevelPaths,
  visibleNames,
} from "./user-content.js";

/**
 * Machine side of user content delivery. Takode owns `~/.claude/CLAUDE.md`,
 * `~/.codex/AGENTS.md` and the skill links it creates, but never silently
 * replaces a file or skill the user made: such an entry is reported as a
 * conflict and left alone until the user approves a take-over. Every file
 * Takode replaces or removes is backed up first.
 */

export interface UserContentMachineRoots {
  /** This machine's copy of the content; skill links point into it. */
  installRoot: string;
  /** Hashes of the instruction files Takode last wrote, which mark them as Takode's. */
  ownershipFile: string;
  backupRoot: string;
  paths: UserLevelPaths;
}

export function defaultMachineRoots(home = homedir()): UserContentMachineRoots {
  return {
    installRoot: join(home, ".companion", "user-content-installed"),
    ownershipFile: join(home, ".companion", "user-content-written.json"),
    backupRoot: join(home, ".companion", "backups", "user-content"),
    paths: userLevelPaths(home),
  };
}

export interface UserContentInstallRequest {
  hash: string;
  /** Null asks only whether this machine's copy is current. */
  content: UserContent | null;
  /** Skills Takode installs itself; they win over a user skill of the same name. */
  takodeSkills: string[];
  /** The user approved replacing their own files and skills here (each is backed up). */
  takeOver?: boolean;
}

export type InstructionFileState =
  | "absent" // nothing to deliver, no file
  | "unmanaged" // nothing to deliver, the user's own file left as is
  | "current"
  | "written" // created
  | "updated" // replaced Takode's earlier version
  | "removed" // Takode's file removed because nothing is left to deliver
  | "conflict" // a different file Takode did not write, left until the user approves a take-over
  | "taken-over"; // a file Takode did not write, replaced: approved, or identical to the store's

export interface InstructionFileResult {
  backend: "claude" | "codex";
  path: string;
  state: InstructionFileState;
  /** Why a conflict was left, or why a take-over needed no approval, in a few words. */
  detail?: string;
  /** For a conflict: what this machine's file holds that the store's does not (empty when nothing). */
  onlyHere?: string[];
  backup?: string;
}

export interface UserContentInstallResult {
  /** `needs-files`: this machine's copy differs; ask again with the content. */
  status: "current" | "installed" | "needs-files";
  instructionFiles: InstructionFileResult[];
  skills: {
    linked: string[];
    removed: string[];
    /** User skills not linked because a Takode skill of that name is installed. */
    shadowedByTakode: string[];
    /** Skill entries Takode did not create that differ from the store's, left until the user approves a take-over. */
    conflicts: { path: string; detail: string; onlyHere: string[] }[];
    /** Entries replaced by Takode's link: approved, or identical to the store's copy. */
    takenOver: string[];
  };
  /** Other facts the user should know, such as an AGENTS.override.md that hides AGENTS.md. */
  notes: string[];
  backupDir?: string;
}

const HASH_FILE = ".hash";
const MAX_BACKUP_RUNS = 50;

let installChain: Promise<unknown> = Promise.resolve();

/** Bring this machine up to date with the coordinator's user content (one run at a time). */
export function installUserContent(
  request: UserContentInstallRequest,
  roots: UserContentMachineRoots = defaultMachineRoots(),
): Promise<UserContentInstallResult> {
  const run = installChain.then(() => installNow(request, roots));
  installChain = run.catch(() => {});
  return run;
}

async function installNow(
  request: UserContentInstallRequest,
  roots: UserContentMachineRoots,
): Promise<UserContentInstallResult> {
  const result: UserContentInstallResult = {
    status: "current",
    instructionFiles: [],
    skills: { linked: [], removed: [], shadowedByTakode: [], conflicts: [], takenOver: [] },
    notes: [],
  };
  const installedHash = await readText(join(roots.installRoot, HASH_FILE));
  if (installedHash !== request.hash) {
    if (!request.content) return { ...result, status: "needs-files" };
    await replaceInstallRoot(roots.installRoot, request.hash, request.content);
    result.status = "installed";
  }
  const backups = new BackupRun(roots.backupRoot);
  const ownership = await readOwnership(roots.ownershipFile);
  for (const backend of ["claude", "codex"] as const) {
    const path = backend === "claude" ? roots.paths.claudeInstructions : roots.paths.codexInstructions;
    const desired = await readText(join(roots.installRoot, "instructions", `${backend}.md`));
    result.instructionFiles.push(await deliverFile(backend, path, desired, ownership, backups, !!request.takeOver));
  }
  await writeOwnership(roots.ownershipFile, ownership);
  const override = join(dirname(roots.paths.codexInstructions), "AGENTS.override.md");
  if (await lstat(override).catch(() => null)) {
    result.notes.push(`${override} exists, so Codex reads it instead of AGENTS.md`);
  }
  const skills = await installedSkills(roots.installRoot);
  const takode = new Set(request.takodeSkills);
  const linkOptions = { installRoot: roots.installRoot, takode, takeOver: !!request.takeOver, backups, result };
  await linkSkills(roots.paths.claudeSkills, "claude", preferScope(skills, "claude"), linkOptions);
  await linkSkills(roots.paths.agentsSkills, "agents", preferScope(skills, "codex"), linkOptions);
  if (backups.dir) {
    result.backupDir = backups.dir;
    await pruneBackups(roots.backupRoot);
  }
  return result;
}

async function readText(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf-8")).trim();
  } catch {
    return "";
  }
}

function sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Write the new copy beside the old one, then swap, so links never point at a half-written skill. */
async function replaceInstallRoot(installRoot: string, hash: string, content: UserContent): Promise<void> {
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const staging = `${installRoot}.new-${suffix}`;
  try {
    await mkdir(join(staging, "instructions"), { recursive: true });
    await writeFile(join(staging, "instructions", "claude.md"), content.instructions.claude);
    await writeFile(join(staging, "instructions", "codex.md"), content.instructions.codex);
    for (const file of content.skills) {
      if (!(USER_CONTENT_SCOPES as readonly string[]).includes(file.scope)) throw new Error(`Bad scope ${file.scope}`);
      const target = join(staging, "skills", file.scope, safeName(file.skill), safeRelativePath(file.path));
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(file.content, "base64"));
      await chmod(target, file.mode & 0o777);
    }
    await writeFile(join(staging, HASH_FILE), hash);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const old = `${installRoot}.old-${suffix}`;
  const hadOld = await rename(installRoot, old).then(
    () => true,
    () => false,
  );
  try {
    await rename(staging, installRoot);
  } catch (error) {
    if (hadOld) await rename(old, installRoot);
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  if (hadOld) await rm(old, { recursive: true, force: true });
}

function safeName(name: string): string {
  if (!name || name.startsWith(".") || name.includes("/") || name.includes("\\"))
    throw new Error(`Bad skill name ${name}`);
  return name;
}

function safeRelativePath(path: string): string {
  const normalized = normalize(path);
  if (!path || isAbsolute(path) || normalized.split(sep).includes("..")) throw new Error(`Bad skill file path ${path}`);
  return normalized;
}

/** One folder per run that backs anything up, named by time so the newest are easy to find. */
class BackupRun {
  dir: string | undefined;
  constructor(private readonly root: string) {}

  async folder(): Promise<string> {
    if (!this.dir) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      this.dir = join(this.root, `${stamp}-${randomBytes(3).toString("hex")}`);
      await mkdir(this.dir, { recursive: true });
    }
    return this.dir;
  }

  /** Copy a file's content (a link is kept as a link) and return where it went. */
  async save(path: string, name: string): Promise<string> {
    const target = join(await this.folder(), name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) await symlink(await readlink(path), target);
    else await copyFile(path, target);
    return target;
  }

  /** Move an entry (file, folder or link) out of the way. */
  async move(path: string, name: string): Promise<string> {
    const target = join(await this.folder(), name);
    await mkdir(dirname(target), { recursive: true });
    await rename(path, target);
    return target;
  }
}

async function pruneBackups(root: string): Promise<void> {
  const runs = (await readdir(root).catch(() => [] as string[])).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - MAX_BACKUP_RUNS))) {
    await rm(join(root, old), { recursive: true, force: true });
  }
}

type Ownership = Record<string, string>;

async function readOwnership(path: string): Promise<Ownership> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeOwnership(path: string, ownership: Ownership): Promise<void> {
  const text = `${JSON.stringify(ownership, null, 2)}\n`;
  if ((await readFile(path, "utf-8").catch(() => null)) === text) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function deliverFile(
  backend: "claude" | "codex",
  path: string,
  desired: string,
  ownership: Ownership,
  backups: BackupRun,
  takeOver: boolean,
): Promise<InstructionFileResult> {
  const base = { backend, path };
  const info = await lstat(path).catch(() => null);
  const isLink = info?.isSymbolicLink() ?? false;
  const current = info?.isFile() ? await readFile(path, "utf-8") : null;
  const ours = current !== null && ownership[path] === sha(current.trim());
  const backupName = `${backend}-${path.split(sep).pop()}`;

  if (!desired) {
    if (!info) return { ...base, state: "absent" };
    if (!ours) return { ...base, state: "unmanaged" };
    const backup = await backups.save(path, backupName);
    await unlink(path);
    delete ownership[path];
    return { ...base, state: "removed", backup };
  }
  if (current !== null && current.trim() === desired) {
    ownership[path] = sha(desired);
    return { ...base, state: "current" };
  }
  let state: InstructionFileState = "written";
  let backup: string | undefined;
  let detail: string | undefined;
  if (info) {
    if (!isLink && current === null) return { ...base, state: "conflict", detail: "not a regular file" };
    // A link to a file that already holds the store's text loses nothing when replaced.
    const linkedSame = isLink && (await readFile(path, "utf-8").catch(() => null))?.trim() === desired;
    if (!ours && !takeOver && !linkedSame) {
      const edited = current !== null && ownership[path] !== undefined;
      detail = isLink
        ? `a link to ${await readlink(path)}, differs from the store`
        : edited
          ? "edited by hand after Takode wrote it"
          : "differs from the store";
      const here = (await readFile(path, "utf-8").catch(() => null)) ?? "";
      return { ...base, state: "conflict", detail, onlyHere: linesOnlyHere(here, desired) };
    }
    backup = await backups.save(path, backupName);
    await unlink(path);
    state = ours ? "updated" : "taken-over";
    if (linkedSame && !ours) detail = "same as the store";
  }
  await mkdir(dirname(path), { recursive: true });
  const staging = `${path}.takode-${randomBytes(3).toString("hex")}`;
  await writeFile(staging, `${desired}\n`);
  await rename(staging, path);
  ownership[path] = sha(desired);
  return { ...base, state, ...(backup ? { backup } : {}), ...(detail ? { detail } : {}) };
}

async function installedSkills(installRoot: string): Promise<Map<UserContentScope, string[]>> {
  const skills = new Map<UserContentScope, string[]>();
  for (const scope of USER_CONTENT_SCOPES) skills.set(scope, await visibleNames(join(installRoot, "skills", scope)));
  return skills;
}

/** Skill name to the folder to link: shared skills, overridden by the backend's own. */
function preferScope(skills: Map<UserContentScope, string[]>, backend: "claude" | "codex"): Map<string, string> {
  const chosen = new Map<string, string>();
  for (const scope of ["all", backend] as const) {
    for (const skill of skills.get(scope) ?? []) chosen.set(skill, join("skills", scope, skill));
  }
  return chosen;
}

async function linkSkills(
  skillsHome: string,
  label: "claude" | "agents",
  wanted: Map<string, string>,
  options: {
    installRoot: string;
    takode: Set<string>;
    takeOver: boolean;
    backups: BackupRun;
    result: UserContentInstallResult;
  },
): Promise<void> {
  const { installRoot, takode, takeOver, backups, result } = options;
  const ownPrefix = installRoot + sep;
  // Remove Takode's links that are no longer wanted or point at the wrong copy.
  for (const name of await readdir(skillsHome).catch(() => [] as string[])) {
    const entry = join(skillsHome, name);
    const target = await readlink(entry).catch(() => null);
    if (target === null || !target.startsWith(ownPrefix)) continue;
    const want = wanted.get(name);
    if (want && !takode.has(name) && target === join(installRoot, want)) continue;
    await unlink(entry);
    if (!want || takode.has(name)) result.skills.removed.push(entry);
  }
  for (const [name, relative] of wanted) {
    const entry = join(skillsHome, name);
    if (takode.has(name)) {
      result.skills.shadowedByTakode.push(entry);
      continue;
    }
    const source = join(installRoot, relative);
    const existing = await lstat(entry).catch(() => null);
    if (existing?.isSymbolicLink() && (await readlink(entry)) === source) continue;
    if (existing) {
      // An entry with exactly the store's files loses nothing when replaced, so it needs no approval.
      const same = await skillFolderDigest(entry)
        .then(async (digest) => digest === (await skillFolderDigest(source)))
        .catch(() => false);
      if (!takeOver && !same) {
        const reachable = await stat(entry).catch(() => null);
        if (!reachable) {
          const detail = `a link to ${await readlink(entry)}, which does not exist`;
          result.skills.conflicts.push({ path: entry, detail, onlyHere: [] });
          continue;
        }
        const onlyHere = await skillFilesOnlyHere(entry, source).catch((error) => [`could not compare: ${error}`]);
        result.skills.conflicts.push({ path: entry, detail: "differs from the store", onlyHere });
        continue;
      }
      await backups.move(entry, join(`skills-${label}`, name));
      result.skills.takenOver.push(entry);
    } else {
      result.skills.linked.push(entry);
    }
    await mkdir(skillsHome, { recursive: true });
    await symlink(source, entry);
  }
}

export interface RetireUserSkillsRequest {
  /** Skill names to take out of this machine's skill folders. */
  skills: string[];
  /** Also take out links that point nowhere. */
  dangling?: boolean;
  takodeSkills: string[];
}

export interface RetireUserSkillsResult {
  moved: { path: string; backup: string }[];
  skipped: { path: string; reason: string }[];
  backupDir?: string;
}

/**
 * Take the user's own skill entries out of this machine's Claude and Codex
 * skill folders, for example copies made by hand that the store replaces or
 * skills the user no longer wants. Each entry is moved into a backup folder,
 * never deleted. Takode's own skills and the links Takode delivers from the
 * store are left alone (remove a store skill from the store instead).
 */
export function retireUserSkills(
  request: RetireUserSkillsRequest,
  roots: UserContentMachineRoots = defaultMachineRoots(),
): Promise<RetireUserSkillsResult> {
  const run = installChain.then(() => retireNow(request, roots));
  installChain = run.catch(() => {});
  return run;
}

async function retireNow(request: RetireUserSkillsRequest, roots: UserContentMachineRoots) {
  const result: RetireUserSkillsResult = { moved: [], skipped: [] };
  const backups = new BackupRun(roots.backupRoot);
  const takode = new Set(request.takodeSkills);
  const ownPrefix = roots.installRoot + sep;
  for (const [label, home] of [
    ["claude", roots.paths.claudeSkills],
    ["agents", roots.paths.agentsSkills],
  ] as const) {
    const names = new Set(request.skills);
    if (request.dangling) {
      for (const name of await readdir(home).catch(() => [] as string[])) {
        const entry = join(home, name);
        if ((await lstat(entry)).isSymbolicLink() && !(await stat(entry).catch(() => null))) names.add(name);
      }
    }
    for (const name of names) {
      const entry = join(home, name);
      if (!(await lstat(entry).catch(() => null))) continue;
      const target = await readlink(entry).catch(() => null);
      if (takode.has(name)) result.skipped.push({ path: entry, reason: "a Takode skill" });
      else if (target?.startsWith(ownPrefix)) result.skipped.push({ path: entry, reason: "delivered from the store" });
      else result.moved.push({ path: entry, backup: await backups.move(entry, join(`skills-${label}`, name)) });
    }
  }
  if (backups.dir) {
    result.backupDir = backups.dir;
    await pruneBackups(roots.backupRoot);
  }
  return result;
}
