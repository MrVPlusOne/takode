#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { workstreamMemoryService } from "../server/workstream-memory-service.js";
import {
  CURRENT_READ_PURPOSES,
  MEMORY_CHECK_EVENTS,
  MEMORY_PRIORITIES,
  MEMORY_STATUSES,
  MEMORY_SUBTYPES,
  type ActiveRunDetails,
  type AppliesTo,
  type CurrentReadPurpose,
  type MemoryCheckEvent,
  type MemoryCheckInput,
  type MemoryBucket,
  type MemoryPriority,
  type MemoryRecord,
  type MemoryStatus,
  type MemorySubtype,
  type ReferenceTarget,
  type RetrievalHook,
  type SourceLink,
  type Workstream,
} from "../server/workstream-memory-types.js";
import { assertValidMemoryStatus, parseAuthorityBoundary, parseSourceLink } from "../server/workstream-memory-store.js";

const args = process.argv.slice(2);
const command = args[0];
const jsonOutput = flag("json");
const LINKED_QUEST_ROLES = ["deliverable", "dashboard", "bug", "follow-up", "evidence", "other"] as const;
type LinkedQuestRole = (typeof LINKED_QUEST_ROLES)[number];

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("--")) return args[index + 1];
  return undefined;
}

function options(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === `--${name}` && args[index + 1] && !args[index + 1].startsWith("--")) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function positional(index: number): string | undefined {
  let current = 0;
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
      continue;
    }
    if (current === index) return args[i];
    current += 1;
  }
  return undefined;
}

function die(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function printUsage(): void {
  console.log(`Usage: memory <command> [args]

Commands:
  workstream create|link|show|list|archive
  current read
  grep <pattern>
  show <workstream>/<key>
  upsert current|reference <workstream>/<key>
  retire <workstream>/<key>
  check --event <event>
  bookkeeping report

Use --json for structured output.`);
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function readTextOption(inlineFlag: string, fileFlag: string): Promise<string | undefined> {
  const inline = option(inlineFlag);
  const file = option(fileFlag);
  if (inline !== undefined && file !== undefined) die(`Use either --${inlineFlag} or --${fileFlag}, not both`);
  if (inline !== undefined) return inline;
  if (file === undefined) return undefined;
  if (file === "-") {
    process.stdin.setEncoding("utf8");
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    return text;
  }
  try {
    return await readFile(resolve(file), "utf-8");
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    die(`Cannot read --${fileFlag} from ${file}${detail}`);
  }
}

async function readJsonOption<T>(fileFlag: string): Promise<T | undefined> {
  const file = option(fileFlag);
  if (!file) return undefined;
  try {
    const raw = await readFile(resolve(file), "utf-8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    die(`Cannot read --${fileFlag} from ${file}${detail}`);
  }
}

function parseSources(): SourceLink[] {
  return [...options("source"), ...parseCsv(option("sources"))].map(parseSourceLink);
}

function requireSources(): SourceLink[] {
  const sources = parseSources();
  if (sources.length === 0) die("--source is required");
  return sources;
}

function parseMemorySubtype(raw: string | undefined): MemorySubtype {
  const value = raw ?? "";
  if (MEMORY_SUBTYPES.includes(value as MemorySubtype)) return value as MemorySubtype;
  die(`--subtype must be one of: ${MEMORY_SUBTYPES.join(", ")}`);
}

function parsePriority(raw: string | undefined): MemoryPriority {
  const value = raw ?? "";
  if (MEMORY_PRIORITIES.includes(value as MemoryPriority)) return value as MemoryPriority;
  die(`--priority must be one of: ${MEMORY_PRIORITIES.join(", ")}`);
}

function parseLinkedQuestRole(raw: string | undefined): LinkedQuestRole {
  const value = raw ?? "deliverable";
  if (LINKED_QUEST_ROLES.includes(value as LinkedQuestRole)) return value as LinkedQuestRole;
  die(`--role must be one of: ${LINKED_QUEST_ROLES.join(", ")}`);
}

function parseStatus(raw: string | undefined): Extract<MemoryStatus, "active" | "proposed"> | undefined {
  if (!raw) return undefined;
  assertValidMemoryStatus(raw);
  return raw;
}

function parsePurpose(raw: string | undefined): CurrentReadPurpose {
  const value = raw ?? "";
  if (CURRENT_READ_PURPOSES.includes(value as CurrentReadPurpose)) return value as CurrentReadPurpose;
  die(`--for must be one of: ${CURRENT_READ_PURPOSES.join(", ")}`);
}

function parseCheckEvent(raw: string | undefined): MemoryCheckEvent {
  const value = raw ?? "";
  if (MEMORY_CHECK_EVENTS.includes(value as MemoryCheckEvent)) return value as MemoryCheckEvent;
  die(`--event must be one of: ${MEMORY_CHECK_EVENTS.join(", ")}`);
}

function parseHooks(): RetrievalHook[] {
  const values = [...options("retrieval-hook"), ...parseCsv(option("retrieval-hooks"))];
  for (const value of values) {
    if (!CURRENT_READ_PURPOSES.includes(value as RetrievalHook)) {
      die(`Invalid retrieval hook "${value}". Valid values: ${CURRENT_READ_PURPOSES.join(", ")}`);
    }
  }
  return values as RetrievalHook[];
}

function parseAppliesTo(): AppliesTo {
  const tokens = [...options("applies-to"), ...parseCsv(option("applies-to"))];
  const appliesTo: AppliesTo = {};
  for (const token of tokens) {
    const [rawKind, rawValue] = token.split(":", 2);
    const kind = rawKind?.trim();
    const value = rawValue?.trim();
    if (!kind || !value) die(`Invalid --applies-to token: ${token}`);
    switch (kind) {
      case "quest":
        appliesTo.questIds = [...(appliesTo.questIds ?? []), value];
        break;
      case "session":
        appliesTo.sessionNums = [...(appliesTo.sessionNums ?? []), parsePositiveInt(value, token)];
        break;
      case "worker":
        appliesTo.workerSessionNums = [...(appliesTo.workerSessionNums ?? []), parsePositiveInt(value, token)];
        break;
      case "component":
        appliesTo.componentTags = [...(appliesTo.componentTags ?? []), value];
        break;
      case "domain":
        appliesTo.domainTags = [...(appliesTo.domainTags ?? []), value];
        break;
      case "action":
      case "event":
        appliesTo.actionTags = [...(appliesTo.actionTags ?? []), value];
        break;
      case "term":
        appliesTo.exactTerms = [...(appliesTo.exactTerms ?? []), value];
        break;
      default:
        die(`Unknown --applies-to token kind "${kind}" in ${token}`);
    }
  }
  return appliesTo;
}

function parsePositiveInt(raw: string, label: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) die(`Expected a positive integer for ${label}`);
  return parsed;
}

function parseReferenceTarget(): ReferenceTarget | undefined {
  const target = option("target");
  if (!target) return undefined;
  const kind = option("target-kind") ?? "external";
  const label = option("target-label") ?? target;
  return { kind: kind as ReferenceTarget["kind"], target, label };
}

function formatWorkstreamLine(workstream: Workstream): string {
  const tags = workstream.scopeTags.length ? ` [${workstream.scopeTags.join(",")}]` : "";
  return `${workstream.slug} (${workstream.status})${tags}: ${workstream.title}`;
}

function formatWorkstream(workstream: Workstream): string {
  const lines = [
    `Workstream ${workstream.slug}`,
    `Title:       ${workstream.title}`,
    `Status:      ${workstream.status}`,
    `Objective:   ${workstream.objective}`,
  ];
  if (workstream.scopeTags.length) lines.push(`Tags:        ${workstream.scopeTags.join(", ")}`);
  if (workstream.linkedQuests.length) {
    lines.push("Linked Quests:");
    for (const quest of workstream.linkedQuests) {
      lines.push(`  - ${quest.questId} (${quest.role})${quest.label ? ` ${quest.label}` : ""}`);
    }
  }
  if (workstream.sourceLinks.length) {
    lines.push(`Sources:     ${workstream.sourceLinks.map((source) => source.label).join(", ")}`);
  }
  if (workstream.migrationSources.length) {
    lines.push(`Migration:   ${workstream.migrationSources.map((source) => source.target).join(", ")}`);
  }
  return lines.join("\n");
}

function formatRecordLine(record: MemoryRecord): string {
  return `${record.workstreamSlug}/${record.key} [${record.bucket}, ${record.status}, ${record.priority}] ${record.title}: ${compact(
    record.current,
    120,
  )}`;
}

function formatRecord(record: MemoryRecord, includeHistory = false): string {
  const lines = [
    `Memory ${record.workstreamSlug}/${record.key}`,
    `Title:       ${record.title}`,
    `Bucket:      ${record.bucket}`,
    `Subtype:     ${record.subtype}`,
    `Status:      ${record.status}`,
    `Priority:    ${record.priority}`,
    `Updated:     ${record.updatedAt}`,
    "",
    "Current:",
    record.current,
  ];
  if (record.details) lines.push("", "Details:", record.details);
  if (record.target) lines.push("", `Target:      ${record.target.label} (${record.target.target})`);
  if (record.retrievalHooks.length) lines.push(`Hooks:       ${record.retrievalHooks.join(", ")}`);
  if (record.evidence.length) lines.push(`Sources:     ${record.evidence.map((source) => source.label).join(", ")}`);
  if (record.retireWhen) lines.push(`Retire when: ${record.retireWhen.description}`);
  if (includeHistory) {
    lines.push("", "History:");
    for (const version of record.history) {
      lines.push(`  - v${version.version} ${version.status} ${version.updatedAt}: ${compact(version.current, 120)}`);
      if (version.reason) lines.push(`    reason: ${version.reason}`);
    }
  }
  return lines.join("\n");
}

function compact(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

async function handleWorkstream(): Promise<void> {
  const subcommand = args[1];
  switch (subcommand) {
    case "create": {
      const slug = option("slug");
      const title = option("title");
      const objective = option("objective");
      if (!slug) die("--slug is required");
      if (!title) die("--title is required");
      if (!objective) die("--objective is required");
      const workstream = await workstreamMemoryService.createWorkstream({
        slug,
        title,
        objective,
        scopeTags: parseCsv(option("scope-tags")),
        ownerProject: option("owner-project"),
        sourceLinks: parseSources(),
        migrationSources: options("migration-source").map((target) => ({ kind: "manual", target })),
        visibility: (option("visibility") as Workstream["visibility"] | undefined) ?? "default",
      });
      jsonOutput ? out({ workstream }) : console.log(formatWorkstream(workstream));
      return;
    }
    case "link": {
      const workstream = args[2];
      if (!workstream) die("Usage: memory workstream link <slug> --quest q-N [--role deliverable]");
      const role = parseLinkedQuestRole(option("role"));
      const label = option("label");
      const quests = [...options("quest"), ...parseCsv(option("quests"))].map((questId) => ({
        questId,
        role,
        ...(label ? { label } : {}),
      }));
      if (quests.length === 0) die("--quest is required");
      const updated = await workstreamMemoryService.linkWorkstream({ workstream, quests });
      jsonOutput ? out({ workstream: updated }) : console.log(formatWorkstream(updated));
      return;
    }
    case "show": {
      const ref = args[2];
      if (!ref) die("Usage: memory workstream show <slug>");
      const workstream = await workstreamMemoryService.getWorkstream(ref, {
        includeArchived: flag("include-archived"),
      });
      if (!workstream) die(`Workstream not found: ${ref}`);
      jsonOutput ? out({ workstream }) : console.log(formatWorkstream(workstream));
      return;
    }
    case "list": {
      const status = option("status");
      if (status && !["active", "paused", "completed", "archived"].includes(status)) die("Invalid --status");
      const workstreams = await workstreamMemoryService.listWorkstreams({
        status: status as Workstream["status"] | undefined,
        tag: option("tag"),
        includeArchived: flag("include-archived"),
      });
      jsonOutput
        ? out({ workstreams })
        : console.log(workstreams.map(formatWorkstreamLine).join("\n") || "No workstreams found.");
      return;
    }
    case "archive": {
      const ref = args[2];
      if (!ref) die("Usage: memory workstream archive <slug>");
      const workstream = await workstreamMemoryService.archiveWorkstream(ref);
      jsonOutput ? out({ workstream }) : console.log(`Archived workstream ${workstream.slug}`);
      return;
    }
    default:
      die("Usage: memory workstream create|link|show|list|archive");
  }
}

async function handleCurrent(): Promise<void> {
  if (args[1] !== "read") die("Usage: memory current read --workstream <slug>|--quest <q-id> --for <purpose>");
  const purpose = parsePurpose(option("for"));
  const result = await workstreamMemoryService.readCurrentContext({
    workstream: option("workstream"),
    questId: option("quest"),
    purpose,
    componentTags: parseCsv(option("component-tag")),
    workerSessionNum: option("worker") ? parsePositiveInt(option("worker")!, "--worker") : undefined,
    includeProposed: flag("include-proposed"),
    includeRetired: flag("include-retired"),
    limit: option("limit") ? parsePositiveInt(option("limit")!, "--limit") : undefined,
  });
  if (jsonOutput) {
    out(result);
    return;
  }
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  console.log(result.records.map(formatRecordLine).join("\n") || "No current context matched.");
}

async function handleGrep(): Promise<void> {
  const pattern = positional(0);
  if (!pattern) die("Usage: memory grep <pattern>");
  const results = await workstreamMemoryService.searchRecords({
    pattern,
    regex: flag("regex"),
    workstream: option("workstream"),
    includeRetired: flag("include-retired"),
    includeProposed: flag("include-proposed"),
    limit: option("limit") ? parsePositiveInt(option("limit")!, "--limit") : undefined,
  });
  if (jsonOutput) {
    out({ results });
    return;
  }
  if (results.length === 0) {
    console.log("No matches.");
    return;
  }
  for (const result of results) {
    console.log(formatRecordLine(result.record));
    for (const snippet of result.snippets) console.log(`  ${snippet}`);
    if (result.remainingChildMatches) console.log(`  ... ${result.remainingChildMatches} more matches`);
  }
}

async function handleShow(): Promise<void> {
  const ref = args[1];
  if (!ref) die("Usage: memory show <workstream>/<key>");
  const record = await workstreamMemoryService.getRecord(ref, {
    includeRetired: flag("include-retired"),
    includeArchived: flag("include-archived"),
  });
  if (!record) die(`Memory record not found: ${ref}`);
  jsonOutput ? out({ record }) : console.log(formatRecord(record, flag("history")));
}

async function handleUpsert(): Promise<void> {
  const bucket = args[1] as MemoryBucket | undefined;
  const ref = args[2];
  if (bucket !== "current" && bucket !== "reference") die("Usage: memory upsert current|reference <workstream>/<key>");
  if (!ref) die("Usage: memory upsert current|reference <workstream>/<key>");
  const current = await readTextOption("current", "current-file");
  const details = await readTextOption("details", "details-file");
  const activeRun = await readJsonOption<ActiveRunDetails>("active-run-file");
  if (!current?.trim()) die("--current or --current-file is required");
  const status = parseStatus(option("status"));
  const record = await workstreamMemoryService.upsertRecord({
    ref,
    bucket,
    subtype: parseMemorySubtype(option("subtype")),
    priority: parsePriority(option("priority")),
    title: option("title"),
    current,
    details,
    target: parseReferenceTarget(),
    appliesTo: parseAppliesTo(),
    retrievalHooks: parseHooks(),
    evidence: requireSources(),
    authorityBoundary: parseAuthorityBoundary(option("authority-boundary") ?? ""),
    activationScope:
      (option("activation-scope") as "workstream" | "quest" | "component" | "project" | undefined) ?? "workstream",
    status,
    retireWhen: option("retire-when") ? { description: option("retire-when")! } : undefined,
    supersedes: parseCsv(option("supersedes")),
    activeRun,
    reactivate: flag("reactivate"),
  });
  jsonOutput ? out({ record }) : console.log(formatRecord(record));
}

async function handleRetire(): Promise<void> {
  const ref = positional(0);
  if (!ref) die("Usage: memory retire <workstream>/<key> --reason <text> --source <source>");
  const reason = option("reason");
  if (!reason) die("--reason is required");
  const record = await workstreamMemoryService.retireRecord({
    ref,
    reason,
    sourceLinks: requireSources(),
    supersededBy: option("superseded-by"),
  });
  jsonOutput ? out({ record }) : console.log(`Retired ${record.workstreamSlug}/${record.key}`);
}

async function handleBookkeeping(): Promise<void> {
  if (args[1] !== "report") die("Usage: memory bookkeeping report [--workstream <slug>]");
  const report = await workstreamMemoryService.bookkeepingReport(option("workstream"));
  if (jsonOutput) {
    out({ report });
    return;
  }
  console.log(`Bookkeeping report ${report.generatedAt}`);
  if (report.issues.length === 0) {
    console.log("No issues found.");
    return;
  }
  for (const issue of report.issues) {
    console.log(`${issue.level.toUpperCase()}: ${issue.record ? `${issue.record}: ` : ""}${issue.message}`);
  }
}

async function handleCheck(): Promise<void> {
  const event = parseCheckEvent(option("event"));
  const callerState = await readJsonOption<MemoryCheckInput["callerState"]>("state-file");
  const productState = await readJsonOption<MemoryCheckInput["productState"]>("product-state-file");
  const result = await workstreamMemoryService.checkMemory({
    event,
    workstream: option("workstream"),
    questId: option("quest"),
    callerState,
    productState,
    options: {
      enforce: flag("enforce"),
      includeWarnings: !flag("no-warnings"),
      maxRecords: option("limit") ? parsePositiveInt(option("limit")!, "--limit") : undefined,
    },
  });
  if (jsonOutput) {
    out(result);
    return;
  }
  console.log(`Memory check ${result.event}: ${result.level}${result.enforceable ? " (enforceable)" : ""}`);
  for (const finding of result.findings) {
    const record = finding.record ? `${finding.record}: ` : "";
    console.log(`${finding.level.toUpperCase()}: ${record}${finding.why.join("; ")}`);
    if (finding.requiredAction) console.log(`  action: ${finding.requiredAction}`);
  }
  if (result.findings.length === 0) console.log("No matching current context.");
}

try {
  switch (command) {
    case undefined:
    case "help":
    case "-h":
    case "--help":
      printUsage();
      break;
    case "workstream":
      await handleWorkstream();
      break;
    case "current":
      await handleCurrent();
      break;
    case "grep":
      await handleGrep();
      break;
    case "show":
      await handleShow();
      break;
    case "upsert":
      await handleUpsert();
      break;
    case "retire":
      await handleRetire();
      break;
    case "check":
      await handleCheck();
      break;
    case "bookkeeping":
      await handleBookkeeping();
      break;
    default:
      die(`Unknown command: ${command}`);
  }
} catch (error) {
  die(error instanceof Error ? error.message : String(error));
}
