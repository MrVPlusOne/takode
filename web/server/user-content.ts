import { createHash } from "node:crypto";
import { chmod, mkdir, readdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * User content: the instructions and skills a user keeps once, in two store
 * folders on the coordinator (see `user-content-service.ts`), for every session
 * on every machine:
 *
 *   ~/.companion/user-instructions/{all,claude,codex}.md
 *   ~/.companion/user-skills/{all,claude,codex}/<skill>/SKILL.md
 *
 * Either folder, and any entry in them, may be a link (for example into a Git
 * checkout); links are followed. Takode delivers the content to the standard
 * places Claude Code and Codex read on each machine: `~/.claude/CLAUDE.md`
 * (all + claude), `~/.codex/AGENTS.md` (all + codex), and links in
 * `~/.claude/skills` and `~/.agents/skills`. See `user-content-install.ts` for
 * the machine side.
 */

export const USER_CONTENT_SCOPES = ["all", "claude", "codex"] as const;
export type UserContentScope = (typeof USER_CONTENT_SCOPES)[number];

/** A total far above any realistic skill set, so a mistaken folder cannot flood the host link. */
const MAX_SKILL_BYTES = 16 * 1024 * 1024;

export interface UserSkillFile {
  scope: UserContentScope;
  skill: string;
  /** Path inside the skill folder, `/`-separated. */
  path: string;
  /** Permission bits, so scripts stay executable. */
  mode: number;
  /** File bytes, base64, so the content survives JSON. */
  content: string;
}

/** What a machine needs: each backend's instruction file and the skill files. */
export interface UserContent {
  instructions: { claude: string; codex: string };
  skills: UserSkillFile[];
}

export interface UserContentBundle {
  /** Identifies the content; a machine whose copy has this hash is up to date. */
  hash: string;
  content: UserContent;
}

/** The two store folders. */
export interface UserContentStore {
  instructions: string;
  skills: string;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Whether a store folder exists. Without either, nothing is delivered and no machine's files are touched. */
export async function userContentStoreExists(store: UserContentStore): Promise<boolean> {
  return (await isDirectory(store.instructions)) || (await isDirectory(store.skills));
}

/** Whether the store holds no instructions and no skills (a fresh install). */
export async function userContentStoreIsEmpty(store: UserContentStore): Promise<boolean> {
  const bundle = await readUserContentBundle(store);
  return !bundle.content.instructions.claude && !bundle.content.instructions.codex && !bundle.content.skills.length;
}

async function readOptionalText(path: string): Promise<string> {
  try {
    return (await readFile(path, "utf-8")).trim();
  } catch {
    return "";
  }
}

/**
 * Read the store: each backend's instructions (the shared file, then that
 * backend's own file) and every skill. Links are followed, so a store entry
 * may point at a skill kept elsewhere. Hidden files and folders are left out,
 * as are skill folders without a SKILL.md.
 */
export async function readUserContentBundle(store: UserContentStore): Promise<UserContentBundle> {
  const [all, claude, codex] = await Promise.all(
    USER_CONTENT_SCOPES.map((scope) => readOptionalText(join(store.instructions, `${scope}.md`))),
  );
  const both = (a: string, b: string) => [a, b].filter(Boolean).join("\n\n");
  const instructions = { claude: both(all, claude), codex: both(all, codex) };
  const skills: UserSkillFile[] = [];
  for (const scope of USER_CONTENT_SCOPES) {
    for (const skill of await listSkillFolders(join(store.skills, scope))) {
      skills.push(...(await readSkillFolder(join(store.skills, scope, skill), scope, skill)));
    }
  }
  checkSkillSize(skills, store.skills);
  const hash = createHash("sha256");
  hash.update(`claude\0${instructions.claude}\0codex\0${instructions.codex}\0`);
  for (const file of skills) hash.update(`${file.scope}/${file.skill}/${file.path}\0${file.mode}\0${file.content}\0`);
  return { hash: hash.digest("hex"), content: { instructions, skills } };
}

function checkSkillSize(skills: UserSkillFile[], where: string): void {
  const total = skills.reduce((sum, file) => sum + file.content.length, 0);
  if (total > MAX_SKILL_BYTES) throw new Error(`User skills in ${where} exceed ${MAX_SKILL_BYTES} bytes`);
}

/**
 * A cheap fingerprint of the store (names, sizes and modification times),
 * following links, so a change made through a link into a checkout is noticed
 * without reading every file.
 */
export async function userContentStoreSignature(store: UserContentStore): Promise<string | null> {
  if (!(await userContentStoreExists(store))) return null;
  const parts: string[] = [];
  const walk = async (dir: string, prefix: string, depth: number) => {
    if (depth > 12) return;
    for (const name of (await visibleNames(dir)).sort()) {
      const info = await stat(join(dir, name)).catch(() => null);
      if (!info) continue;
      parts.push(`${prefix}${name}:${info.isDirectory() ? "d" : `${info.size}:${info.mtimeMs}:${info.mode}`}`);
      if (info.isDirectory()) await walk(join(dir, name), `${prefix}${name}/`, depth + 1);
    }
  };
  await walk(store.instructions, "instructions/", 0);
  await walk(store.skills, "skills/", 0);
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export async function visibleNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

/** Folders (or links to folders) in `dir` that hold a SKILL.md file. */
async function listSkillFolders(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of (await visibleNames(dir)).sort()) {
    if ((await stat(join(dir, name, "SKILL.md")).catch(() => null))?.isFile()) found.push(name);
  }
  return found;
}

async function readSkillFolder(dir: string, scope: UserContentScope, skill: string): Promise<UserSkillFile[]> {
  const files: UserSkillFile[] = [];
  for (const path of await listFiles(dir, "")) {
    const full = join(dir, path);
    const [bytes, info] = await Promise.all([readFile(full), stat(full)]);
    files.push({ scope, skill, path, mode: info.mode & 0o777, content: bytes.toString("base64") });
  }
  return files;
}

async function listFiles(dir: string, prefix: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of (await visibleNames(dir)).sort()) {
    const info = await stat(join(dir, name)).catch(() => null);
    const path = prefix ? `${prefix}/${name}` : name;
    if (info?.isDirectory()) found.push(...(await listFiles(join(dir, name), path)));
    else if (info?.isFile()) found.push(path);
  }
  return found;
}

/** Where Claude Code and Codex read user-level content on a machine. */
export interface UserLevelPaths {
  claudeInstructions: string;
  codexInstructions: string;
  claudeSkills: string;
  agentsSkills: string;
}

export function userLevelPaths(home = homedir()): UserLevelPaths {
  return {
    claudeInstructions: join(home, ".claude", "CLAUDE.md"),
    codexInstructions: join(home, ".codex", "AGENTS.md"),
    claudeSkills: join(home, ".claude", "skills"),
    agentsSkills: join(home, ".agents", "skills"),
  };
}

export interface CollectedUserContent {
  instructions: { claude: string; codex: string };
  /** Skills found in each backend's skill folder; `all` when both hold the same content. */
  skills: UserSkillFile[];
  /** Entries left out, with the reason, for the import summary. */
  skipped: string[];
}

/**
 * Machine side of the one-time import: read this machine's user-level
 * instruction files and skills as Claude Code and Codex see them, following
 * links. Takode's own skills and links Takode created are left out.
 */
export async function collectUserLevelContent(
  takodeSkills: string[],
  ownPrefix: string,
  paths: UserLevelPaths = userLevelPaths(),
): Promise<CollectedUserContent> {
  const skipped: string[] = [];
  const instructions = {
    claude: await readOptionalText(paths.claudeInstructions),
    codex: await readOptionalText(paths.codexInstructions),
  };
  const takode = new Set(takodeSkills);
  const found = new Map<"claude" | "codex", Map<string, UserSkillFile[]>>();
  for (const [backend, dir] of [
    ["claude", paths.claudeSkills],
    ["codex", paths.agentsSkills],
  ] as const) {
    const skills = new Map<string, UserSkillFile[]>();
    for (const name of await listSkillFolders(dir)) {
      const entry = join(dir, name);
      const target = await readlink(entry).catch(() => null);
      if (takode.has(name)) skipped.push(`${entry} (a Takode skill)`);
      else if (target?.startsWith(ownPrefix)) skipped.push(`${entry} (already delivered by Takode)`);
      else skills.set(name, await readSkillFolder(entry, backend, name));
    }
    found.set(backend, skills);
  }
  const skills: UserSkillFile[] = [];
  const claudeSkills = found.get("claude") ?? new Map<string, UserSkillFile[]>();
  const codexSkills = found.get("codex") ?? new Map<string, UserSkillFile[]>();
  for (const [name, files] of claudeSkills) {
    const other = codexSkills.get(name);
    if (other && sameFiles(files, other)) {
      skills.push(...files.map((file) => ({ ...file, scope: "all" as const })));
      codexSkills.delete(name);
    } else {
      skills.push(...files);
    }
  }
  for (const files of codexSkills.values()) skills.push(...files);
  checkSkillSize(skills, "this machine's skill folders");
  return { instructions, skills, skipped };
}

/** A digest of a skill folder's files and their bytes (links followed), to tell identical copies apart. */
export async function skillFolderDigest(dir: string): Promise<string> {
  const hash = createHash("sha256");
  for (const path of await listFiles(dir, ""))
    hash
      .update(`${path}\0`)
      .update(await readFile(join(dir, path)))
      .update("\0");
  return hash.digest("hex");
}

/** How many sample lines `onlyHere` lists before summarizing the rest. */
const ONLY_HERE_SAMPLES = 8;

/**
 * What a machine's copy holds that the store's does not, so an agent or user
 * can tell whether replacing it (with a backup) loses anything: lines of text
 * only here, or for a skill folder, files only here and files that differ.
 */
export function linesOnlyHere(here: string, store: string): string[] {
  const storeLines = new Set(store.split("\n").map((line) => line.trim()));
  const unique = here
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !storeLines.has(line));
  return summarizeList(unique.map((line) => (line.length > 120 ? `${line.slice(0, 117)}...` : line)));
}

export async function skillFilesOnlyHere(here: string, store: string): Promise<string[]> {
  const [hereFiles, storeFiles] = await Promise.all([listFiles(here, ""), listFiles(store, "")]);
  const storeSet = new Set(storeFiles);
  const notes: string[] = [];
  for (const path of hereFiles) {
    if (!storeSet.has(path)) {
      notes.push(`file only here: ${path}`);
      continue;
    }
    const [a, b] = await Promise.all([readFile(join(here, path)), readFile(join(store, path))]);
    if (a.equals(b)) continue;
    const unique = linesOnlyHere(a.toString("utf-8"), b.toString("utf-8"));
    notes.push(`${path} differs${unique.length ? `; lines only here: ${unique.join(" | ")}` : ""}`);
  }
  return summarizeList(notes);
}

function summarizeList(items: string[]): string[] {
  if (items.length <= ONLY_HERE_SAMPLES) return items;
  return [...items.slice(0, ONLY_HERE_SAMPLES), `...and ${items.length - ONLY_HERE_SAMPLES} more`];
}

export interface UserLevelSummary {
  /** Characters in each backend's instruction file; 0 when there is none. */
  claudeChars: number;
  codexChars: number;
  /** Both backends read the same instruction text (one file, or one linking to the other). */
  sharedInstructions: boolean;
  /** Names of the user's own skills (Takode's skills and links excluded). */
  skills: string[];
}

/** What an import from this machine would bring in, without the file contents. */
export async function summarizeUserLevelContent(
  takodeSkills: string[],
  ownPrefix: string,
  paths: UserLevelPaths = userLevelPaths(),
): Promise<UserLevelSummary> {
  const { instructions, skills } = await collectUserLevelContent(takodeSkills, ownPrefix, paths);
  return {
    claudeChars: instructions.claude.length,
    codexChars: instructions.codex.length,
    sharedInstructions: !!instructions.claude && instructions.claude === instructions.codex,
    skills: [...new Set(skills.map((file) => file.skill))].sort(),
  };
}

function sameFiles(a: UserSkillFile[], b: UserSkillFile[]): boolean {
  const key = (files: UserSkillFile[]) => files.map((f) => `${f.path}\0${f.mode}\0${f.content}`).join("\n");
  return key(a) === key(b);
}

/**
 * Write collected content into an empty store: one shared file when both
 * backends read the same instructions, otherwise each backend's own file.
 */
export async function writeImportedUserContent(collected: CollectedUserContent, store: UserContentStore) {
  const { claude, codex } = collected.instructions;
  const files: Record<string, string> = {};
  if (claude && claude === codex) files.all = claude;
  else {
    if (claude) files.claude = claude;
    if (codex) files.codex = codex;
  }
  for (const scope of USER_CONTENT_SCOPES) await mkdir(join(store.skills, scope), { recursive: true });
  await mkdir(store.instructions, { recursive: true });
  for (const [scope, text] of Object.entries(files)) {
    await writeFile(join(store.instructions, `${scope}.md`), `${text}\n`);
  }
  for (const file of collected.skills) {
    const target = join(store.skills, file.scope, file.skill, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(file.content, "base64"));
    await chmod(target, file.mode);
  }
  return {
    instructionFiles: Object.keys(files).map((scope) => `${scope}.md`),
    skills: [...new Set(collected.skills.map((file) => `${file.scope}/${file.skill}`))],
  };
}
