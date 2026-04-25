#!/usr/bin/env bun

import { readFile } from "node:fs/promises";
import {
  archiveStream,
  createStream,
  defaultStreamScope,
  getStream,
  getStreamDashboard,
  listStreams,
  searchStreams,
  updateStream,
} from "../server/stream-store.js";
import type {
  StreamCurrentState,
  StreamEntryType,
  StreamLink,
  StreamOwner,
  StreamRecord,
  StreamStatus,
  StreamSteeringMode,
} from "../server/stream-types.js";

const args = process.argv.slice(2);
const command = args[0];
const jsonOutput = flag("json");

const ENTRY_TYPES = new Set<StreamEntryType>([
  "state-change",
  "decision",
  "artifact",
  "metric",
  "alert",
  "contradiction",
  "supersession",
  "handoff",
  "ownership",
  "verification",
  "note",
]);
const STATUSES = new Set<StreamStatus>(["active", "paused", "blocked", "archived", "superseded"]);
const STEERING_MODES = new Set<StreamSteeringMode>(["leader-steered", "user-steered", "monitor-only", "blocked"]);
const CONFIDENCES = new Set(["observed", "inferred", "user-confirmed"] as const);
type StreamConfidence = typeof CONFIDENCES extends Set<infer T> ? T : never;

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function option(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith("--")) return args[idx + 1];
  return undefined;
}

function options(name: string): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && args[i + 1] && !args[i + 1].startsWith("--")) {
      result.push(args[i + 1]);
      i += 1;
    }
  }
  return result;
}

function positional(index: number): string | undefined {
  let pos = 0;
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (args[i + 1] && !args[i + 1].startsWith("--")) i += 1;
      continue;
    }
    if (pos === index) return args[i];
    pos += 1;
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

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function parseScope(): Promise<string> {
  return option("scope")?.trim() || (await defaultStreamScope());
}

function parseStatus(value: string | undefined): StreamStatus | undefined {
  if (!value) return undefined;
  if (STATUSES.has(value as StreamStatus)) return value as StreamStatus;
  die(`--status must be one of: ${[...STATUSES].join(", ")}`);
}

function parseEntryType(): StreamEntryType {
  const value = option("type") ?? "note";
  if (ENTRY_TYPES.has(value as StreamEntryType)) return value as StreamEntryType;
  die(`--type must be one of: ${[...ENTRY_TYPES].join(", ")}`);
}

function parseSteeringMode(raw: string | undefined): StreamSteeringMode | undefined {
  if (!raw) return undefined;
  if (STEERING_MODES.has(raw as StreamSteeringMode)) return raw as StreamSteeringMode;
  die(`--steering-mode must be one of: ${[...STEERING_MODES].join(", ")}`);
}

function parseConfidence(raw: string | undefined): StreamConfidence | undefined {
  if (!raw) return undefined;
  if (CONFIDENCES.has(raw as StreamConfidence)) return raw as StreamConfidence;
  die(`--confidence must be one of: ${[...CONFIDENCES].join(", ")}`);
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
    return await readFile(file, "utf-8");
  } catch (error) {
    const detail = error instanceof Error ? `: ${error.message}` : "";
    die(`Cannot read --${fileFlag} from ${file}${detail}`);
  }
}

function buildLinks(): StreamLink[] {
  const links: StreamLink[] = [];
  for (const quest of [...options("quest"), ...parseCsv(option("quests"))]) links.push({ type: "quest", ref: quest });
  for (const session of [...options("session"), ...parseCsv(option("sessions"))]) {
    links.push({ type: "session", ref: session });
  }
  for (const worker of [...options("worker"), ...parseCsv(option("workers"))])
    links.push({ type: "worker", ref: worker });
  for (const message of [...options("message"), ...parseCsv(option("messages"))])
    links.push({ type: "message", ref: message });
  for (const stream of [...options("stream"), ...parseCsv(option("streams"))])
    links.push({ type: "stream", ref: stream });
  for (const source of options("source")) links.push({ type: "source", ref: source });
  for (const artifact of [...options("artifact"), ...parseCsv(option("artifacts"))]) {
    links.push({ type: "artifact", ref: artifact });
  }
  return links;
}

function buildOwners(): StreamOwner[] {
  const steeringMode = parseSteeringMode(option("steering-mode"));
  return [...options("owner"), ...parseCsv(option("owners"))].map((ref) => ({
    ref,
    role: option("owner-role"),
    steeringMode,
  }));
}

function buildStatePatch(): Partial<StreamCurrentState> | undefined {
  const patch: Partial<StreamCurrentState> = {
    summary: option("state") ?? option("summary"),
    health: option("health"),
    operationalStatus: option("operational-status"),
    paperworkStatus: option("paperwork-status"),
    blockedOn: option("blocked-on"),
    nextCheckAt: option("next-check"),
    lastVerifiedAt: option("last-verified"),
  };
  const openDecisions = [...options("decision-needed"), ...parseCsv(option("open-decisions"))];
  const staleFacts = [...options("known-stale"), ...parseCsv(option("known-stale-facts"))];
  const activeTimers = [...options("timer"), ...parseCsv(option("timers"))];
  if (openDecisions.length) patch.openDecisions = openDecisions;
  if (staleFacts.length) patch.knownStaleFacts = staleFacts;
  if (activeTimers.length) patch.activeTimers = activeTimers;
  return Object.values(patch).some((value) => (Array.isArray(value) ? value.length > 0 : value)) ? patch : undefined;
}

function compact(text: string, max = 90): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 3)}...`;
}

function formatTime(ts: number): string {
  return new Date(ts).toISOString();
}

function formatStreamLine(stream: StreamRecord): string {
  const tags = stream.tags?.length ? ` [${stream.tags.join(",")}]` : "";
  const summary = stream.current.summary ? ` - ${compact(stream.current.summary, 100)}` : "";
  return `${stream.id} ${stream.slug} (${stream.status})${tags}: ${stream.title}${summary}`;
}

function formatLinks(links: StreamLink[] | undefined): string {
  if (!links?.length) return "";
  return links.map((link) => `${link.type}:${link.ref}`).join(", ");
}

function formatShow(stream: StreamRecord): string {
  const lines: string[] = [];
  lines.push(`Stream ${stream.id} (${stream.slug})`);
  lines.push(`Title:       ${stream.title}`);
  lines.push(`Status:      ${stream.status}`);
  lines.push(`Scope:       ${stream.scope}`);
  if (stream.description) lines.push(`Description: ${stream.description}`);
  if (stream.tags?.length) lines.push(`Tags:        ${stream.tags.join(", ")}`);
  if (stream.parentId) lines.push(`Parent:      ${stream.parentId}`);
  lines.push(`Updated:     ${formatTime(stream.updatedAt)}`);
  lines.push("");
  lines.push("Current State:");
  lines.push(`  Summary: ${stream.current.summary || "(none)"}`);
  if (stream.current.health) lines.push(`  Health: ${stream.current.health}`);
  if (stream.current.operationalStatus) lines.push(`  Operational: ${stream.current.operationalStatus}`);
  if (stream.current.paperworkStatus) lines.push(`  Paperwork: ${stream.current.paperworkStatus}`);
  if (stream.current.blockedOn) lines.push(`  Blocked on: ${stream.current.blockedOn}`);
  if (stream.current.nextCheckAt) lines.push(`  Next check: ${stream.current.nextCheckAt}`);
  if (stream.current.lastVerifiedAt) lines.push(`  Last verified: ${stream.current.lastVerifiedAt}`);
  if (stream.current.openDecisions?.length) lines.push(`  Decisions: ${stream.current.openDecisions.join("; ")}`);
  if (stream.current.knownStaleFacts?.length) lines.push(`  Stale facts: ${stream.current.knownStaleFacts.join("; ")}`);
  if (stream.current.activeTimers?.length) lines.push(`  Timers: ${stream.current.activeTimers.join(", ")}`);
  if (stream.owners?.length) {
    lines.push("");
    lines.push("Owners:");
    for (const owner of stream.owners) {
      lines.push(
        `  - ${owner.ref}${owner.role ? ` (${owner.role})` : ""}${owner.steeringMode ? ` ${owner.steeringMode}` : ""}`,
      );
    }
  }
  if (stream.links?.length) {
    lines.push("");
    lines.push(`Links: ${formatLinks(stream.links)}`);
  }
  if (stream.pinnedFacts?.length) {
    lines.push("");
    lines.push("Pinned Facts:");
    for (const fact of stream.pinnedFacts) {
      lines.push(`  - ${fact.id} [${fact.status}] ${fact.text}${fact.source ? ` (${fact.source})` : ""}`);
    }
  }
  lines.push("");
  lines.push("Timeline:");
  if (stream.timeline.length === 0) {
    lines.push("  (no entries)");
  } else {
    for (const entry of stream.timeline.slice().reverse()) {
      lines.push(`  - ${entry.id} [${entry.type}] ${formatTime(entry.ts)} ${compact(entry.text, 140)}`);
      if (entry.source) lines.push(`    source: ${entry.source}`);
      if (entry.links?.length) lines.push(`    links: ${formatLinks(entry.links)}`);
      if (entry.artifacts?.length) lines.push(`    artifacts: ${entry.artifacts.join(", ")}`);
    }
  }
  return lines.join("\n");
}

function formatHandoff(stream: StreamRecord): string {
  const lines: string[] = [];
  lines.push(`Handoff for ${stream.id} ${stream.slug}: ${stream.title}`);
  lines.push(`Status: ${stream.status}`);
  lines.push(`Current: ${stream.current.summary || "(none)"}`);
  if (stream.current.health) lines.push(`Health: ${stream.current.health}`);
  if (stream.current.operationalStatus) lines.push(`Operational status: ${stream.current.operationalStatus}`);
  if (stream.current.blockedOn) lines.push(`Blocked on: ${stream.current.blockedOn}`);
  if (stream.current.nextCheckAt) lines.push(`Next check: ${stream.current.nextCheckAt}`);
  if (stream.owners?.length) {
    lines.push(
      `Owners: ${stream.owners.map((owner) => `${owner.ref}${owner.steeringMode ? `/${owner.steeringMode}` : ""}`).join(", ")}`,
    );
  }
  if (stream.current.openDecisions?.length) lines.push(`Open decisions: ${stream.current.openDecisions.join("; ")}`);
  if (stream.current.knownStaleFacts?.length)
    lines.push(`Known stale facts: ${stream.current.knownStaleFacts.join("; ")}`);
  if (stream.pinnedFacts?.length) {
    lines.push("Pinned facts:");
    for (const fact of stream.pinnedFacts.filter((fact) => fact.status === "active")) {
      lines.push(`- ${fact.text}${fact.source ? ` (${fact.source})` : ""}`);
    }
  }
  return lines.join("\n");
}

async function cmdCreate(): Promise<void> {
  const title = option("title") ?? positional(0);
  if (!title) die('Usage: stream create <title> [--summary "..."] [--tags "a,b"]');
  const stream = await createStream({
    title,
    description: await readTextOption("desc", "desc-file"),
    tags: parseCsv(option("tags")),
    scope: await parseScope(),
    status: parseStatus(option("status")) ?? "active",
    summary: option("summary") ?? option("state"),
    health: option("health"),
    parent: option("parent"),
    links: buildLinks(),
    owners: buildOwners(),
    pinnedFacts: options("pin"),
    authorSessionId: process.env.COMPANION_SESSION_ID,
  });
  if (jsonOutput) out(stream);
  else console.log(`Created stream ${stream.id} ${stream.slug}: ${stream.title}`);
}

async function cmdList(): Promise<void> {
  const status = parseStatus(option("status"));
  const streams = await listStreams({
    scope: await parseScope(),
    status,
    includeArchived: flag("archived") || flag("all") || status === "archived",
    tag: option("tag"),
    text: option("text"),
  });
  if (jsonOutput) out(streams);
  else if (streams.length === 0) console.log("No streams found.");
  else console.log(streams.map(formatStreamLine).join("\n"));
}

async function cmdShow(): Promise<void> {
  const ref = positional(0);
  if (!ref) die("Usage: stream show <stream>");
  const stream = await getStream(ref, await parseScope());
  if (!stream) die(`Stream not found: ${ref}`);
  if (jsonOutput) out(stream);
  else console.log(formatShow(stream));
}

async function cmdUpdate(): Promise<void> {
  const ref = positional(0);
  if (!ref) die('Usage: stream update <stream> --entry "..." [--type state-change]');
  const entry = await readTextOption("entry", "entry-file");
  if (!entry?.trim()) die("stream update requires --entry or --entry-file");
  const stream = await updateStream({
    streamRef: ref,
    scope: await parseScope(),
    type: parseEntryType(),
    text: entry,
    authorSessionId: process.env.COMPANION_SESSION_ID,
    source: option("source"),
    confidence: parseConfidence(option("confidence")),
    status: parseStatus(option("status")),
    statePatch: buildStatePatch(),
    links: buildLinks(),
    artifacts: [...options("artifact"), ...parseCsv(option("artifacts"))],
    pins: options("pin"),
    staleFacts: [...options("stale"), ...parseCsv(option("stale-facts"))],
    supersedes: [...options("supersedes"), ...parseCsv(option("supersedes-list"))],
    owners: buildOwners(),
  });
  if (!stream) die(`Stream not found: ${ref}`);
  if (jsonOutput) out(stream);
  else console.log(`Updated stream ${stream.id} ${stream.slug}`);
}

async function cmdArchive(): Promise<void> {
  const ref = positional(0);
  if (!ref) die('Usage: stream archive <stream> [--reason "..."]');
  const stream = await archiveStream(ref, await parseScope(), option("reason"));
  if (!stream) die(`Stream not found: ${ref}`);
  if (jsonOutput) out(stream);
  else console.log(`Archived stream ${stream.id} ${stream.slug}`);
}

async function cmdSearch(): Promise<void> {
  const query = positional(0) ?? option("text");
  if (!query) die("Usage: stream search <query>");
  const streams = await searchStreams(query, await parseScope());
  if (jsonOutput) out(streams);
  else if (streams.length === 0) console.log("No matching streams.");
  else console.log(streams.map(formatStreamLine).join("\n"));
}

async function cmdDashboard(): Promise<void> {
  const ref = positional(0);
  if (!ref) die("Usage: stream dashboard <stream>");
  const dashboard = await getStreamDashboard(ref, await parseScope());
  if (!dashboard) die(`Stream not found: ${ref}`);
  if (jsonOutput) {
    out(dashboard);
    return;
  }
  const lines = [formatShow(dashboard.stream), "", "Component Streams:"];
  if (dashboard.children.length === 0) lines.push("  (none)");
  else lines.push(...dashboard.children.map((stream) => `  - ${formatStreamLine(stream)}`));
  console.log(lines.join("\n"));
}

async function cmdHandoff(): Promise<void> {
  const ref = positional(0);
  if (!ref) die("Usage: stream handoff <stream>");
  const stream = await getStream(ref, await parseScope());
  if (!stream) die(`Stream not found: ${ref}`);
  if (jsonOutput) out({ stream, handoff: formatHandoff(stream) });
  else console.log(formatHandoff(stream));
}

function printHelp(): void {
  console.log(`Usage: stream <command> [options]

Commands:
  create <title>        Create an active stream
  list                  List streams in the current scope
  show <stream>         Show current state first, then timeline
  update <stream>       Add a typed timeline entry and optional state patch
  archive <stream>      Archive a stream
  search <query>        Search streams, current state, timeline, links, facts
  dashboard <stream>    Show a stream plus child/component streams
  handoff <stream>      Print a compact worker/leader handoff

Common options:
  --scope <scope>       Override default scope (default: Takode session group; fallback: git project)
  --json                JSON output

Create options:
  --summary <text>      Initial current-state summary
  --desc <text>         Description
  --tags "a,b"          Tags
  --parent <stream>     Parent dashboard/group stream
  --quest q-1           Link quest (repeatable)
  --session 1004        Link session (repeatable)
  --worker 956          Link worker (repeatable)
  --artifact <path>     Link artifact/path (repeatable)
  --pin <fact>          Add pinned fact (repeatable)
  --owner <session>     Add owner (repeatable)
  --steering-mode <m>   leader-steered|user-steered|monitor-only|blocked

Update options:
  --entry <text>        Timeline entry text
  --entry-file <path|->
  --type <type>         state-change|decision|artifact|metric|alert|contradiction|supersession|handoff|ownership|verification|note
  --state <text>        Replace current-state summary
  --health <text>       Current health
  --operational-status <text>
  --paperwork-status <text>
  --blocked-on <text>
  --next-check <text>
  --last-verified <text>
  --source <ref>        Provenance, e.g. session:989:3025
  --confidence <value>  observed|inferred|user-confirmed
  --stale <fact>        Mark pinned fact id/text stale (repeatable)
  --supersedes <fact>   New fact or reason replacing stale fact (repeatable)

Examples:
  stream create "AI judging" --summary "4-lane monitor active" --tags "ml,judging"
  stream update ai-judging --type decision --entry "Use 4 judging lanes" --source session:989:3202
  stream update ai-judging --type supersession --entry "2-lane timer replaced" --stale pf-1 --supersedes "4-lane timer t2"
  stream show ai-judging
  stream handoff ai-judging`);
}

async function main(): Promise<void> {
  switch (command) {
    case "create":
      await cmdCreate();
      break;
    case "list":
      await cmdList();
      break;
    case "show":
      await cmdShow();
      break;
    case "update":
      await cmdUpdate();
      break;
    case "archive":
      await cmdArchive();
      break;
    case "search":
      await cmdSearch();
      break;
    case "dashboard":
      await cmdDashboard();
      break;
    case "handoff":
      await cmdHandoff();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      die(`Unknown command: ${command}. Run stream --help.`);
  }
}

main().catch((error) => {
  die(error instanceof Error ? error.message : String(error));
});
