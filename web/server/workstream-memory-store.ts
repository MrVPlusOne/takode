import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import type { Dirent } from "node:fs";
import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, relative, sep } from "node:path";
import { promisify } from "node:util";
import { getServerId } from "./settings-manager.js";
import {
  MEMORY_COMMIT_OPERATIONS,
  MEMORY_KINDS,
  MEMORY_LIFECYCLES,
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
  type MemoryLifecycle,
  type MemoryLintIssue,
  type MemoryLockAcquireInput,
  type MemoryLockInfo,
  type MemoryRecallMatch,
  type MemoryRecallQuery,
  type MemoryRecallResult,
  type MemoryRepoInfo,
  type MemoryRepoOptions,
} from "./workstream-memory-types.js";

const execFileAsync = promisify(execFile);
const LOCK_DIR_NAME = "takode-memory.lock";
const LOCK_INFO_FILE = "owner.json";
const DEFAULT_LOCK_TTL_MS = 10 * 60 * 1000;
const VALID_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/;

export async function ensureMemoryRepo(options: MemoryRepoOptions = {}): Promise<MemoryRepoInfo> {
  const repo = resolveMemoryRepo(options);
  await mkdir(repo.root, { recursive: true });
  for (const kind of MEMORY_KINDS) {
    await mkdir(join(repo.root, kind), { recursive: true });
  }
  const initialized = await pathExists(join(repo.root, ".git"));
  if (!initialized) {
    await runGit(repo.root, ["init"]);
  }
  return { ...repo, initialized: true, authoredDirs: [...MEMORY_KINDS] };
}

export function resolveMemoryRepo(options: MemoryRepoOptions = {}): MemoryRepoInfo {
  const serverId = (options.serverId ?? process.env.COMPANION_SERVER_ID ?? getServerId()).trim() || "local";
  const root =
    options.root?.trim() ||
    process.env.COMPANION_MEMORY_DIR?.trim() ||
    join(homedir(), ".companion", "memory", sanitizeServerIdForPath(serverId));
  return { root, serverId, initialized: false, authoredDirs: [...MEMORY_KINDS] };
}

export async function scanMemoryCatalog(options: MemoryRepoOptions = {}): Promise<MemoryCatalog> {
  const repo = await ensureMemoryRepo(options);
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

  const seenIds = new Map<string, string>();
  const canonicalOwners = new Map<string, string>();
  const entries: MemoryCatalogEntry[] = [];
  for (const file of files) {
    issues.push(...validateMemoryFile(file));
    const existingPath = seenIds.get(file.id);
    if (existingPath) {
      issues.push({
        severity: "error",
        id: file.id,
        path: file.path,
        message: `Duplicate memory id also used by ${existingPath}`,
      });
    } else {
      seenIds.set(file.id, file.path);
    }

    const entry = catalogEntryFromFile(file);
    for (const canonical of entry.canonicalFor) {
      const owner = canonicalOwners.get(canonical);
      if (owner) {
        issues.push({
          severity: "warning",
          id: file.id,
          path: file.path,
          message: `Canonical claim "${canonical}" is also claimed by ${owner}`,
        });
      } else {
        canonicalOwners.set(canonical, file.path);
      }
    }
    entries.push(entry);
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
    if (!query.includeArchived && entry.lifecycle === "archived") continue;
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
  const repo = await ensureMemoryRepo(options);
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
  const repo = await ensureMemoryRepo(options);
  return (await runGit(repo.root, ["status", "--short"])).trim();
}

export async function memoryGitDiff(options: MemoryRepoOptions = {}): Promise<string> {
  const repo = await ensureMemoryRepo(options);
  return runGit(repo.root, ["diff", "--", ...MEMORY_KINDS]);
}

export async function commitMemory(input: MemoryCommitInput): Promise<MemoryCommitResult> {
  const repo = await ensureMemoryRepo(input);
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
  const kind = parseKind(requiredString(frontmatter.kind, "kind"));
  const lifecycle = parseLifecycle(requiredString(frontmatter.lifecycle, "lifecycle"));
  return {
    id: requiredString(frontmatter.id, "id"),
    kind,
    title: requiredString(frontmatter.title, "title"),
    summary: stringList(frontmatter.summary),
    lifecycle,
    path: repoRelative(root, absolutePath),
    absolutePath,
    frontmatter,
    body,
    content,
  };
}

function catalogEntryFromFile(file: MemoryFile): MemoryCatalogEntry {
  return {
    id: file.id,
    kind: file.kind,
    title: file.title,
    summary: file.summary,
    lifecycle: file.lifecycle,
    path: file.path,
    facets: normalizeFacets(file.frontmatter.facets),
    canonicalFor: stringList(file.frontmatter.canonicalFor ?? file.frontmatter.canonical_for),
  };
}

function validateMemoryFile(file: MemoryFile): MemoryLintIssue[] {
  const issues: MemoryLintIssue[] = [];
  if (!VALID_ID.test(file.id)) {
    issues.push({ severity: "error", id: file.id, path: file.path, message: `Invalid memory id: ${file.id}` });
  }
  if (file.summary.length === 0) {
    issues.push({ severity: "error", id: file.id, path: file.path, message: "Memory summary is required" });
  }
  const topDir = file.path.split("/")[0];
  if (topDir !== file.kind) {
    issues.push({
      severity: "error",
      id: file.id,
      path: file.path,
      message: `Memory kind "${file.kind}" must match top-level directory "${topDir}"`,
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

function requiredString(value: FrontmatterValue | undefined, field: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(`Memory frontmatter field "${field}" is required`);
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

function parseLifecycle(value: string): MemoryLifecycle {
  if (MEMORY_LIFECYCLES.includes(value as MemoryLifecycle)) return value as MemoryLifecycle;
  throw new Error(`Invalid memory lifecycle "${value}". Expected one of: ${MEMORY_LIFECYCLES.join(", ")}`);
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
    { label: "title", text: entry.title, weight: 5 },
    { label: "path", text: entry.path, weight: 4 },
    { label: "summary", text: entry.summary.join(" "), weight: 3 },
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

function sanitizeServerIdForPath(serverId: string): string {
  return serverId.trim().replace(/[^a-zA-Z0-9_.-]/g, "_") || "local";
}

function repoRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
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
