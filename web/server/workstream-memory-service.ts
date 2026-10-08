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
  memoryCommitDiff,
  memoryGitDiff,
  memoryGitStatus,
  readMemoryRecord,
  releaseMemoryLock,
  resolveMemoryOptionsForSpace,
  resolveMemoryRepo,
  scanMemoryCatalog,
  type MemoryCatalogScanRuntime,
} from "./workstream-memory-store.js";
import { renderMemoryCatalogView, type MemoryCatalogViewRequest } from "./memory-catalog-view.js";
import { localDate, readHelpfulMarks, writeHelpfulMarks } from "./memory-repo-layout.js";
import { moveMemoryNotes, type MemoryMove } from "./memory-move.js";
import type { MemoryCommitInput, MemoryLockAcquireInput, MemoryRepoOptions } from "./workstream-memory-types.js";

export class WorkstreamMemoryService {
  resolveRepo(options?: MemoryRepoOptions) {
    return resolveMemoryRepo(options);
  }

  resolveSpaceOptions(input?: { serverSlug?: string; root?: string; expectedSessionSpaceSlugs?: string[] }) {
    return resolveMemoryOptionsForSpace(input);
  }

  ensureRepo(options?: MemoryRepoOptions) {
    return ensureMemoryRepo(options);
  }

  catalog(options?: MemoryRepoOptions, runtime?: MemoryCatalogScanRuntime) {
    return scanMemoryCatalog(options, runtime);
  }

  /** Render a catalog view with handle dedupe and an optional machine line (see `renderMemoryCatalogView`). */
  async catalogView(request: MemoryCatalogViewRequest, options?: MemoryRepoOptions, seen?: string, machine?: string) {
    const catalog = await scanMemoryCatalog(options);
    return { catalog, view: await renderMemoryCatalogView(catalog, request, { seen, machine }) };
  }

  /** Record that notes helped today. Marks refresh a note's last-touched date for the recent list. */
  async markHelpful(paths: string[], options?: MemoryRepoOptions) {
    const catalog = await scanMemoryCatalog(options);
    const known = new Set(catalog.entries.map((entry) => entry.path));
    const unknown = paths.filter((path) => !known.has(path));
    if (unknown.length) throw new Error(`Not a memory note: ${unknown.join(", ")}`);
    const marks = await readHelpfulMarks(catalog.repo.root);
    const today = localDate();
    for (const path of paths) marks[path] = today;
    await writeHelpfulMarks(catalog.repo.root, marks);
    return { marked: paths, date: today };
  }

  move(moves: MemoryMove[], options: MemoryRepoOptions = {}) {
    return moveMemoryNotes(options, moves);
  }

  catalogDiff(options?: MemoryRepoOptions) {
    return diffMemoryCatalog(options);
  }

  markCatalogSeen(catalog: Awaited<ReturnType<typeof scanMemoryCatalog>>, options?: MemoryRepoOptions) {
    return markMemoryCatalogSeen(catalog, options);
  }

  lint(options?: MemoryRepoOptions, lintOptions?: Parameters<typeof lintMemory>[1]) {
    return lintMemory(options, lintOptions);
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

  commitDiff(options: MemoryRepoOptions | undefined, sha: string) {
    return memoryCommitDiff(options, sha);
  }

  gitDiff(options?: MemoryRepoOptions) {
    return memoryGitDiff(options);
  }

  commit(input: MemoryCommitInput) {
    return commitMemory(input);
  }
}

export const workstreamMemoryService = new WorkstreamMemoryService();
