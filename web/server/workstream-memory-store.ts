import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { getServerId, getServerSlug, normalizeServerSlug } from "./settings-manager.js";
import {
  MEMORY_COMMIT_OPERATIONS,
  MEMORY_KINDS,
  type FrontmatterScalar,
  type FrontmatterValue,
  type MemoryCatalog,
  type MemoryCatalogEntry,
  type MemoryCommitInput,
  type MemoryCommitOperation,
  type MemoryCommitResult,
  type MemoryFile,
  type MemoryFrontmatter,
  type MemoryKind,
  type MemoryLintIssue,
  type MemoryLockAcquireInput,
  type MemoryLockInfo,
  type MemoryRecentCommit,
  type MemoryRecallMatch,
  type MemoryRecallQuery,
  type MemoryRecallResult,
  type MemoryRepoInfo,
  type MemoryRepoOptions,
  type MemorySpaceInfo,
} from "./workstream-memory-types.js";

const execFileAsync = promisify(execFile);
const LOCK_DIR_NAME = "takode-memory.lock";
const LOCK_INFO_FILE = "owner.json";
const SERVER_INDEX_DIR = ".servers";
const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const OBSOLETE_FRONTMATTER_FIELDS = new Set([
  "id",
  "kind",
  "title",
  "summary",
  "lifecycle",
  "canonicalFor",
  "canonical_for",
]);

interface ResolvedMemoryRepo extends MemoryRepoInfo {
  baseRoot: string;
  explicitRoot: boolean;
}

interface ServerMemoryIndexEntry {
  serverId: string;
  serverSlug: string;
  root: string;
  updatedAt: string;
}

export async function ensureMemoryRepo(options: MemoryRepoOptions = {}): Promise<MemoryRepoInfo> {
  const repo = resolveMemoryRepoInternal(options);
  if (!repo.explicitRoot) {
    await migrateDefaultMemoryRepo(repo);
  }
  await mkdir(repo.root, { recursive: true });
  for (const kind of MEMORY_KINDS) {
    await mkdir(join(repo.root, kind), { recursive: true });
  }
  const initialized = await pathExists(join(repo.root, ".git"));
  if (!initialized) {
    await runGit(repo.root, ["init"]);
  }
  if (!repo.explicitRoot) {
    await writeServerMemoryIndex(repo);
  }
  return publicRepoInfo({ ...repo, initialized: true, authoredDirs: [...MEMORY_KINDS] });
}

export function resolveMemoryRepo(options: MemoryRepoOptions = {}): MemoryRepoInfo {
  return publicRepoInfo(resolveMemoryRepoInternal(options));
}

export async function resolveMemoryOptionsForSpace(serverSlug: string | undefined): Promise<MemoryRepoOptions> {
  const normalizedSlug = normalizeServerSlug(serverSlug ?? "");
  if (!normalizedSlug) return {};

  const current = resolveMemoryRepoInternal();
  if (normalizedSlug === current.serverSlug) {
    return { serverSlug: normalizedSlug };
  }

  const spaces = await listMemorySpaces();
  const sibling = spaces.find((space) => !space.current && normalizeServerSlug(space.slug) === normalizedSlug);
  if (!sibling) {
    return { serverSlug: normalizedSlug };
  }

  return {
    root: sibling.root,
    serverSlug: sibling.slug,
    readOnly: true,
    ...(sibling.serverId ? { serverId: sibling.serverId } : {}),
  };
}

function resolveMemoryRepoInternal(options: MemoryRepoOptions = {}): ResolvedMemoryRepo {
  const serverId = (options.serverId ?? process.env.COMPANION_SERVER_ID ?? getServerId()).trim() || "local";
  const serverSlug =
    normalizeServerSlug(options.serverSlug ?? process.env.COMPANION_SERVER_SLUG ?? getServerSlug()) || "local";
  const explicitRoot = !!(options.root?.trim() || process.env.COMPANION_MEMORY_DIR?.trim());
  const baseRoot = join(process.env.HOME || homedir(), ".companion", "memory");
  const root =
    options.root?.trim() || process.env.COMPANION_MEMORY_DIR?.trim() || join(baseRoot, sanitizeSlugForPath(serverSlug));
  return { root, serverId, serverSlug, baseRoot, explicitRoot, initialized: false, authoredDirs: [...MEMORY_KINDS] };
}

function publicRepoInfo(repo: ResolvedMemoryRepo): MemoryRepoInfo {
  return {
    root: repo.root,
    serverId: repo.serverId,
    serverSlug: repo.serverSlug,
    initialized: repo.initialized,
    authoredDirs: repo.authoredDirs,
  };
}

export async function scanMemoryCatalog(options: MemoryRepoOptions = {}): Promise<MemoryCatalog> {
  const repo = await repoForRead(options);
  const files: MemoryFile[] = [];
  const issues: MemoryLintIssue[] = [];

  for (const kind of MEMORY_KINDS) {
    const dir = join(repo.root, kind);
    for (const absolutePath of await listMarkdownFiles(dir)) {
      const path = repoRelative(repo.root, absolutePath);
      try {
        const parsed = parseMemoryFile(repo.root, absolutePath, await readFile(absolutePath, "utf-8"));
        files.push(parsed);
      } catch (error) {
        issues.push({ severity: "error", path, message: errorMessage(error) });
      }
    }
  }

  const entries: MemoryCatalogEntry[] = [];
  for (const file of files) {
    issues.push(...validateMemoryFile(file));
    entries.push(catalogEntryFromFile(file));
  }

  return {
    repo,
    entries: entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path)),
    issues,
  };
}

export async function lintMemory(options: MemoryRepoOptions = {}): Promise<MemoryCatalog> {
  return scanMemoryCatalog(options);
}

export async function listMemorySpaces(options: MemoryRepoOptions = {}): Promise<MemorySpaceInfo[]> {
  const currentRepo = await ensureMemoryRepo(options);
  const resolved = resolveMemoryRepoInternal(options);
  const serverIndex = await readServerMemoryIndexes(resolved.baseRoot);
  const spaces = new Map<string, MemorySpaceInfo>();

  const addSpace = async (input: {
    slug: string;
    root: string;
    current: boolean;
    serverId?: string;
    index?: ServerMemoryIndexEntry;
  }) => {
    const authoredDirs = await existingAuthoredDirs(input.root);
    spaces.set(resolve(input.root), {
      slug: input.slug,
      root: input.root,
      current: input.current,
      initialized: await pathExists(join(input.root, ".git")),
      authoredDirs: authoredDirs.length ? authoredDirs : [...MEMORY_KINDS],
      hasAuthoredData: await hasAuthoredMemoryData(input.root),
      ...(input.index?.serverId || input.serverId ? { serverId: input.index?.serverId ?? input.serverId } : {}),
      ...(input.index?.updatedAt ? { updatedAt: input.index.updatedAt } : {}),
    });
  };

  const currentIndex = serverIndex.find((entry) => resolve(entry.root) === resolve(currentRepo.root));
  await addSpace({
    slug: currentRepo.serverSlug,
    root: currentRepo.root,
    current: true,
    serverId: currentRepo.serverId,
    index: currentIndex,
  });

  for (const entry of await safeReaddir(resolved.baseRoot)) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const root = join(resolved.baseRoot, entry.name);
    if (spaces.has(resolve(root)) || !(await looksLikeMemorySpace(root))) continue;
    const index = serverIndex.find((item) => resolve(item.root) === resolve(root) || item.serverSlug === entry.name);
    await addSpace({ slug: index?.serverSlug || entry.name, root, current: false, index });
  }

  return [...spaces.values()].sort((a, b) => Number(b.current) - Number(a.current) || a.slug.localeCompare(b.slug));
}

export async function recallMemory(
  query: MemoryRecallQuery = {},
  options: MemoryRepoOptions = {},
): Promise<MemoryRecallResult> {
  const catalog = await scanMemoryCatalog(options);
  const terms = tokenize(query.query ?? "");
  const kindSet = query.kinds?.length ? new Set(query.kinds) : undefined;
  const limit = query.limit && query.limit > 0 ? query.limit : 20;
  const matches: MemoryRecallMatch[] = [];

  for (const entry of catalog.entries) {
    if (kindSet && !kindSet.has(entry.kind)) continue;
    if (!matchesFacets(entry, query.facets)) continue;
    const file =
      query.includeContent || terms.length ? await readEntryContent(catalog.repo.root, entry.path) : undefined;
    const scored = scoreEntry(entry, terms, file?.content);
    if (terms.length && scored.score === 0) continue;
    matches.push({
      entry,
      score: scored.score,
      reasons: scored.reasons,
      ...(query.includeContent && file ? { content: file.content } : {}),
    });
  }

  matches.sort(
    (a, b) => b.score - a.score || a.entry.kind.localeCompare(b.entry.kind) || a.entry.path.localeCompare(b.entry.path),
  );
  return { repo: catalog.repo, matches: matches.slice(0, limit), issues: catalog.issues };
}

export async function getMemoryLock(options: MemoryRepoOptions = {}): Promise<MemoryLockInfo> {
  const repo = await repoForRead(options);
  return readLockInfo(repo.root);
}

export async function acquireMemoryLock(input: MemoryLockAcquireInput = {}): Promise<MemoryLockInfo> {
  const repo = await ensureMemoryRepo(input);
  const lockPath = memoryLockPath(repo.root);
  const now = Date.now();
  const expiresAt = new Date(now + (input.ttlMs ?? DEFAULT_LOCK_TTL_MS)).toISOString();
  const lockInfo = {
    owner: input.owner?.trim() || "takode-memory",
    session: input.session?.trim() || process.env.COMPANION_SESSION_ID || process.env.COMPANION_SESSION_NUM,
    acquiredAt: new Date(now).toISOString(),
    expiresAt,
    token: randomUUID(),
  };

  try {
    await mkdir(lockPath);
  } catch (error) {
    const existing = await readLockInfo(repo.root);
    if (existing.stale && input.stealStale !== false) {
      await rm(lockPath, { recursive: true, force: true });
      await mkdir(lockPath);
    } else {
      throw new Error(formatLockConflict(existing));
    }
  }

  await writeFile(join(lockPath, LOCK_INFO_FILE), JSON.stringify(lockInfo, null, 2), "utf-8");
  return readLockInfo(repo.root);
}

export async function releaseMemoryLock(options: MemoryRepoOptions = {}): Promise<MemoryLockInfo> {
  const repo = await ensureMemoryRepo(options);
  const lockPath = memoryLockPath(repo.root);
  await rm(lockPath, { recursive: true, force: true });
  return readLockInfo(repo.root);
}

export async function memoryGitStatus(options: MemoryRepoOptions = {}): Promise<string> {
  const repo = await repoForRead(options);
  if (options.readOnly && !repo.initialized) return "";
  return (await runGit(repo.root, ["status", "--short", "--untracked-files=all"])).trim();
}

export async function memoryRecentCommits(options: MemoryRepoOptions = {}, limit = 6): Promise<MemoryRecentCommit[]> {
  const repo = await repoForRead(options);
  if (options.readOnly && !repo.initialized) return [];
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 25);
  try {
    const output = await runGit(repo.root, [
      "log",
      `--max-count=${safeLimit}`,
      "--format=%H%x1f%h%x1f%ct%x1f%s",
      "--",
      ...MEMORY_KINDS,
    ]);
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha = "", shortSha = "", timestamp = "0", message = ""] = line.split("\x1f");
        return {
          sha,
          shortSha,
          timestamp: Number.parseInt(timestamp, 10) * 1000,
          message,
        };
      })
      .filter((commit) => commit.sha && commit.shortSha && Number.isFinite(commit.timestamp));
  } catch {
    return [];
  }
}

export async function memoryGitDiff(options: MemoryRepoOptions = {}): Promise<string> {
  const repo = await ensureMemoryRepo(options);
  return runGit(repo.root, ["diff", "--", ...MEMORY_KINDS]);
}

export async function commitMemory(input: MemoryCommitInput): Promise<MemoryCommitResult> {
  const repo = await ensureMemoryRepo(input);
  validateMemoryCommitInput(input);
  await assertActiveMemoryLock(repo.root);
  const catalog = await lintMemory(input);
  const errors = catalog.issues.filter((issue) => issue.severity === "error");
  if (errors.length) {
    throw new Error(`Memory lint failed: ${errors.map((issue) => issue.message).join("; ")}`);
  }

  await runGit(repo.root, ["add", "--", ...MEMORY_KINDS]);
  const status = await memoryGitStatus(input);
  if (!status) {
    return { committed: false, message: "No memory changes to commit", status };
  }

  const message = buildCommitMessage(input);
  await runGit(repo.root, [
    "-c",
    "user.name=Takode Memory",
    "-c",
    "user.email=takode-memory@local",
    "commit",
    "-m",
    message,
  ]);
  const sha = (await runGit(repo.root, ["rev-parse", "--short", "HEAD"])).trim();
  return { committed: true, sha, message, status };
}

export function parseMemoryFile(root: string, absolutePath: string, content: string): MemoryFile {
  const { frontmatter, body } = parseFrontmatter(content);
  const path = repoRelative(root, absolutePath);
  const kind = parseKindFromPath(path);
  return {
    id: path,
    kind,
    description: optionalString(frontmatter.description),
    source: stringList(frontmatter.source),
    path,
    absolutePath,
    frontmatter,
    body,
    content,
  };
}

export async function readMemoryRecord(
  path: string,
  options: MemoryRepoOptions = {},
): Promise<{ repo: MemoryRepoInfo; file: MemoryFile }> {
  const repo = await repoForRead(options);
  const resolvedRecord = await resolveMemoryRecordPath(repo.root, path);
  const content = await readFile(resolvedRecord.absolutePath, "utf-8");
  return { repo, file: parseMemoryFile(resolvedRecord.root, resolvedRecord.absolutePath, content) };
}

async function repoForRead(options: MemoryRepoOptions): Promise<MemoryRepoInfo> {
  if (options.readOnly) {
    return inspectExistingMemoryRepo(options);
  }
  return ensureMemoryRepo(options);
}

async function inspectExistingMemoryRepo(options: MemoryRepoOptions): Promise<MemoryRepoInfo> {
  const repo = resolveMemoryRepoInternal(options);
  const authoredDirs = await existingAuthoredDirs(repo.root);
  return publicRepoInfo({
    ...repo,
    initialized: await pathExists(join(repo.root, ".git")),
    authoredDirs: authoredDirs.length ? authoredDirs : [...MEMORY_KINDS],
  });
}

function catalogEntryFromFile(file: MemoryFile): MemoryCatalogEntry {
  return {
    id: file.id,
    kind: file.kind,
    description: file.description,
    path: file.path,
    source: file.source,
    facets: normalizeFacets(file.frontmatter.facets),
  };
}

function validateMemoryFile(file: MemoryFile): MemoryLintIssue[] {
  const issues: MemoryLintIssue[] = [];
  for (const field of OBSOLETE_FRONTMATTER_FIELDS) {
    if (file.frontmatter[field] !== undefined) {
      issues.push({
        severity: "warning",
        id: file.id,
        path: file.path,
        message: `Obsolete memory frontmatter field "${field}" is ignored; derive it from path or use description/source.`,
      });
    }
  }
  if (file.description.length === 0) {
    issues.push({ severity: "error", id: file.id, path: file.path, message: "Memory description is required" });
  }
  if (typeof file.frontmatter.source === "string") {
    issues.push({
      severity: "error",
      id: file.id,
      path: file.path,
      message: "Memory source must be a YAML list of contributing quest or session refs",
    });
  }
  if (file.source.length === 0) {
    issues.push({
      severity: "error",
      id: file.id,
      path: file.path,
      message: "Memory source must list at least one contributing quest or session ref",
    });
  }
  if (!basename(file.path).endsWith(".md")) {
    issues.push({ severity: "error", id: file.id, path: file.path, message: "Memory files must use .md extension" });
  }
  return issues;
}

function parseFrontmatter(content: string): { frontmatter: MemoryFrontmatter; body: string } {
  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") throw new Error("Memory files must start with YAML frontmatter");
  const end = lines.findIndex((line, index) => index > 0 && line === "---");
  if (end < 0) throw new Error("Memory frontmatter is missing closing ---");
  return {
    frontmatter: parseYamlSubset(lines.slice(1, end)),
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
  };
}

function parseYamlSubset(lines: string[]): MemoryFrontmatter {
  const result: MemoryFrontmatter = {};
  let currentKey: string | undefined;
  let currentNestedKey: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const listMatch = /^  -\s+(.+)$/.exec(line);
    if (listMatch && currentKey) {
      appendTopLevelListValue(result, currentKey, parseScalar(listMatch[1]));
      continue;
    }

    const nestedListMatch = /^    -\s+(.+)$/.exec(line);
    if (nestedListMatch && currentKey && currentNestedKey) {
      appendNestedListValue(result, currentKey, currentNestedKey, parseScalar(nestedListMatch[1]));
      continue;
    }

    const nestedMatch = /^  ([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nestedMatch && currentKey) {
      currentNestedKey = nestedMatch[1];
      setNestedValue(result, currentKey, currentNestedKey, parseYamlValue(nestedMatch[2]));
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Unsupported frontmatter line: ${line}`);
    currentKey = match[1];
    currentNestedKey = undefined;
    result[currentKey] = parseYamlValue(match[2]);
  }

  return result;
}

function parseYamlValue(raw: string): FrontmatterValue {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item))
      .filter(Boolean);
  }
  return parseScalar(trimmed);
}

function parseScalar(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function appendTopLevelListValue(result: MemoryFrontmatter, key: string, value: string): void {
  const existing = result[key];
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  if (existing === undefined) {
    result[key] = [value];
    return;
  }
  result[key] = [String(existing), value];
}

function appendNestedListValue(result: MemoryFrontmatter, key: string, nestedKey: string, value: string): void {
  const parent = objectValue(result[key]);
  const existing = parent[nestedKey];
  parent[nestedKey] = Array.isArray(existing) ? [...existing, value] : existing ? [String(existing), value] : [value];
  result[key] = parent;
}

function setNestedValue(result: MemoryFrontmatter, key: string, nestedKey: string, value: FrontmatterValue): void {
  const parent = objectValue(result[key]);
  parent[nestedKey] = Array.isArray(value) || typeof value === "string" ? value : [];
  result[key] = parent;
}

function objectValue(value: FrontmatterValue | undefined): Record<string, FrontmatterScalar> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function optionalString(value: FrontmatterValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: FrontmatterValue | undefined): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  return [];
}

function normalizeFacets(value: FrontmatterValue | undefined): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const facets: Record<string, string[]> = {};
  for (const [key, raw] of Object.entries(value)) {
    const values = Array.isArray(raw) ? raw : [raw];
    facets[key] = values.map((item) => String(item).trim()).filter(Boolean);
  }
  return facets;
}

function parseKind(value: string): MemoryKind {
  if (MEMORY_KINDS.includes(value as MemoryKind)) return value as MemoryKind;
  throw new Error(`Invalid memory kind "${value}". Expected one of: ${MEMORY_KINDS.join(", ")}`);
}

function parseKindFromPath(path: string): MemoryKind {
  const [topDir] = path.split("/");
  if (topDir) return parseKind(topDir);
  throw new Error(`Memory file path "${path}" must be under one of: ${MEMORY_KINDS.join(", ")}`);
}

function parseOperation(value: string | undefined): MemoryCommitOperation | undefined {
  if (!value) return undefined;
  if (MEMORY_COMMIT_OPERATIONS.includes(value as MemoryCommitOperation)) return value as MemoryCommitOperation;
  throw new Error(`Invalid memory operation "${value}". Expected one of: ${MEMORY_COMMIT_OPERATIONS.join(", ")}`);
}

function matchesFacets(entry: MemoryCatalogEntry, facets: Record<string, string[]> | undefined): boolean {
  if (!facets) return true;
  for (const [key, wanted] of Object.entries(facets)) {
    const values = entry.facets[key] ?? [];
    if (!wanted.every((item) => values.includes(item))) return false;
  }
  return true;
}

function scoreEntry(entry: MemoryCatalogEntry, terms: string[], content = ""): { score: number; reasons: string[] } {
  if (terms.length === 0) return { score: 1, reasons: ["catalog"] };
  const haystacks = [
    { label: "id", text: entry.id, weight: 6 },
    { label: "path", text: entry.path, weight: 4 },
    { label: "description", text: entry.description, weight: 3 },
    { label: "source", text: entry.source.join(" "), weight: 2 },
    { label: "content", text: content, weight: 1 },
  ];
  let score = 0;
  const reasons = new Set<string>();
  for (const term of terms) {
    for (const haystack of haystacks) {
      if (haystack.text.toLowerCase().includes(term)) {
        score += haystack.weight;
        reasons.add(haystack.label);
      }
    }
  }
  return { score, reasons: [...reasons] };
}

async function readEntryContent(root: string, path: string): Promise<{ content: string } | undefined> {
  try {
    return { content: await readFile(join(root, path), "utf-8") };
  } catch {
    return undefined;
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await safeReaddir(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith(".")) files.push(...(await listMarkdownFiles(path)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}

async function safeReaddir(dir: string): Promise<Dirent<string>[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function readLockInfo(root: string): Promise<MemoryLockInfo> {
  const lockPath = memoryLockPath(root);
  try {
    const raw = JSON.parse(await readFile(join(lockPath, LOCK_INFO_FILE), "utf-8")) as {
      owner?: string;
      session?: string;
      acquiredAt?: string;
      expiresAt?: string;
    };
    const expiresAt = raw.expiresAt;
    return {
      locked: true,
      lockPath,
      owner: raw.owner,
      session: raw.session,
      acquiredAt: raw.acquiredAt,
      expiresAt,
      stale: expiresAt ? Date.parse(expiresAt) <= Date.now() : false,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { locked: false, lockPath };
    throw error;
  }
}

function formatLockConflict(info: MemoryLockInfo): string {
  if (!info.locked) return "Memory repo is locked";
  const owner = info.owner ? ` by ${info.owner}` : "";
  const session = info.session ? ` (${info.session})` : "";
  const expires = info.expiresAt ? ` until ${info.expiresAt}` : "";
  return `Memory repo is already locked${owner}${session}${expires}`;
}

function buildCommitMessage(input: MemoryCommitInput): string {
  if (!input.message.trim()) throw new Error("Memory commit message is required");
  const lines = [input.message.trim(), ""];
  const operation = parseOperation(input.operation);
  if (operation) lines.push(`Memory-Operation: ${operation}`);
  for (const id of input.memoryIds ?? []) lines.push(`Memory-Id: ${id}`);
  if (input.quest?.trim()) lines.push(`Quest: ${input.quest.trim()}`);
  if (input.session?.trim()) lines.push(`Session: ${input.session.trim()}`);
  for (const source of input.sources ?? []) lines.push(`Source: ${source}`);
  return lines.join("\n");
}

async function assertActiveMemoryLock(root: string): Promise<void> {
  const lock = await readLockInfo(root);
  if (!lock.locked) {
    throw new Error("Acquire the memory repo lock before committing memory changes.");
  }
  if (lock.stale) {
    throw new Error("Memory repo lock is stale; acquire a fresh lock before committing memory changes.");
  }
}

function validateMemoryCommitInput(input: MemoryCommitInput): void {
  if (!input.message.trim()) throw new Error("Memory commit message is required");
  const sources = (input.sources ?? []).map((source) => source.trim()).filter(Boolean);
  if (sources.length === 0) {
    throw new Error("Memory commits require at least one source trailer.");
  }
  const hasTraceability = Boolean(
    input.quest?.trim() || input.session?.trim() || input.memoryIds?.some((id) => id.trim()),
  );
  if (!hasTraceability) {
    throw new Error("Memory commits require traceability: include quest, session, or at least one memory id.");
  }
}

async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-optional-locks", "-C", root, ...args], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return String(stdout);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function migrateDefaultMemoryRepo(repo: ResolvedMemoryRepo): Promise<void> {
  const candidates = await getMigrationCandidates(repo);
  if (!candidates.length) return;

  const source = await firstExistingMemoryRepo(candidates, repo.root);
  if (!source) return;

  const targetExists = await pathExists(repo.root);
  if (targetExists && !(await isEmptyMemoryRepo(repo.root))) {
    throw new Error(formatMemoryRepoSlugConflict(repo, source));
  }

  await mkdir(repo.baseRoot, { recursive: true });
  if (targetExists) {
    await rm(repo.root, { recursive: true, force: true });
  }
  await rename(source, repo.root);
}

async function getMigrationCandidates(repo: ResolvedMemoryRepo): Promise<string[]> {
  const candidates: string[] = [];
  const index = await readServerMemoryIndex(repo.baseRoot, repo.serverId);
  if (index?.root) candidates.push(index.root);
  if (index?.serverSlug) candidates.push(join(repo.baseRoot, sanitizeSlugForPath(index.serverSlug)));
  candidates.push(join(repo.baseRoot, sanitizeSlugForPath(repo.serverId)));

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate || candidate === repo.root || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

async function firstExistingMemoryRepo(candidates: string[], targetRoot: string): Promise<string | null> {
  for (const candidate of candidates) {
    if (candidate === targetRoot || !(await pathExists(candidate))) continue;
    return candidate;
  }
  return null;
}

function formatMemoryRepoSlugConflict(repo: ResolvedMemoryRepo, sourceRoot: string): string {
  return [
    `Memory repo slug "${repo.serverSlug}" already exists at ${repo.root} and contains authored data.`,
    `Existing memory for this server id is still at ${sourceRoot}.`,
    "Rename the server slug or merge the memory repos manually before using this slug.",
  ].join(" ");
}

async function readServerMemoryIndex(baseRoot: string, serverId: string): Promise<ServerMemoryIndexEntry | null> {
  try {
    const raw = await readFile(serverIndexPath(baseRoot, serverId), "utf-8");
    const parsed = JSON.parse(raw) as Partial<ServerMemoryIndexEntry>;
    if (typeof parsed.serverId !== "string" || parsed.serverId !== serverId) return null;
    return {
      serverId,
      serverSlug: typeof parsed.serverSlug === "string" ? parsed.serverSlug : "",
      root: typeof parsed.root === "string" ? parsed.root : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
    };
  } catch {
    return null;
  }
}

async function readServerMemoryIndexes(baseRoot: string): Promise<ServerMemoryIndexEntry[]> {
  const dir = join(baseRoot, SERVER_INDEX_DIR);
  const entries = await safeReaddir(dir);
  const indexes: ServerMemoryIndexEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(dir, entry.name), "utf-8");
      const parsed = JSON.parse(raw) as Partial<ServerMemoryIndexEntry>;
      if (
        typeof parsed.serverId === "string" &&
        typeof parsed.serverSlug === "string" &&
        typeof parsed.root === "string"
      ) {
        indexes.push({
          serverId: parsed.serverId,
          serverSlug: parsed.serverSlug,
          root: parsed.root,
          updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
        });
      }
    } catch {
      console.warn(`Skipping unreadable memory server index: ${join(dir, entry.name)}`);
      continue;
    }
  }
  return indexes;
}

async function writeServerMemoryIndex(repo: ResolvedMemoryRepo): Promise<void> {
  const path = serverIndexPath(repo.baseRoot, repo.serverId);
  await mkdir(join(repo.baseRoot, SERVER_INDEX_DIR), { recursive: true });
  const entry: ServerMemoryIndexEntry = {
    serverId: repo.serverId,
    serverSlug: repo.serverSlug,
    root: repo.root,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path, JSON.stringify(entry, null, 2), "utf-8");
}

function serverIndexPath(baseRoot: string, serverId: string): string {
  return join(baseRoot, SERVER_INDEX_DIR, `${sanitizeSlugForPath(serverId)}.json`);
}

async function isEmptyMemoryRepo(path: string): Promise<boolean> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    const allowedEmptyDirs = new Set([".git", ...MEMORY_KINDS]);
    for (const entry of entries) {
      if (entry.isDirectory() && allowedEmptyDirs.has(entry.name)) continue;
      return false;
    }
    for (const kind of MEMORY_KINDS) {
      const kindPath = join(path, kind);
      if ((await pathExists(kindPath)) && (await listMarkdownFiles(kindPath)).length > 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

async function looksLikeMemorySpace(root: string): Promise<boolean> {
  if (await pathExists(join(root, ".git"))) return true;
  return (await existingAuthoredDirs(root)).length > 0;
}

async function existingAuthoredDirs(root: string): Promise<MemoryKind[]> {
  const dirs: MemoryKind[] = [];
  for (const kind of MEMORY_KINDS) {
    try {
      const info = await stat(join(root, kind));
      if (info.isDirectory()) dirs.push(kind);
    } catch {
      continue;
    }
  }
  return dirs;
}

async function hasAuthoredMemoryData(root: string): Promise<boolean> {
  for (const kind of MEMORY_KINDS) {
    if ((await listMarkdownFiles(join(root, kind))).length > 0) return true;
  }
  return false;
}

function sanitizeSlugForPath(slug: string): string {
  return slug.trim().replace(/[^a-zA-Z0-9_.-]/g, "_") || "local";
}

function repoRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function resolveMemoryRecordPath(
  root: string,
  requestedPath: string,
): Promise<{ root: string; absolutePath: string }> {
  const trimmedPath = requestedPath.trim();
  if (!trimmedPath) throw new Error("Memory record path is required");
  if (isAbsolute(trimmedPath)) throw new Error("Memory record path must be repo-relative");

  const rootPath = resolve(root);
  const syntacticPath = resolve(rootPath, trimmedPath);
  const syntacticRelativePath = repoRelative(rootPath, syntacticPath);
  if (!isPathInside(rootPath, syntacticPath)) {
    throw new Error("Memory record path must stay inside the memory repo");
  }
  const [kind] = syntacticRelativePath.split("/");
  if (!MEMORY_KINDS.includes(kind as MemoryKind)) {
    throw new Error(`Memory record path must be under one of: ${MEMORY_KINDS.join(", ")}`);
  }
  if (!syntacticRelativePath.endsWith(".md")) {
    throw new Error("Memory record path must point to a Markdown file");
  }

  const realRoot = await realpath(rootPath);
  const realAuthoredDir = await realpath(join(rootPath, kind));
  if (!isPathInside(realRoot, realAuthoredDir)) {
    throw new Error("Memory authored directory must stay inside the memory repo");
  }

  const realTarget = await realpath(syntacticPath);
  if (!isPathInside(realRoot, realTarget) || !isPathInside(realAuthoredDir, realTarget)) {
    throw new Error("Memory record path must stay inside the memory repo");
  }
  if (!repoRelative(realRoot, realTarget).endsWith(".md")) {
    throw new Error("Memory record path must point to a Markdown file");
  }
  return { root: realRoot, absolutePath: realTarget };
}

function isPathInside(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function memoryLockPath(root: string): string {
  return join(root, ".git", LOCK_DIR_NAME);
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
