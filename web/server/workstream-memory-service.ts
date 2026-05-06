import {
  acquireMemoryLock,
  commitMemory,
  ensureMemoryRepo,
  getMemoryLock,
  lintMemory,
  memoryGitDiff,
  memoryGitStatus,
  recallMemory,
  releaseMemoryLock,
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

  ensureRepo(options?: MemoryRepoOptions) {
    return ensureMemoryRepo(options);
  }

  catalog(options?: MemoryRepoOptions) {
    return scanMemoryCatalog(options);
  }

  recall(query?: MemoryRecallQuery, options?: MemoryRepoOptions) {
    return recallMemory(query, options);
  }

  lint(options?: MemoryRepoOptions) {
    return lintMemory(options);
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

  gitDiff(options?: MemoryRepoOptions) {
    return memoryGitDiff(options);
  }

  commit(input: MemoryCommitInput) {
    return commitMemory(input);
  }
}

export const workstreamMemoryService = new WorkstreamMemoryService();
