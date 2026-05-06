export const MEMORY_KINDS = ["current", "knowledge", "procedures", "decisions", "references", "artifacts"] as const;
export const MEMORY_LIFECYCLES = ["active", "durable", "archived"] as const;
export const MEMORY_COMMIT_OPERATIONS = ["add", "update", "supersede", "archive", "repair", "migrate"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryLifecycle = (typeof MEMORY_LIFECYCLES)[number];
export type MemoryCommitOperation = (typeof MEMORY_COMMIT_OPERATIONS)[number];

export type FrontmatterScalar = string | string[];
export type FrontmatterValue = FrontmatterScalar | Record<string, FrontmatterScalar>;
export type MemoryFrontmatter = Record<string, FrontmatterValue> & {
  id?: string;
  kind?: string;
  title?: string;
  summary?: string | string[];
  lifecycle?: string;
};

export interface MemoryRepoOptions {
  root?: string;
  serverId?: string;
}

export interface MemoryRepoInfo {
  root: string;
  serverId: string;
  initialized: boolean;
  authoredDirs: MemoryKind[];
}

export interface MemoryFile {
  id: string;
  kind: MemoryKind;
  title: string;
  summary: string[];
  lifecycle: MemoryLifecycle;
  path: string;
  absolutePath: string;
  frontmatter: MemoryFrontmatter;
  body: string;
  content: string;
}

export interface MemoryCatalogEntry {
  id: string;
  kind: MemoryKind;
  title: string;
  summary: string[];
  lifecycle: MemoryLifecycle;
  path: string;
  facets: Record<string, string[]>;
  canonicalFor: string[];
}

export interface MemoryCatalog {
  repo: MemoryRepoInfo;
  entries: MemoryCatalogEntry[];
  issues: MemoryLintIssue[];
}

export type MemoryLintSeverity = "error" | "warning";

export interface MemoryLintIssue {
  severity: MemoryLintSeverity;
  path?: string;
  id?: string;
  message: string;
}

export interface MemoryRecallQuery {
  query?: string;
  kinds?: MemoryKind[];
  facets?: Record<string, string[]>;
  includeContent?: boolean;
  includeArchived?: boolean;
  limit?: number;
}

export interface MemoryRecallMatch {
  entry: MemoryCatalogEntry;
  score: number;
  reasons: string[];
  content?: string;
}

export interface MemoryRecallResult {
  repo: MemoryRepoInfo;
  matches: MemoryRecallMatch[];
  issues: MemoryLintIssue[];
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

export interface MemoryLockAcquireInput extends MemoryRepoOptions {
  owner?: string;
  session?: string;
  ttlMs?: number;
  stealStale?: boolean;
}

export interface MemoryCommitInput extends MemoryRepoOptions {
  message: string;
  quest?: string;
  session?: string;
  operation?: MemoryCommitOperation;
  memoryIds?: string[];
  sources?: string[];
}

export interface MemoryCommitResult {
  committed: boolean;
  sha?: string;
  message: string;
  status: string;
}
