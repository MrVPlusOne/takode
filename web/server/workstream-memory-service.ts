import {
  archiveWorkstream,
  bookkeepingReport,
  checkMemory,
  createWorkstream,
  getRecord,
  getWorkstream,
  linkWorkstream,
  listWorkstreams,
  readCurrentContext,
  retireRecord,
  searchRecords,
  upsertRecord,
} from "./workstream-memory-store.js";
import type {
  CurrentReadQuery,
  MemoryCheckInput,
  MemorySearchQuery,
  RetireMemoryRecordInput,
  UpsertMemoryRecordInput,
  WorkstreamCreateInput,
  WorkstreamLinkInput,
  WorkstreamListFilter,
} from "./workstream-memory-types.js";

export class WorkstreamMemoryService {
  createWorkstream(input: WorkstreamCreateInput) {
    return createWorkstream(input);
  }

  getWorkstream(ref: string, options?: { includeArchived?: boolean }) {
    return getWorkstream(ref, options);
  }

  listWorkstreams(filter?: WorkstreamListFilter) {
    return listWorkstreams(filter);
  }

  archiveWorkstream(ref: string) {
    return archiveWorkstream(ref);
  }

  linkWorkstream(input: WorkstreamLinkInput) {
    return linkWorkstream(input);
  }

  upsertRecord(input: UpsertMemoryRecordInput) {
    return upsertRecord(input);
  }

  retireRecord(input: RetireMemoryRecordInput) {
    return retireRecord(input);
  }

  getRecord(ref: string, options?: { includeRetired?: boolean; includeArchived?: boolean }) {
    return getRecord(ref, options);
  }

  searchRecords(query: MemorySearchQuery) {
    return searchRecords(query);
  }

  readCurrentContext(query: CurrentReadQuery) {
    return readCurrentContext(query);
  }

  checkMemory(input: MemoryCheckInput) {
    return checkMemory(input);
  }

  bookkeepingReport(workstream?: string) {
    return bookkeepingReport(workstream);
  }
}

export const workstreamMemoryService = new WorkstreamMemoryService();
