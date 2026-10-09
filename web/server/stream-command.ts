import {
  archiveStream,
  createStream,
  getStream,
  getStreamDashboard,
  listStreams,
  searchStreams,
  streamScopeForSessionGroup,
  updateStream,
} from "./stream-store.js";
import { getGroupForSession } from "./tree-group-store.js";
import { parseStreamArgs, type ParsedStreamArgs } from "./stream-command-args.js";
import type {
  StreamCurrentState,
  StreamEntryType,
  StreamLink,
  StreamOwner,
  StreamRecord,
  StreamStatus,
  StreamSteeringMode,
} from "./stream-types.js";

/** Exact observable result of one `stream` command. */
export interface StreamCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** What a `stream` command would otherwise read from its caller's process. */
export interface StreamCommandContext {
  /** Session running the command: it authors entries, and its session group is the default scope. */
  sessionId?: string;
  /** Server id that prefixes default scopes. */
  serverId?: string;
  /** Default scope outside a session, computed by the caller from its own checkout (`projectStreamScope`). */
  projectScope?: string;
  /** Read a file named by `--desc-file` or `--entry-file`; `-` is the caller's stdin. */
  readTextFile: (path: string) => Promise<string>;
}

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

class StreamCommandError extends Error {}

function fail(message: string): never {
  throw new StreamCommandError(message);
}

/** Run one `stream` command and capture its output instead of writing to the process. */
export async function runStreamCommand(
  args: readonly string[],
  context: StreamCommandContext,
): Promise<StreamCommandResult> {
  const stdout: string[] = [];
  try {
    await executeStreamCommand(parseStreamArgs(args), context, (text) => stdout.push(text));
    return { exitCode: 0, stdout: joinLines(stdout), stderr: "" };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: joinLines(stdout),
      stderr: `Error: ${error instanceof Error ? error.message : String(error)}\n`,
    };
  }
}

function joinLines(lines: string[]): string {
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function parseCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function executeStreamCommand(
  parsed: ParsedStreamArgs,
  context: StreamCommandContext,
  print: (text: string) => void,
): Promise<void> {
  const { flag, option, options, positional } = parsed;
  const jsonOutput = flag("json");
  const out = (data: unknown) => print(JSON.stringify(data, null, 2));
  const authorSessionId = context.sessionId;

  async function parseScope(): Promise<string> {
    const explicit = option("scope")?.trim();
    if (explicit) return explicit;
    const session = context.sessionId?.trim();
    if (session) return streamScopeForSessionGroup((await getGroupForSession(session)) ?? "default", context.serverId);
    return context.projectScope || fail("No stream scope: pass --scope <scope> or run from a Takode session.");
  }

  function parseStatus(value: string | undefined): StreamStatus | undefined {
    if (!value) return undefined;
    if (STATUSES.has(value as StreamStatus)) return value as StreamStatus;
    fail(`--status must be one of: ${[...STATUSES].join(", ")}`);
  }

  function parseEntryType(): StreamEntryType {
    const value = option("type") ?? "note";
    if (ENTRY_TYPES.has(value as StreamEntryType)) return value as StreamEntryType;
    fail(`--type must be one of: ${[...ENTRY_TYPES].join(", ")}`);
  }

  function parseSteeringMode(raw: string | undefined): StreamSteeringMode | undefined {
    if (!raw) return undefined;
    if (STEERING_MODES.has(raw as StreamSteeringMode)) return raw as StreamSteeringMode;
    fail(`--steering-mode must be one of: ${[...STEERING_MODES].join(", ")}`);
  }

  function parseConfidence(raw: string | undefined): StreamConfidence | undefined {
    if (!raw) return undefined;
    if (CONFIDENCES.has(raw as StreamConfidence)) return raw as StreamConfidence;
    fail(`--confidence must be one of: ${[...CONFIDENCES].join(", ")}`);
  }

  async function readTextOption(inlineFlag: string, fileFlag: string): Promise<string | undefined> {
    const inline = option(inlineFlag);
    const file = option(fileFlag);
    if (inline !== undefined && file !== undefined) fail(`Use either --${inlineFlag} or --${fileFlag}, not both`);
    if (inline !== undefined) return inline;
    if (file === undefined) return undefined;
    try {
      return await context.readTextFile(file);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : "";
      fail(`Cannot read --${fileFlag} from ${file}${detail}`);
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

  switch (parsed.command) {
    case "create": {
      const title = option("title") ?? positional(0);
      if (!title) fail('Usage: stream create <title> [--summary "..."] [--tags "a,b"]');
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
        authorSessionId,
      });
      if (jsonOutput) out(stream);
      else print(`Created stream ${stream.id} ${stream.slug}: ${stream.title}`);
      return;
    }
    case "list": {
      const status = parseStatus(option("status"));
      const streams = await listStreams({
        scope: await parseScope(),
        status,
        includeArchived: flag("archived") || flag("all") || status === "archived",
        tag: option("tag"),
        text: option("text"),
      });
      if (jsonOutput) out(streams);
      else if (streams.length === 0) print("No streams found.");
      else print(streams.map(formatStreamLine).join("\n"));
      return;
    }
    case "show": {
      const ref = positional(0);
      if (!ref) fail("Usage: stream show <stream>");
      const stream = await getStream(ref, await parseScope());
      if (!stream) fail(`Stream not found: ${ref}`);
      if (jsonOutput) out(stream);
      else print(formatShow(stream));
      return;
    }
    case "update": {
      const ref = positional(0);
      if (!ref) fail('Usage: stream update <stream> --entry "..." [--type state-change]');
      const entry = await readTextOption("entry", "entry-file");
      if (!entry?.trim()) fail("stream update requires --entry or --entry-file");
      const stream = await updateStream({
        streamRef: ref,
        scope: await parseScope(),
        type: parseEntryType(),
        text: entry,
        authorSessionId,
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
      if (!stream) fail(`Stream not found: ${ref}`);
      if (jsonOutput) out(stream);
      else print(`Updated stream ${stream.id} ${stream.slug}`);
      return;
    }
    case "archive": {
      const ref = positional(0);
      if (!ref) fail('Usage: stream archive <stream> [--reason "..."]');
      const stream = await archiveStream(ref, await parseScope(), option("reason"));
      if (!stream) fail(`Stream not found: ${ref}`);
      if (jsonOutput) out(stream);
      else print(`Archived stream ${stream.id} ${stream.slug}`);
      return;
    }
    case "search": {
      const query = positional(0) ?? option("text");
      if (!query) fail("Usage: stream search <query>");
      const streams = await searchStreams(query, await parseScope());
      if (jsonOutput) out(streams);
      else if (streams.length === 0) print("No matching streams.");
      else print(streams.map(formatStreamLine).join("\n"));
      return;
    }
    case "dashboard": {
      const ref = positional(0);
      if (!ref) fail("Usage: stream dashboard <stream>");
      const dashboard = await getStreamDashboard(ref, await parseScope());
      if (!dashboard) fail(`Stream not found: ${ref}`);
      if (jsonOutput) {
        out(dashboard);
        return;
      }
      const lines = [formatShow(dashboard.stream), "", "Component Streams:"];
      if (dashboard.children.length === 0) lines.push("  (none)");
      else lines.push(...dashboard.children.map((stream) => `  - ${formatStreamLine(stream)}`));
      print(lines.join("\n"));
      return;
    }
    case "handoff": {
      const ref = positional(0);
      if (!ref) fail("Usage: stream handoff <stream>");
      const stream = await getStream(ref, await parseScope());
      if (!stream) fail(`Stream not found: ${ref}`);
      if (jsonOutput) out({ stream, handoff: formatHandoff(stream) });
      else print(formatHandoff(stream));
      return;
    }
    case "help":
    case "--help":
    case "-h":
    case undefined:
      print(STREAM_USAGE);
      return;
    default:
      fail(`Unknown command: ${parsed.command}. Run stream --help.`);
  }
}

export const STREAM_USAGE = `Usage: stream <command> [options]

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
  --desc-file <path|->  Read description from a file or stdin
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
  stream handoff ai-judging`;

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
