import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CURRENT_READ_PURPOSES,
  MEMORY_BUCKETS,
  MEMORY_PRIORITIES,
  MEMORY_STATUSES,
  MEMORY_SUBTYPES,
  WORKSTREAM_STATUSES,
  type ActorRef,
  type AppliesTo,
  type AuthorityBoundary,
  type BookkeepingReport,
  type CurrentReadQuery,
  type CurrentReadResult,
  type MemoryPriority,
  type MemoryRecord,
  type MemorySearchQuery,
  type MemorySearchResult,
  type MemoryStatus,
  type RecordVersion,
  type RetireMemoryRecordInput,
  type SourceLink,
  type UpsertMemoryRecordInput,
  type Workstream,
  type WorkstreamCreateInput,
  type WorkstreamLinkInput,
  type WorkstreamListFilter,
  type WorkstreamStatus,
} from "./workstream-memory-types.js";

const MEMORY_DIR = join(
  process.env.COMPANION_WORKSTREAM_MEMORY_DIR || join(homedir(), ".companion", "workstream-memory"),
);
const WORKSTREAMS_DIR = join(MEMORY_DIR, "workstreams");
const RECORDS_DIR = join(MEMORY_DIR, "records");
const FRONTMATTER_BOUNDARY = "---";
const VALID_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VALID_RECORD_KEY = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const PRIORITY_WEIGHT: Record<MemoryPriority, number> = { safety: 4, blocking: 3, important: 2, info: 1 };
const VALID_AUTHORITY_SYSTEMS = new Set<AuthorityBoundary["authoritativeSystem"]>([
  "user",
  "quest",
  "phase-notes",
  "board",
  "session-registry",
  "timer-store",
  "git",
  "deployment",
  "filesystem",
  "skill-doc",
  "product-state",
  "unknown",
]);
const VALID_CONFLICT_RULES = new Set<AuthorityBoundary["conflictRule"]>([
  "user-overrides",
  "product-state-overrides",
  "newer-active-record-overrides",
  "ask-user",
  "block-until-resolved",
]);

export async function createWorkstream(input: WorkstreamCreateInput): Promise<Workstream> {
  const actor = input.actor ?? systemActor();
  const now = isoNow();
  const slug = normalizeSlug(input.slug);
  validateSlug(slug);
  if (!input.title.trim()) throw new Error("Workstream title is required");
  if (!input.objective.trim()) throw new Error("Workstream objective is required");
  await ensureMemoryDirs();
  const existing = await getWorkstream(slug, { includeArchived: true });
  if (existing) {
    throw new Error(`Workstream slug already exists: ${slug}`);
  }

  const workstream: Workstream = {
    id: randomUUID(),
    slug,
    title: input.title.trim(),
    objective: input.objective.trim(),
    status: "active",
    scopeTags: normalizeTokenList(input.scopeTags),
    ...(input.ownerProject?.trim() ? { ownerProject: input.ownerProject.trim() } : {}),
    createdBy: actor,
    createdAt: now,
    updatedBy: actor,
    updatedAt: now,
    linkedQuests: [],
    linkedSessions: [],
    migrationSources: input.migrationSources ?? [],
    sourceLinks: input.sourceLinks ?? [],
    visibility: input.visibility ?? "default",
  };
  await writeWorkstream(workstream);
  return workstream;
}

export async function getWorkstream(
  ref: string,
  options: { includeArchived?: boolean } = {},
): Promise<Workstream | null> {
  await ensureMemoryDirs();
  const slug = normalizeSlug(ref);
  try {
    const workstream = parseWorkstreamMarkdown(await readFile(workstreamPath(slug), "utf-8"));
    if (!options.includeArchived && workstream.status === "archived") return null;
    return workstream;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const workstreams = await listWorkstreams({ includeArchived: options.includeArchived });
  return workstreams.find((workstream) => workstream.id === ref) ?? null;
}

export async function listWorkstreams(filter: WorkstreamListFilter = {}): Promise<Workstream[]> {
  await ensureMemoryDirs();
  const files = await safeReaddir(WORKSTREAMS_DIR);
  const workstreams: Workstream[] = [];
  for (const file of files.filter((name) => name.endsWith(".md"))) {
    const path = join(WORKSTREAMS_DIR, file);
    try {
      const workstream = parseWorkstreamMarkdown(await readFile(path, "utf-8"));
      if (!filter.includeArchived && workstream.status === "archived") continue;
      if (filter.status && workstream.status !== filter.status) continue;
      if (filter.tag && !workstream.scopeTags.includes(filter.tag)) continue;
      workstreams.push(workstream);
    } catch (error) {
      console.warn(`[workstream-memory] Skipping unreadable workstream ${file}:`, error);
    }
  }
  return workstreams.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug));
}

export async function archiveWorkstream(ref: string, actor: ActorRef = systemActor()): Promise<Workstream> {
  const workstream = await requireWorkstream(ref, { includeArchived: true });
  if (workstream.status !== "archived") {
    workstream.status = "archived";
    workstream.archivedAt = isoNow();
    workstream.archivedBy = actor;
    touchWorkstream(workstream, actor);
    await writeWorkstream(workstream);
  }
  return workstream;
}

export async function linkWorkstream(input: WorkstreamLinkInput): Promise<Workstream> {
  const actor = input.actor ?? systemActor();
  const workstream = await requireWorkstream(input.workstream);
  const now = isoNow();
  for (const quest of input.quests ?? []) {
    if (!/^q-\d+$/i.test(quest.questId)) throw new Error(`Invalid quest ID: ${quest.questId}`);
    const existingIndex = workstream.linkedQuests.findIndex((item) => item.questId === quest.questId);
    const linked = { ...quest, linkedAt: now, linkedBy: actor };
    if (existingIndex === -1) workstream.linkedQuests.push(linked);
    else workstream.linkedQuests[existingIndex] = { ...workstream.linkedQuests[existingIndex], ...linked };
  }
  for (const session of input.sessions ?? []) {
    if (!Number.isInteger(session.sessionNum) || session.sessionNum <= 0) {
      throw new Error(`Invalid session number: ${session.sessionNum}`);
    }
    const existingIndex = workstream.linkedSessions.findIndex((item) => item.sessionNum === session.sessionNum);
    const linked = { ...session, linkedAt: now, linkedBy: actor };
    if (existingIndex === -1) workstream.linkedSessions.push(linked);
    else workstream.linkedSessions[existingIndex] = { ...workstream.linkedSessions[existingIndex], ...linked };
  }
  touchWorkstream(workstream, actor);
  await writeWorkstream(workstream);
  return workstream;
}

export async function upsertRecord(input: UpsertMemoryRecordInput): Promise<MemoryRecord> {
  const actor = input.actor ?? systemActor();
  const { workstreamSlug, key } = parseRecordRef(input.ref);
  const workstream = await requireWorkstream(workstreamSlug);
  const now = isoNow();
  const existing = await getRecord(input.ref, { includeRetired: true, includeArchived: true });
  if ((existing?.status === "retired" || existing?.status === "superseded") && !input.reactivate) {
    throw new Error(`Record is ${existing.status}; pass --reactivate to update it: ${input.ref}`);
  }

  const status = input.status ?? "active";
  const record: MemoryRecord = existing
    ? {
        ...existing,
        bucket: input.bucket,
        subtype: input.subtype,
        status,
        priority: input.priority,
        title: input.title?.trim() || existing.title,
        current: input.current.trim(),
        ...(input.details !== undefined ? { details: input.details.trim() || undefined } : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        appliesTo: normalizeAppliesTo(input.appliesTo),
        retrievalHooks: input.retrievalHooks ?? [],
        evidence: mergeSourceLinks(existing.evidence, input.evidence),
        supersedes: mergeStrings(existing.supersedes, input.supersedes ?? []),
        replacedBy: undefined,
        conflictsWith: input.conflictsWith ?? existing.conflictsWith,
        authorityBoundary: input.authorityBoundary,
        activation: {
          status,
          activationScope: input.activationScope ?? existing.activation.activationScope,
          ...(status === "active" ? { activatedBy: actor, activatedAt: now } : {}),
          activationSource: input.evidence[0] ?? existing.activation.activationSource,
        },
        ...(input.retireWhen ? { retireWhen: input.retireWhen } : {}),
        updatedBy: actor,
        updatedAt: now,
      }
    : {
        id: randomUUID(),
        workstreamId: workstream.id,
        workstreamSlug: workstream.slug,
        key,
        bucket: input.bucket,
        subtype: input.subtype,
        status,
        priority: input.priority,
        title: input.title?.trim() || key,
        current: input.current.trim(),
        ...(input.details?.trim() ? { details: input.details.trim() } : {}),
        ...(input.target ? { target: input.target } : {}),
        appliesTo: normalizeAppliesTo(input.appliesTo),
        retrievalHooks: input.retrievalHooks ?? [],
        evidence: input.evidence,
        supersedes: input.supersedes ?? [],
        conflictsWith: input.conflictsWith ?? [],
        authorityBoundary: input.authorityBoundary,
        activation: {
          status,
          activationScope: input.activationScope ?? "workstream",
          ...(status === "active" ? { activatedBy: actor, activatedAt: now } : {}),
          activationSource: input.evidence[0],
        },
        ...(input.retireWhen ? { retireWhen: input.retireWhen } : {}),
        history: [],
        createdBy: actor,
        createdAt: now,
        updatedBy: actor,
        updatedAt: now,
      };
  validateRecord(record);
  record.history = appendHistory(existing?.history ?? [], record, actor, input.evidence);
  await writeRecord(record);
  touchWorkstream(workstream, actor);
  await writeWorkstream(workstream);
  return record;
}

export async function retireRecord(input: RetireMemoryRecordInput): Promise<MemoryRecord> {
  const actor = input.actor ?? systemActor();
  const record = await requireRecord(input.ref, { includeRetired: true });
  if (!input.reason.trim()) throw new Error("Retirement reason is required");
  if (input.sourceLinks.length === 0) throw new Error("At least one retirement source is required");
  record.status = input.supersededBy ? "superseded" : "retired";
  record.replacedBy = input.supersededBy;
  record.updatedBy = actor;
  record.updatedAt = isoNow();
  record.evidence = mergeSourceLinks(record.evidence, input.sourceLinks);
  record.history = appendHistory(record.history, record, actor, input.sourceLinks, input.reason.trim());
  await writeRecord(record);
  return record;
}

export async function getRecord(
  ref: string,
  options: { includeRetired?: boolean; includeArchived?: boolean } = {},
): Promise<MemoryRecord | null> {
  const { workstreamSlug, key } = parseRecordRef(ref);
  try {
    const record = parseRecordMarkdown(await readFile(recordPath(workstreamSlug, key), "utf-8"));
    if (!options.includeArchived && record.status === "archived") return null;
    if (!options.includeRetired && (record.status === "retired" || record.status === "superseded")) return null;
    return record;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function searchRecords(query: MemorySearchQuery): Promise<MemorySearchResult[]> {
  const matcher = buildMatcher(query.pattern, query.regex);
  const records = await listRecords({
    workstream: query.workstream,
    includeRetired: query.includeRetired,
    includeProposed: query.includeProposed,
  });
  const results: MemorySearchResult[] = [];
  for (const record of records) {
    const snippets = matchingSnippets(record, matcher);
    if (snippets.length === 0) continue;
    results.push({
      record,
      score: scoreRecord(record, query.pattern),
      snippets: snippets.slice(0, 3),
      remainingChildMatches: Math.max(0, snippets.length - 3),
    });
  }
  return results
    .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
    .slice(0, query.limit ?? 50);
}

export async function readCurrentContext(query: CurrentReadQuery): Promise<CurrentReadResult> {
  const workstreams = await resolveCurrentWorkstreams(query);
  const records = (
    await Promise.all(
      workstreams.map((workstream) =>
        listRecords({
          workstream: workstream.slug,
          includeRetired: query.includeRetired,
          includeProposed: query.includeProposed,
        }),
      ),
    )
  )
    .flat()
    .filter((record) => record.bucket === "current")
    .filter((record) => recordMatchesCurrentQuery(record, query));

  records.sort((a, b) => {
    const priority = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
    if (priority !== 0) return priority;
    return b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key);
  });

  const limit = query.limit ?? 5;
  const warnings: string[] = [];
  if (records.length > limit) warnings.push(`Matched ${records.length} current records; showing ${limit}.`);
  return { status: "ok", query, records: records.slice(0, limit), warnings };
}

export async function bookkeepingReport(workstreamRef?: string): Promise<BookkeepingReport> {
  const records = await listRecords({
    workstream: workstreamRef,
    includeRetired: false,
    includeProposed: true,
  });
  const report: BookkeepingReport = {
    ...(workstreamRef ? { workstream: workstreamRef } : {}),
    generatedAt: isoNow(),
    issues: [],
  };
  for (const record of records) {
    const ref = `${record.workstreamSlug}/${record.key}`;
    if (record.evidence.length === 0)
      report.issues.push({ level: "warn", record: ref, message: "missing source evidence" });
    if (!hasAnyAppliesTo(record.appliesTo) && record.retrievalHooks.length === 0) {
      report.issues.push({ level: "warn", record: ref, message: "missing appliesTo or retrieval hooks" });
    }
    if (!record.authorityBoundary.memoryOwns.trim()) {
      report.issues.push({ level: "warn", record: ref, message: "missing authority boundary" });
    }
    if (requiresRetireWhen(record) && !record.retireWhen?.description.trim()) {
      report.issues.push({ level: "warn", record: ref, message: `${record.subtype} records require retireWhen` });
    }
    if (looksProductStateLike(record.current)) {
      report.issues.push({
        level: "warn",
        record: ref,
        message: "current statement looks like live product state; memory should store expected policy/context instead",
      });
    }
  }
  return report;
}

export async function getMemoryRoot(): Promise<string> {
  await ensureMemoryDirs();
  return MEMORY_DIR;
}

async function listRecords(options: {
  workstream?: string;
  includeRetired?: boolean;
  includeProposed?: boolean;
}): Promise<MemoryRecord[]> {
  await ensureMemoryDirs();
  const workstreamSlugs = options.workstream
    ? [(await requireWorkstream(options.workstream, { includeArchived: true })).slug]
    : (await listWorkstreams()).map((workstream) => workstream.slug);
  const records: MemoryRecord[] = [];
  for (const slug of workstreamSlugs) {
    for (const file of (await safeReaddir(join(RECORDS_DIR, slug))).filter((name) => name.endsWith(".md"))) {
      try {
        const record = parseRecordMarkdown(await readFile(join(RECORDS_DIR, slug, file), "utf-8"));
        if (
          !options.includeRetired &&
          (record.status === "retired" || record.status === "superseded" || record.status === "archived")
        )
          continue;
        if (!options.includeProposed && record.status === "proposed") continue;
        records.push(record);
      } catch (error) {
        console.warn(`[workstream-memory] Skipping unreadable record ${slug}/${file}:`, error);
      }
    }
  }
  return records;
}

async function resolveCurrentWorkstreams(query: CurrentReadQuery): Promise<Workstream[]> {
  if (query.workstream) return [await requireWorkstream(query.workstream)];
  if (!query.questId) throw new Error("Either workstream or questId is required");
  const workstreams = (await listWorkstreams()).filter((workstream) =>
    workstream.linkedQuests.some((quest) => quest.questId === query.questId),
  );
  if (workstreams.length === 0) throw new Error(`No workstream is linked to ${query.questId}`);
  return workstreams;
}

async function requireWorkstream(ref: string, options: { includeArchived?: boolean } = {}): Promise<Workstream> {
  const workstream = await getWorkstream(ref, options);
  if (!workstream) throw new Error(`Workstream not found: ${ref}`);
  return workstream;
}

async function requireRecord(
  ref: string,
  options: { includeRetired?: boolean; includeArchived?: boolean } = {},
): Promise<MemoryRecord> {
  const record = await getRecord(ref, options);
  if (!record) throw new Error(`Memory record not found: ${ref}`);
  return record;
}

function parseRecordRef(ref: string): { workstreamSlug: string; key: string } {
  const [workstreamSlug, key, ...extra] = ref.split("/");
  if (!workstreamSlug || !key || extra.length > 0) {
    throw new Error("Record ref must be <workstream-slug>/<record-key>");
  }
  const normalizedSlug = normalizeSlug(workstreamSlug);
  validateSlug(normalizedSlug);
  validateRecordKey(key);
  return { workstreamSlug: normalizedSlug, key };
}

function parseWorkstreamMarkdown(markdown: string): Workstream {
  const { data } = parseStructuredMarkdown(markdown);
  const workstream = data as unknown as Workstream;
  validateWorkstream(workstream);
  return workstream;
}

function parseRecordMarkdown(markdown: string): MemoryRecord {
  const { data, body } = parseStructuredMarkdown(markdown);
  const record = data as unknown as MemoryRecord;
  const sections = parseRecordSections(body);
  record.current = sections.current || record.current;
  record.details = sections.details || record.details;
  validateRecord(record);
  return record;
}

function parseStructuredMarkdown(markdown: string): { data: Record<string, unknown>; body: string } {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  if (!normalized.startsWith(`${FRONTMATTER_BOUNDARY}\n`)) throw new Error("Missing structured frontmatter");
  const end = normalized.indexOf(`\n${FRONTMATTER_BOUNDARY}\n`, FRONTMATTER_BOUNDARY.length + 1);
  if (end === -1) throw new Error("Unclosed structured frontmatter");
  const rawFrontmatter = normalized.slice(FRONTMATTER_BOUNDARY.length + 1, end);
  const data: Record<string, unknown> = {};
  for (const line of rawFrontmatter.split("\n")) {
    if (!line.trim()) continue;
    const separator = line.indexOf(":");
    if (separator === -1) throw new Error(`Invalid frontmatter line: ${line}`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    data[key] = JSON.parse(value);
  }
  return { data, body: normalized.slice(end + FRONTMATTER_BOUNDARY.length + 2) };
}

function parseRecordSections(body: string): { current?: string; details?: string } {
  const current = extractMarkdownSection(body, "Current");
  const details = extractMarkdownSection(body, "Details");
  return {
    ...(current ? { current } : {}),
    ...(details ? { details } : {}),
  };
}

function extractMarkdownSection(body: string, heading: string): string | undefined {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  const sectionLines = lines.slice(start + 1, end === -1 ? undefined : end);
  const text = sectionLines.join("\n").trim();
  return text || undefined;
}

async function writeWorkstream(workstream: Workstream): Promise<void> {
  validateWorkstream(workstream);
  await writeMarkdownAtomic(workstreamPath(workstream.slug), formatWorkstreamMarkdown(workstream));
}

async function writeRecord(record: MemoryRecord): Promise<void> {
  validateRecord(record);
  await writeMarkdownAtomic(recordPath(record.workstreamSlug, record.key), formatRecordMarkdown(record));
}

async function writeMarkdownAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, path);
}

function formatWorkstreamMarkdown(workstream: Workstream): string {
  return `${formatFrontmatter(workstream)}# ${workstream.title}\n\n${workstream.objective}\n`;
}

function formatRecordMarkdown(record: MemoryRecord): string {
  return `${formatFrontmatter(record)}# ${record.title}\n\n## Current\n${record.current.trim()}\n\n${
    record.details?.trim() ? `## Details\n${record.details.trim()}\n` : ""
  }`;
}

function formatFrontmatter(value: object): string {
  const lines = [FRONTMATTER_BOUNDARY];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined) continue;
    lines.push(`${key}: ${JSON.stringify(raw)}`);
  }
  lines.push(FRONTMATTER_BOUNDARY, "");
  return lines.join("\n");
}

async function ensureMemoryDirs(): Promise<void> {
  await mkdir(WORKSTREAMS_DIR, { recursive: true });
  await mkdir(RECORDS_DIR, { recursive: true });
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function workstreamPath(slug: string): string {
  return join(WORKSTREAMS_DIR, `${slug}.md`);
}

function recordPath(workstreamSlug: string, key: string): string {
  return join(RECORDS_DIR, workstreamSlug, `${key}.md`);
}

function validateWorkstream(workstream: Workstream): void {
  validateSlug(workstream.slug);
  if (!WORKSTREAM_STATUSES.includes(workstream.status))
    throw new Error(`Invalid workstream status: ${workstream.status}`);
  if (!workstream.title.trim()) throw new Error("Workstream title is required");
  if (!workstream.objective.trim()) throw new Error("Workstream objective is required");
}

function validateRecord(record: MemoryRecord): void {
  validateSlug(record.workstreamSlug);
  validateRecordKey(record.key);
  if (!MEMORY_BUCKETS.includes(record.bucket)) throw new Error(`Invalid memory bucket: ${record.bucket}`);
  if (!MEMORY_SUBTYPES.includes(record.subtype)) throw new Error(`Invalid memory subtype: ${record.subtype}`);
  if (!MEMORY_STATUSES.includes(record.status)) throw new Error(`Invalid memory status: ${record.status}`);
  if (!MEMORY_PRIORITIES.includes(record.priority)) throw new Error(`Invalid memory priority: ${record.priority}`);
  if (!record.title.trim()) throw new Error("Memory title is required");
  if (!record.current.trim()) throw new Error("Memory current text is required");
  if (record.bucket === "reference" && !record.target) throw new Error("Reference Pointer records require a target");
  validateAuthorityBoundary(record.authorityBoundary);
  if (record.status === "active") {
    if (record.evidence.length === 0) throw new Error("Active memory records require at least one source");
    if (!hasAnyAppliesTo(record.appliesTo) && record.retrievalHooks.length === 0) {
      throw new Error("Active memory records require appliesTo or retrievalHooks");
    }
    if (!record.authorityBoundary.memoryOwns.trim())
      throw new Error("Active memory records require authorityBoundary.memoryOwns");
    if (requiresRetireWhen(record) && !record.retireWhen?.description.trim()) {
      throw new Error(`${record.subtype} records require retireWhen`);
    }
  }
  for (const hook of record.retrievalHooks) {
    if (!CURRENT_READ_PURPOSES.includes(hook)) throw new Error(`Invalid retrieval hook: ${hook}`);
  }
}

function validateSlug(slug: string): void {
  if (!VALID_SLUG.test(slug)) {
    throw new Error("Workstream slug must be lowercase alphanumeric with dashes and at most 80 characters");
  }
}

function validateRecordKey(key: string): void {
  if (!VALID_RECORD_KEY.test(key)) {
    throw new Error("Record key must be lowercase alphanumeric with dashes, underscores, or dots");
  }
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeTokenList(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function normalizeAppliesTo(appliesTo: AppliesTo | undefined): AppliesTo {
  if (!appliesTo) return {};
  return {
    questIds: normalizeTokenList(appliesTo.questIds),
    sessionNums: appliesTo.sessionNums?.filter((value) => Number.isInteger(value) && value > 0),
    workerSessionNums: appliesTo.workerSessionNums?.filter((value) => Number.isInteger(value) && value > 0),
    componentTags: normalizeTokenList(appliesTo.componentTags),
    domainTags: normalizeTokenList(appliesTo.domainTags),
    actionTags: normalizeTokenList(appliesTo.actionTags),
    exactTerms: normalizeTokenList(appliesTo.exactTerms),
  };
}

function hasAnyAppliesTo(appliesTo: AppliesTo): boolean {
  return Object.values(appliesTo).some((value) => Array.isArray(value) && value.length > 0);
}

function requiresRetireWhen(record: MemoryRecord): boolean {
  return ["active-run", "route", "worker-affinity"].includes(record.subtype);
}

function recordMatchesCurrentQuery(record: MemoryRecord, query: CurrentReadQuery): boolean {
  if (record.status !== "active" && !(query.includeProposed && record.status === "proposed")) return false;
  if (record.retrievalHooks.includes(query.purpose)) return true;
  if (query.questId && record.appliesTo.questIds?.includes(query.questId)) return true;
  if (query.workerSessionNum && record.appliesTo.workerSessionNums?.includes(query.workerSessionNum)) return true;
  if (query.componentTags?.some((tag) => record.appliesTo.componentTags?.includes(tag))) return true;
  return record.appliesTo.actionTags?.includes(query.purpose) ?? false;
}

function appendHistory(
  existing: RecordVersion[],
  record: MemoryRecord,
  actor: ActorRef,
  sources: SourceLink[],
  reason?: string,
): RecordVersion[] {
  return [
    ...existing,
    {
      version: existing.length + 1,
      status: record.status,
      current: record.current,
      ...(record.details ? { details: record.details } : {}),
      ...(reason ? { reason } : {}),
      sourceLinks: sources,
      updatedAt: record.updatedAt,
      updatedBy: actor,
    },
  ];
}

function mergeSourceLinks(existing: SourceLink[], incoming: SourceLink[]): SourceLink[] {
  const result: SourceLink[] = [];
  const seen = new Set<string>();
  for (const source of [...existing, ...incoming]) {
    const key = `${source.kind}\0${source.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function mergeStrings(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming].map((value) => value.trim()).filter(Boolean))];
}

function buildMatcher(pattern: string, regex = false): (text: string) => boolean {
  if (!pattern.trim()) throw new Error("Search pattern is required");
  if (regex) {
    const expression = new RegExp(pattern, "i");
    return (text) => expression.test(text);
  }
  const needle = pattern.toLowerCase();
  return (text) => text.toLowerCase().includes(needle);
}

function matchingSnippets(record: MemoryRecord, matcher: (text: string) => boolean): string[] {
  const fields = [
    `title: ${record.title}`,
    `current: ${record.current}`,
    ...(record.details ? [`details: ${record.details}`] : []),
    `key: ${record.workstreamSlug}/${record.key}`,
    ...record.evidence.map((source) => `source: ${source.label} ${source.target} ${source.quote ?? ""}`),
    ...Object.entries(record.appliesTo).flatMap(([key, value]) =>
      Array.isArray(value) ? value.map((item) => `${key}: ${item}`) : [],
    ),
    ...(record.target ? [`target: ${record.target.label} ${record.target.target}`] : []),
  ];
  return fields.filter(matcher).map((field) => field.replace(/\s+/g, " ").trim());
}

function scoreRecord(record: MemoryRecord, pattern: string): number {
  const needle = pattern.toLowerCase();
  let score = PRIORITY_WEIGHT[record.priority] * 10;
  if (`${record.workstreamSlug}/${record.key}`.toLowerCase() === needle) score += 100;
  if (record.title.toLowerCase().includes(needle)) score += 40;
  if (record.current.toLowerCase().includes(needle)) score += 25;
  if (record.status === "active") score += 10;
  return score;
}

function looksProductStateLike(text: string): boolean {
  return /\b(pid|port|lease owner|tmux pane|currently running|live endpoint|browser profile)\b/i.test(text);
}

function touchWorkstream(workstream: Workstream, actor: ActorRef): void {
  workstream.updatedBy = actor;
  workstream.updatedAt = isoNow();
}

function isoNow(): string {
  return new Date().toISOString();
}

function systemActor(): ActorRef {
  return { role: "system", ref: "memory-cli" };
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function parseSourceLink(raw: string): SourceLink {
  const trimmed = raw.trim();
  const markdown = trimmed.match(/^\[([^\]]+)]\(([^)]+)\)$/);
  const label = markdown?.[1] ?? trimmed;
  const target = markdown?.[2] ?? trimmed;
  return {
    kind: inferSourceKind(target),
    target,
    label,
  };
}

function inferSourceKind(target: string): SourceLink["kind"] {
  if (/^quest-feedback:q-\d+#\d+$/i.test(target) || /^q-\d+#\d+$/i.test(target)) return "quest-feedback";
  if (/^quest:q-\d+$/i.test(target) || /^q-\d+$/i.test(target)) return "quest";
  if (/^session:\d+:\d+$/i.test(target)) return "session-message";
  if (/^session:\d+$/i.test(target)) return "session";
  if (/^file:/i.test(target)) return "file";
  if (/^skill:/i.test(target)) return "skill";
  if (/^doc:/i.test(target)) return "doc";
  if (/^report:/i.test(target)) return "report";
  return "manual";
}

export function parseAuthorityBoundary(raw: string): AuthorityBoundary {
  const [memoryOwns, authoritativeSystem = "unknown", conflictRule = "ask-user"] = raw
    .split("|")
    .map((part) => part.trim());
  if (!memoryOwns) throw new Error("--authority-boundary must start with what memory owns");
  const boundary = {
    memoryOwns,
    authoritativeSystem: authoritativeSystem as AuthorityBoundary["authoritativeSystem"],
    conflictRule: conflictRule as AuthorityBoundary["conflictRule"],
  };
  validateAuthorityBoundary(boundary);
  return boundary;
}

function validateAuthorityBoundary(boundary: AuthorityBoundary): void {
  if (!VALID_AUTHORITY_SYSTEMS.has(boundary.authoritativeSystem)) {
    throw new Error(`Invalid authority system: ${boundary.authoritativeSystem}`);
  }
  if (!VALID_CONFLICT_RULES.has(boundary.conflictRule)) {
    throw new Error(`Invalid authority conflict rule: ${boundary.conflictRule}`);
  }
}

export function assertValidWorkstreamStatus(status: string): asserts status is WorkstreamStatus {
  if (!WORKSTREAM_STATUSES.includes(status as WorkstreamStatus)) {
    throw new Error(`Invalid workstream status: ${status}`);
  }
}

export function assertValidMemoryStatus(
  status: string,
): asserts status is Extract<MemoryStatus, "active" | "proposed"> {
  if (status !== "active" && status !== "proposed") throw new Error("--status must be active or proposed");
}
