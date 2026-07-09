const BASE = "/api";

async function get<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export type MemoryKind = "current" | "knowledge" | "procedures" | "decisions" | "references" | "artifacts";

export interface MemoryRepoInfo {
  root: string;
  serverId: string;
  serverSlug: string;
  sessionSpaceSlug: string;
  initialized: boolean;
  authoredDirs: MemoryKind[];
}

export interface MemorySpaceInfo {
  slug: string;
  root: string;
  current: boolean;
  initialized: boolean;
  authoredDirs: MemoryKind[];
  hasAuthoredData: boolean;
  sessionSpaceSlug?: string;
  serverId?: string;
  updatedAt?: string;
}

export interface MemoryCatalogEntry {
  id: string;
  kind: MemoryKind;
  description: string;
  path: string;
  source: string[];
  facets: Record<string, string[]>;
}

export interface MemoryLintIssue {
  severity: "error" | "warning";
  path?: string;
  id?: string;
  message: string;
}

export interface MemoryLockInfo {
  locked: boolean;
  lockPath: string;
  owner?: string;
  session?: string;
  acquiredAt?: string;
  expiresAt?: string;
  stale?: boolean;
}

export interface MemoryGitStatusEntry {
  code: string;
  path: string;
  raw: string;
}

export interface MemoryCommitFileChange {
  status: string;
  path: string;
  previousPath?: string;
}

export interface MemoryRecentCommit {
  sha: string;
  shortSha: string;
  timestamp: number;
  message: string;
  authorName: string;
  authorEmail: string;
  actor: string | null;
  quest: string | null;
  session: string | null;
  sources: string[];
  changedFiles: MemoryCommitFileChange[];
}

export interface MemoryUpdateDiffSourceFile {
  status: string;
  path: string;
  previousPath?: string;
  oldText: string;
  newText: string;
}

export interface MemoryCatalogResponse {
  repo: MemoryRepoInfo;
  entries: MemoryCatalogEntry[];
  issues: MemoryLintIssue[];
  issueCounts: { errors: number; warnings: number };
  lock: MemoryLockInfo;
  git: {
    dirty: boolean;
    status: string;
    statusEntries: MemoryGitStatusEntry[];
    recentCommits: MemoryRecentCommit[];
  };
}

export interface MemorySpacesResponse {
  currentServerId: string;
  currentServerSlug: string;
  currentSessionSpaceSlug: string;
  spaces: MemorySpaceInfo[];
}

export interface MemoryFile {
  id: string;
  kind: MemoryKind;
  description: string;
  source: string[];
  path: string;
  absolutePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  content: string;
}

export interface MemoryRecordResponse {
  repo: MemoryRepoInfo;
  file: MemoryFile;
  issues: MemoryLintIssue[];
}

export interface MemoryUpdateDiffResponse {
  repo: MemoryRepoInfo;
  commit: MemoryRecentCommit;
  diff: string;
  sourceFiles: MemoryUpdateDiffSourceFile[];
}

export function listMemorySpaces(): Promise<MemorySpacesResponse> {
  return get<MemorySpacesResponse>("/memory/spaces");
}

export function getMemoryCatalog(opts?: {
  serverSlug?: string;
  root?: string;
  recentLimit?: number;
}): Promise<MemoryCatalogResponse> {
  const params = new URLSearchParams();
  if (opts?.serverSlug) params.set("serverSlug", opts.serverSlug);
  if (opts?.root) params.set("root", opts.root);
  if (opts?.recentLimit) params.set("recentLimit", String(opts.recentLimit));
  const qs = params.toString();
  return get<MemoryCatalogResponse>(`/memory/catalog${qs ? `?${qs}` : ""}`);
}

export function getMemoryRecord(opts: {
  serverSlug?: string;
  root?: string;
  path: string;
}): Promise<MemoryRecordResponse> {
  const params = new URLSearchParams({ path: opts.path });
  if (opts.serverSlug) params.set("serverSlug", opts.serverSlug);
  if (opts.root) params.set("root", opts.root);
  return get<MemoryRecordResponse>(`/memory/records?${params.toString()}`);
}

export function getMemoryUpdateDiff(opts: {
  serverSlug?: string;
  root?: string;
  sha: string;
}): Promise<MemoryUpdateDiffResponse> {
  const params = new URLSearchParams();
  if (opts.serverSlug) params.set("serverSlug", opts.serverSlug);
  if (opts.root) params.set("root", opts.root);
  const qs = params.toString();
  return get<MemoryUpdateDiffResponse>(`/memory/updates/${encodeURIComponent(opts.sha)}${qs ? `?${qs}` : ""}`);
}
