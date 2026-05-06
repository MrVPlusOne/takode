import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CURRENT_READ_PURPOSES,
  MEMORY_CHECK_EVENTS,
  MEMORY_BUCKETS,
  MEMORY_PRIORITIES,
  MEMORY_STATUSES,
  MEMORY_SUBTYPES,
  WORKSTREAM_STATUSES,
  type ActiveRunDetails,
  type ActorRef,
  type AppliesTo,
  type AuthorityBoundary,
  type BookkeepingReport,
  type CurrentReadQuery,
  type CurrentReadResult,
  type MemoryCheckFinding,
  type MemoryCheckInput,
  type MemoryCheckLevel,
  type MemoryCheckResult,
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
const CHECK_LEVEL_WEIGHT: Record<MemoryCheckLevel, number> = { recall: 1, warn: 2, gate: 3 };
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
        ...(input.activeRun !== undefined ? { activeRun: input.activeRun } : {}),
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
        ...(input.activeRun !== undefined ? { activeRun: input.activeRun } : {}),
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

export async function checkMemory(input: MemoryCheckInput): Promise<MemoryCheckResult> {
  validateMemoryCheckInput(input);
  const questId = input.questId ?? input.callerState?.questId;
  const workstreams = await resolveCheckWorkstreams(input, questId);
  const records = (
    await Promise.all(
      workstreams.map((workstream) =>
        listRecords({
          workstream: workstream.slug,
          includeRetired: false,
          includeProposed: false,
        }),
      ),
    )
  )
    .flat()
    .filter((record) => record.bucket === "current" && record.status === "active");
  const matchedRecords = records.filter((record) => recordMatchesCheckInput(record, input, questId));
  matchedRecords.sort(compareRecordsForRecall);

  const maxRecords = input.options?.maxRecords ?? 5;
  const visibleRecords = matchedRecords.slice(0, maxRecords);
  const findings = visibleRecords.map((record) => recallFinding(record));
  appendContextHygieneFindings(findings, matchedRecords, visibleRecords, input);
  await appendBookkeepingFindings(findings, input, workstreams);
  appendExecuteLaunchFindings(findings, records, input, questId);
  appendWorkerTurnEndFindings(findings, records, input, questId);
  appendPortPlanningFindings(findings, records, input);
  appendRecoveryFindings(findings, matchedRecords, input);

  const visibleFindings =
    input.options?.includeWarnings === false ? findings.filter((finding) => finding.level !== "warn") : findings;
  const level = highestLevel(visibleFindings);
  const requiredActions = visibleFindings
    .map((finding) => finding.requiredAction)
    .filter((action): action is string => Boolean(action));
  return {
    status: level === "recall" ? "ok" : level,
    level,
    event: input.event,
    enforceable: visibleFindings.some((finding) => finding.level === "gate" && finding.enforceable),
    ackRequired: visibleFindings.some((finding) => finding.ackRequired),
    findings: visibleFindings,
    requiredActions: [...new Set(requiredActions)],
    records: visibleRecords,
  };
}

export async function bookkeepingReport(workstreamRef?: string): Promise<BookkeepingReport> {
  const records = await listRecords({
    workstream: workstreamRef,
    includeRetired: true,
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
    if (record.retireWhen?.description.trim()) {
      report.issues.push({
        level: "info",
        record: ref,
        message: `retireWhen cleanup review candidate: ${record.retireWhen.description}. Expiry evaluation is manual in the foundation because retireWhen is free text and product state is not evaluated.`,
      });
    }
    if (record.status === "superseded") {
      report.issues.push({
        level: record.replacedBy ? "info" : "warn",
        record: ref,
        message: record.replacedBy
          ? `hidden superseded record replaced by ${record.replacedBy}; review the replacement chain during Bookkeeping cleanup.`
          : "hidden superseded record has no replacedBy target; review the replacement chain during Bookkeeping cleanup.",
      });
    } else if (record.status === "retired") {
      report.issues.push({
        level: "info",
        record: ref,
        message:
          "hidden retired record retained for history; review during Bookkeeping cleanup if it should remain hidden history.",
      });
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

async function resolveCheckWorkstreams(input: MemoryCheckInput, questId: string | undefined): Promise<Workstream[]> {
  if (input.workstream) return [await requireWorkstream(input.workstream)];
  if (!questId) throw new Error("Either workstream or questId is required");
  const workstreams = (await listWorkstreams()).filter((workstream) =>
    workstream.linkedQuests.some((quest) => quest.questId === questId),
  );
  if (workstreams.length === 0) throw new Error(`No workstream is linked to ${questId}`);
  return workstreams;
}

function validateMemoryCheckInput(input: MemoryCheckInput): void {
  if (!MEMORY_CHECK_EVENTS.includes(input.event)) {
    throw new Error(`Invalid memory check event: ${input.event}`);
  }
  if (input.callerState && input.callerState.kind !== input.event) {
    throw new Error(`Memory check state kind ${input.callerState.kind} does not match event ${input.event}`);
  }
  if (
    input.options?.maxRecords !== undefined &&
    (!Number.isInteger(input.options.maxRecords) || input.options.maxRecords <= 0)
  ) {
    throw new Error("Memory check maxRecords must be a positive integer");
  }
}

function recordMatchesCheckInput(record: MemoryRecord, input: MemoryCheckInput, questId: string | undefined): boolean {
  if (record.retrievalHooks.includes(input.event)) return true;
  if (record.appliesTo.actionTags?.includes(input.event)) return true;
  if (questId && record.appliesTo.questIds?.includes(questId)) return true;
  if (stateWorkerSessionNum(input) && record.appliesTo.workerSessionNums?.includes(stateWorkerSessionNum(input)!)) {
    return true;
  }
  if (stateComponentTags(input).some((tag) => record.appliesTo.componentTags?.includes(tag))) return true;
  if (stateTerms(input).some((term) => record.appliesTo.exactTerms?.includes(term))) return true;
  return false;
}

function compareRecordsForRecall(a: MemoryRecord, b: MemoryRecord): number {
  const priority = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (priority !== 0) return priority;
  return b.updatedAt.localeCompare(a.updatedAt) || a.key.localeCompare(b.key);
}

function recallFinding(record: MemoryRecord): MemoryCheckFinding {
  return {
    level: "recall",
    record: recordRef(record),
    priority: record.priority,
    source: "memory",
    why: [`matched active Current Context for ${record.retrievalHooks.join(", ") || "scoped context"}`],
    sources: sourceLabels(record),
    authorityBoundary: formatAuthorityBoundary(record.authorityBoundary),
    enforceable: false,
    ackRequired: record.priority === "blocking" || record.priority === "safety",
  };
}

function appendContextHygieneFindings(
  findings: MemoryCheckFinding[],
  matchedRecords: MemoryRecord[],
  visibleRecords: MemoryRecord[],
  input: MemoryCheckInput,
): void {
  if (matchedRecords.length > visibleRecords.length) {
    findings.push(warnFinding([`matched ${matchedRecords.length} current records; showing ${visibleRecords.length}`]));
  }
  for (const record of matchedRecords) {
    if (record.conflictsWith.length) {
      findings.push(
        warnFinding(
          [`active record declares conflicts: ${record.conflictsWith.map((conflict) => conflict.record).join(", ")}`],
          record,
        ),
      );
    }
    if (requiresRetireWhen(record) && !record.retireWhen?.description.trim()) {
      findings.push(warnFinding([`${record.subtype} record is missing retireWhen`], record));
    }
    if (looksProductStateLike(record.current) || looksProductStateLike(record.details ?? "")) {
      findings.push(
        warnFinding(
          ["current statement looks like live product state; memory should store policy/context only"],
          record,
        ),
      );
    }
  }
  if (
    input.productState?.source === "caller-supplied" &&
    matchedRecords.some((record) => record.priority === "safety")
  ) {
    findings.push(warnFinding(["caller-supplied product state cannot make safety gates enforceable"]));
  }
}

async function appendBookkeepingFindings(
  findings: MemoryCheckFinding[],
  input: MemoryCheckInput,
  workstreams: Workstream[],
): Promise<void> {
  if (input.event !== "bookkeeping") return;
  for (const workstream of workstreams) {
    const report = await bookkeepingReport(workstream.slug);
    for (const issue of report.issues.filter((item) => item.level === "warn")) {
      findings.push(
        warnFinding([issue.message], undefined, {
          recordRef: issue.record,
          sources: [`bookkeeping:${workstream.slug}`],
        }),
      );
    }
  }
}

function appendExecuteLaunchFindings(
  findings: MemoryCheckFinding[],
  records: MemoryRecord[],
  input: MemoryCheckInput,
  questId: string | undefined,
): void {
  if (input.event !== "execute-launch" || input.callerState?.kind !== "execute-launch") return;
  if (!input.callerState.longRunning) return;
  const activeRunRecords = records.filter((record) => activeRunRecordMatches(record, input, questId));
  if (activeRunRecords.length === 0) {
    findings.push(
      gateFinding(
        input,
        ["long-running Execute launch has no matching active-run Current Context dossier"],
        undefined,
        {
          requiredAction:
            "Create or identify an active-run Current Context dossier before treating Execute launch as handed off.",
        },
      ),
    );
    return;
  }
  if (!activeRunRecords.some((record) => record.activeRun?.monitorRequirement)) {
    findings.push(
      gateFinding(input, ["matching active-run dossier has no structured monitor requirement"], activeRunRecords[0], {
        requiredAction: "Add structured active-run monitor obligations before treating Execute launch as handed off.",
      }),
    );
  }
  const requiredProof = activeRunRecords.find((record) => record.activeRun?.monitorRequirement)?.activeRun
    ?.monitorRequirement.requiredProductProof;
  if (!hasRequiredMonitorProof(input, requiredProof)) {
    findings.push(
      gateFinding(input, ["trusted monitor timer or worker-hard-event proof is missing"], activeRunRecords[0], {
        requiredAction:
          "Create/prove a recurring monitor or worker-hard-event before treating Execute launch as handed off.",
      }),
    );
  }
}

function appendWorkerTurnEndFindings(
  findings: MemoryCheckFinding[],
  records: MemoryRecord[],
  input: MemoryCheckInput,
  questId: string | undefined,
): void {
  if (input.event !== "worker-turn-end" || input.callerState?.kind !== "worker-turn-end") return;
  if (!input.callerState.summarySignals?.length || input.callerState.reportedToUser) return;
  const activeRunRecords = records.filter((record) => activeRunRecordMatches(record, input, questId));
  findings.push(
    gateFinding(
      input,
      [`unreported active-run stop signals: ${input.callerState.summarySignals.join(", ")}`],
      activeRunRecords[0],
      {
        requiredAction:
          "Surface the stop-condition report to the leader/user or record an explicit acknowledgment before silent continuation.",
        source: trustedProductInput(input) || input.callerState.trusted ? "product-adapter" : "caller-supplied",
      },
    ),
  );
}

function appendPortPlanningFindings(
  findings: MemoryCheckFinding[],
  records: MemoryRecord[],
  input: MemoryCheckInput,
): void {
  if (input.event !== "port-planning" || input.callerState?.kind !== "port-planning") return;
  for (const conflict of input.callerState.policyConflicts ?? []) {
    const record = records.find((candidate) => recordRef(candidate) === conflict.record);
    findings.push(
      gateFinding(
        input,
        [`product state conflicts with active port policy: expected ${conflict.expected}, actual ${conflict.actual}`],
        record,
        {
          requiredAction:
            "Resolve or explicitly acknowledge the branch/deployment policy conflict before port planning continues.",
          source: conflict.source ?? productFindingSource(input),
        },
      ),
    );
  }
}

function appendRecoveryFindings(
  findings: MemoryCheckFinding[],
  visibleRecords: MemoryRecord[],
  input: MemoryCheckInput,
): void {
  if (input.event !== "recovery" && input.event !== "compaction") return;
  if (input.callerState?.kind !== "recovery" && input.callerState?.kind !== "compaction") return;
  const surfaced = new Set([
    ...(input.callerState.surfacedRecordRefs ?? []),
    ...(input.callerState.acknowledgedRecordRefs ?? []),
  ]);
  for (const record of visibleRecords.filter(isRecoveryCriticalRecord)) {
    if (surfaced.has(recordRef(record))) continue;
    findings.push(
      gateFinding(input, ["recovery-critical Current Context was not surfaced or acknowledged"], record, {
        requiredAction:
          "Surface or acknowledge recovery-critical Current Context before continuing after recovery/compaction.",
      }),
    );
  }
}

function activeRunRecordMatches(record: MemoryRecord, input: MemoryCheckInput, questId: string | undefined): boolean {
  if (record.subtype !== "active-run" || record.bucket !== "current" || record.status !== "active") return false;
  if (questId) {
    return record.activeRun?.linkedQuestId === questId || (record.appliesTo.questIds?.includes(questId) ?? false);
  }
  if (record.retrievalHooks.includes(input.event)) return true;
  return record.appliesTo.actionTags?.includes(input.event) ?? false;
}

function hasRequiredMonitorProof(
  input: MemoryCheckInput,
  requiredProof: ActiveRunDetails["monitorRequirement"]["requiredProductProof"] | undefined,
): boolean {
  if (input.productState?.source !== "product-adapter" || input.productState.trusted !== true) return false;
  const proofs = input.productState.proofs ?? [];
  if (proofs.length === 0) return false;
  return proofs.some((proof) => proofSatisfiesMonitorRequirement(proof, requiredProof));
}

function proofSatisfiesMonitorRequirement(
  proof: { kind: string; trusted?: boolean; ok?: boolean },
  requiredProof: ActiveRunDetails["monitorRequirement"]["requiredProductProof"] | undefined,
): boolean {
  if (proof.ok === false) return false;
  if (proof.trusted === false) return false;
  if (requiredProof === "timer") return proof.kind === "timer";
  if (requiredProof === "worker-hard-event") return proof.kind === "worker-hard-event";
  return proof.kind === "timer" || proof.kind === "worker-hard-event";
}

function isRecoveryCriticalRecord(record: MemoryRecord): boolean {
  if (record.priority !== "blocking" && record.priority !== "safety") return false;
  return (
    record.retrievalHooks.includes("recovery") ||
    record.retrievalHooks.includes("compaction") ||
    record.appliesTo.actionTags?.includes("recovery-critical") ||
    record.appliesTo.exactTerms?.includes("recovery-critical") ||
    false
  );
}

function warnFinding(
  why: string[],
  record?: MemoryRecord,
  options: { recordRef?: string; sources?: string[] } = {},
): MemoryCheckFinding {
  return {
    level: "warn",
    ...(record ? { record: recordRef(record), priority: record.priority } : {}),
    ...(!record && options.recordRef ? { record: options.recordRef } : {}),
    source: "memory",
    why,
    sources: options.sources ?? (record ? sourceLabels(record) : []),
    ...(record ? { authorityBoundary: formatAuthorityBoundary(record.authorityBoundary) } : {}),
    enforceable: false,
    ackRequired: false,
  };
}

function gateFinding(
  input: MemoryCheckInput,
  why: string[],
  record: MemoryRecord | undefined,
  options: { requiredAction: string; source?: MemoryCheckFinding["source"] },
): MemoryCheckFinding {
  const enforceable = trustedProductInput(input) && input.options?.enforce !== false;
  return {
    level: "gate",
    ...(record ? { record: recordRef(record), priority: record.priority } : {}),
    source: options.source ?? productFindingSource(input),
    why,
    requiredAction: options.requiredAction,
    sources: record ? sourceLabels(record) : [],
    ...(record ? { authorityBoundary: formatAuthorityBoundary(record.authorityBoundary) } : {}),
    enforceable,
    ackRequired: true,
  };
}

function highestLevel(findings: MemoryCheckFinding[]): MemoryCheckLevel {
  return findings.reduce<MemoryCheckLevel>(
    (highest, finding) => (CHECK_LEVEL_WEIGHT[finding.level] > CHECK_LEVEL_WEIGHT[highest] ? finding.level : highest),
    "recall",
  );
}

function stateWorkerSessionNum(input: MemoryCheckInput): number | undefined {
  const state = input.callerState;
  if (!state || !("workerSessionNum" in state)) return undefined;
  return state.workerSessionNum;
}

function stateComponentTags(input: MemoryCheckInput): string[] {
  const state = input.callerState;
  if (!state || !("componentTags" in state)) return [];
  return state.componentTags ?? [];
}

function stateTerms(input: MemoryCheckInput): string[] {
  const state = input.callerState;
  if (!state || !("terms" in state)) return [];
  return state.terms ?? [];
}

function trustedProductInput(input: MemoryCheckInput): boolean {
  return input.productState?.source === "product-adapter" && input.productState.trusted === true;
}

function productFindingSource(input: MemoryCheckInput): MemoryCheckFinding["source"] {
  return trustedProductInput(input) ? "product-adapter" : "caller-supplied";
}

function recordRef(record: MemoryRecord): string {
  return `${record.workstreamSlug}/${record.key}`;
}

function sourceLabels(record: MemoryRecord): string[] {
  return record.evidence.map((source) => source.target || source.label);
}

function formatAuthorityBoundary(boundary: AuthorityBoundary): string {
  return `${boundary.authoritativeSystem} proves live facts; memory owns ${boundary.memoryOwns}.`;
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
  if (record.activeRun && record.subtype !== "active-run")
    throw new Error("activeRun details require subtype active-run");
  if (record.activeRun) validateActiveRunDetails(record.activeRun);
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

function validateActiveRunDetails(details: ActiveRunDetails): void {
  if (!/^q-\d+$/i.test(details.linkedQuestId)) throw new Error("activeRun.linkedQuestId must be a quest ID");
  if (
    details.runOwnerSessionNum !== undefined &&
    (!Number.isInteger(details.runOwnerSessionNum) || details.runOwnerSessionNum <= 0)
  ) {
    throw new Error("activeRun.runOwnerSessionNum must be a positive integer");
  }
  if (
    !["planned", "launching", "active-obligation", "handoff-required", "stop-required"].includes(
      details.expectedRunState,
    )
  ) {
    throw new Error(`Invalid activeRun.expectedRunState: ${details.expectedRunState}`);
  }
  const monitor = details.monitorRequirement;
  if (!Number.isInteger(monitor.cadenceMinutes) || monitor.cadenceMinutes <= 0) {
    throw new Error("activeRun.monitorRequirement.cadenceMinutes must be a positive integer");
  }
  if (!["timer", "worker-hard-event", "timer-or-hard-event"].includes(monitor.requiredProductProof)) {
    throw new Error(`Invalid activeRun.monitorRequirement.requiredProductProof: ${monitor.requiredProductProof}`);
  }
  if (!Array.isArray(details.stopConditions)) throw new Error("activeRun.stopConditions must be an array");
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
