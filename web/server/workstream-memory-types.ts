export const MEMORY_KINDS = ["current", "knowledge", "procedures", "decisions", "references", "artifacts"] as const;
export const MEMORY_COMMIT_OPERATIONS = ["add", "update", "supersede", "repair"] as const;

export type MemoryKind = (typeof MEMORY_KINDS)[number];
export type MemoryCommitOperation = (typeof MEMORY_COMMIT_OPERATIONS)[number];

export type FrontmatterScalar = string | string[];
export type FrontmatterValue = FrontmatterScalar | Record<string, FrontmatterScalar>;
export type MemoryFrontmatter = Record<string, FrontmatterValue> & {
  description?: string;
  source?: string | string[];
};

export interface MemoryRepoOptions {
  root?: string;
  serverId?: string;
  serverSlug?: string;
  readOnly?: boolean;
}

export interface MemoryRepoInfo {
  root: string;
  serverId: string;
  serverSlug: string;
  initialized: boolean;
  authoredDirs: MemoryKind[];
}

export interface MemoryFile {
  id: string;
  kind: MemoryKind;
  description: string;
  source: string[];
  path: string;
  absolutePath: string;
  frontmatter: MemoryFrontmatter;
  body: string;
  content: string;
}

export interface MemoryCatalogEntry {
  id: string;
  kind: MemoryKind;
  description: string;
  path: string;
  source: string[];
  facets: Record<string, string[]>;
}

export interface MemoryCatalog {
  repo: MemoryRepoInfo;
  entries: MemoryCatalogEntry[];
  issues: MemoryLintIssue[];
}

export interface MemorySpaceInfo {
  slug: string;
  root: string;
  current: boolean;
  initialized: boolean;
  authoredDirs: MemoryKind[];
  hasAuthoredData: boolean;
  serverId?: string;
  updatedAt?: string;
}

export interface MemoryRecentCommit {
  sha: string;
  shortSha: string;
  timestamp: number;
  message: string;
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
