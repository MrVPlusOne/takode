import {
  acquireMemoryLock,
  commitMemory,
  diffMemoryCatalog,
  ensureMemoryRepo,
  getMemoryLock,
  listMemorySpaces,
  lintMemory,
  markMemoryCatalogSeen,
  memoryRecentCommits,
  memoryGitDiff,
  memoryGitStatus,
  readMemoryRecord,
  recallMemory,
  releaseMemoryLock,
  resolveMemoryOptionsForSpace,
  resolveMemoryRepo,
  scanMemoryCatalog,
} from "./workstream-memory-store.js";
import type {
  MemoryCommitInput,
  MemoryLockAcquireInput,
  MemoryRecallQuery,
  MemoryRepoOptions,
} from "./workstream-memory-types.js";

export class WorkstreamMemoryService {
  resolveRepo(options?: MemoryRepoOptions) {
    return resolveMemoryRepo(options);
  }

  resolveSpaceOptions(input?: { serverSlug?: string; root?: string }) {
    return resolveMemoryOptionsForSpace(input);
  }

  ensureRepo(options?: MemoryRepoOptions) {
    return ensureMemoryRepo(options);
  }

  catalog(options?: MemoryRepoOptions) {
    return scanMemoryCatalog(options);
  }

  catalogDiff(options?: MemoryRepoOptions) {
    return diffMemoryCatalog(options);
  }

  markCatalogSeen(catalog: Awaited<ReturnType<typeof scanMemoryCatalog>>) {
    return markMemoryCatalogSeen(catalog);
  }

  recall(query?: MemoryRecallQuery, options?: MemoryRepoOptions) {
    return recallMemory(query, options);
  }

  lint(options?: MemoryRepoOptions) {
    return lintMemory(options);
  }

  spaces(options?: MemoryRepoOptions) {
    return listMemorySpaces(options);
  }

  readRecord(path: string, options?: MemoryRepoOptions) {
    return readMemoryRecord(path, options);
  }

  lockStatus(options?: MemoryRepoOptions) {
    return getMemoryLock(options);
  }

  acquireLock(input?: MemoryLockAcquireInput) {
    return acquireMemoryLock(input);
  }

  releaseLock(options?: MemoryRepoOptions) {
    return releaseMemoryLock(options);
  }

  gitStatus(options?: MemoryRepoOptions) {
    return memoryGitStatus(options);
  }

  recentCommits(options?: MemoryRepoOptions, limit?: number) {
    return memoryRecentCommits(options, limit);
  }

  gitDiff(options?: MemoryRepoOptions) {
    return memoryGitDiff(options);
  }

  commit(input: MemoryCommitInput) {
    return commitMemory(input);
  }
}

export const workstreamMemoryService = new WorkstreamMemoryService();
