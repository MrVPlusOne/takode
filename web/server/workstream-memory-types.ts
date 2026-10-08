export const MEMORY_NOTE_TYPES = ["current", "knowledge", "procedure", "decision", "reference", "artifact"] as const;
/**
 * Top-level folders of the original type-directory layout. Until a repo is curated into
 * topic folders, a note in one of these folders without a `type:` takes its type from it.
 */
export const LEGACY_TYPE_FOLDERS = {
  current: "current",
  knowledge: "knowledge",
  procedures: "procedure",
  decisions: "decision",
  references: "reference",
  artifacts: "artifact",
} as const satisfies Record<string, MemoryNoteType>;
export const MEMORY_COMMIT_OPERATIONS = ["add", "update", "supersede", "repair"] as const;
export const MEMORY_DESCRIPTION_CHAR_LIMIT = 250;

export type MemoryNoteType = (typeof MEMORY_NOTE_TYPES)[number];
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
  sessionSpaceSlug?: string;
  expectedSessionSpaceSlugs?: string[];
  readOnly?: boolean;
  /** Optional session-specific catalog-seen key for server-mediated catalog reads. */
  catalogSessionKey?: string;
}

export interface MemoryRepoInfo {
  root: string;
  serverId: string;
  serverSlug: string;
  sessionSpaceSlug: string;
  initialized: boolean;
  /** Top-level folders that hold notes. */
  authoredDirs: string[];
}

export interface MemoryFile {
  id: string;
  /** Explicit `type:`, else the legacy type folder's type, else undefined. */
  type?: MemoryNoteType;
  /** Repo-relative folder holding the note ("" for a misplaced root-level note). */
  folder: string;
  /** `updated:` frontmatter date (YYYY-MM-DD), or "" when absent. */
  updated: string;
  description: string;
  source: string[];
  /** Machines the note was written on (`machines:`), in the order they first wrote it; [] when unstamped. */
  machines: string[];
  path: string;
  absolutePath: string;
  frontmatter: MemoryFrontmatter;
  body: string;
  content: string;
}

export interface MemoryCatalogEntry {
  id: string;
  type?: MemoryNoteType;
  folder: string;
  /** Last substantive edit (frontmatter `updated:`, else the file's last Git commit date). */
  updated: string;
  /** Last touched: the later of `updated` and the latest helpful mark. Ranks the recent list. */
  touched: string;
  description: string;
  path: string;
  source: string[];
  /** Machines the note was written on, as in `MemoryFile.machines`. */
  machines: string[];
  facets: Record<string, string[]>;
}

export interface MemoryFolderInfo {
  /** Repo-relative folder path. */
  path: string;
  /** README `description:`, or "" when the folder has no README description. */
  description: string;
  /** Notes in this folder and its subfolders. */
  noteCount: number;
  /** Direct subfolder paths. */
  subfolders: string[];
  /** Internal version of the folder's catalog line, for handle dedupe. */
  version: string;
}

export interface MemoryCatalog {
  repo: MemoryRepoInfo;
  entries: MemoryCatalogEntry[];
  folders: MemoryFolderInfo[];
  issues: MemoryLintIssue[];
  /** Internal SHA-256 file versions for freshness; excluded from catalog presentation. */
  contentHashes?: Record<string, string>;
}

export type MemoryCatalogChangeKind = "added" | "removed" | "changed";

export interface MemoryCatalogChange {
  kind: MemoryCatalogChangeKind;
  path: string;
  before?: MemoryCatalogEntry;
  after?: MemoryCatalogEntry;
}

export interface MemoryCatalogDiff {
  repo: MemoryRepoInfo;
  changes: MemoryCatalogChange[];
  issues: MemoryLintIssue[];
  sessionKey: string;
  previousSeenAt?: string;
  seenAt: string;
}

export interface MemorySpaceInfo {
  slug: string;
  root: string;
  current: boolean;
  initialized: boolean;
  authoredDirs: string[];
  hasAuthoredData: boolean;
  sessionSpaceSlug?: string;
  serverId?: string;
  updatedAt?: string;
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

export interface MemoryCommitSourceFile {
  status: string;
  path: string;
  previousPath?: string;
  oldText: string;
  newText: string;
}

export interface MemoryCommitDiff {
  repo: MemoryRepoInfo;
  commit: MemoryRecentCommit;
  diff: string;
  sourceFiles: MemoryCommitSourceFile[];
}

export type MemoryLintSeverity = "error" | "warning";

export interface MemoryLintIssue {
  severity: MemoryLintSeverity;
  path?: string;
  id?: string;
  message: string;
  /** A per-note rule that blocks only commits that change this note; reported as a warning otherwise. */
  blocksCommitOfNote?: boolean;
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
  /** Machine of the committing session, added to every note a non-repair commit changes. */
  machine?: string;
}

export interface MemoryCommitResult {
  committed: boolean;
  sha?: string;
  message: string;
  status: string;
}
