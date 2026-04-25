import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { basename, dirname, join, resolve } from "node:path";
import type {
  StreamCreateInput,
  StreamCurrentState,
  StreamEntryType,
  StreamFactStatus,
  StreamLink,
  StreamListOptions,
  StreamOwner,
  StreamPinnedFact,
  StreamRecord,
  StreamScopeFile,
  StreamStatus,
  StreamUpdateInput,
} from "./stream-types.js";
import { getGroupForSession } from "./tree-group-store.js";

const STREAMS_DIR = join(process.env.HOME || homedir(), ".companion", "streams");
const execFileAsync = promisify(execFile);

mkdirSync(STREAMS_DIR, { recursive: true }); // sync-ok: cold path, once at module load

const VALID_STATUSES = new Set<StreamStatus>(["active", "paused", "blocked", "archived", "superseded"]);
const VALID_ENTRY_TYPES = new Set<StreamEntryType>([
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

function scopeFileName(scope: string): string {
  const digest = createHash("sha1").update(scope).digest("hex").slice(0, 16);
  return `${digest}.json`;
}

function scopeFilePath(scope: string): string {
  return join(STREAMS_DIR, scopeFileName(scope));
}

async function ensureDir(): Promise<void> {
  await mkdir(STREAMS_DIR, { recursive: true });
}

function emptyScopeFile(scope: string): StreamScopeFile {
  return { scope, nextId: 1, streams: [] };
}

function normalizeSlug(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "stream";
}

function uniqueSlug(title: string, streams: StreamRecord[], ignoreId?: string): string {
  const base = normalizeSlug(title);
  let slug = base;
  let suffix = 2;
  while (streams.some((stream) => stream.id !== ignoreId && stream.slug === slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function streamMatchesRef(stream: StreamRecord, ref: string): boolean {
  return stream.id === ref || stream.slug === ref || stream.title === ref;
}

function normalizeStatus(status: StreamStatus | undefined, fallback: StreamStatus): StreamStatus {
  if (!status) return fallback;
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`Invalid stream status: ${status}`);
  }
  return status;
}

function normalizeEntryType(type: StreamEntryType): StreamEntryType {
  if (!VALID_ENTRY_TYPES.has(type)) {
    throw new Error(`Invalid stream update type: ${type}`);
  }
  return type;
}

function normalizeLinks(links: StreamLink[] | undefined): StreamLink[] | undefined {
  const result = (links ?? [])
    .map((link) => ({ ...link, ref: link.ref.trim(), label: link.label?.trim() || undefined }))
    .filter((link) => link.ref.length > 0);
  return result.length ? result : undefined;
}

function mergeLinks(existing: StreamLink[] | undefined, incoming: StreamLink[] | undefined): StreamLink[] | undefined {
  const result: StreamLink[] = [];
  const seen = new Set<string>();
  for (const link of [...(existing ?? []), ...(incoming ?? [])]) {
    const key = `${link.type}\0${link.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result.length ? result : undefined;
}

function mergeOwners(
  existing: StreamOwner[] | undefined,
  incoming: StreamOwner[] | undefined,
): StreamOwner[] | undefined {
  const result = [...(existing ?? [])];
  for (const owner of incoming ?? []) {
    const ref = owner.ref.trim();
    if (!ref) continue;
    const index = result.findIndex((item) => item.ref === ref);
    const normalized = {
      ref,
      role: owner.role?.trim() || undefined,
      steeringMode: owner.steeringMode,
    };
    if (index === -1) result.push(normalized);
    else result[index] = { ...result[index], ...normalized };
  }
  return result.length ? result : undefined;
}

function nextPinnedFactId(stream: StreamRecord): string {
  const max = (stream.pinnedFacts ?? []).reduce((acc, fact) => {
    const match = fact.id.match(/^pf-(\d+)$/);
    return match ? Math.max(acc, Number(match[1])) : acc;
  }, 0);
  return `pf-${max + 1}`;
}

function addPinnedFacts(stream: StreamRecord, texts: string[] | undefined, source?: string): string[] {
  const pins: string[] = [];
  for (const raw of texts ?? []) {
    const text = raw.trim();
    if (!text) continue;
    const fact: StreamPinnedFact = {
      id: nextPinnedFactId(stream),
      text,
      status: "active",
      createdAt: Date.now(),
      ...(source ? { source } : {}),
    };
    stream.pinnedFacts = [...(stream.pinnedFacts ?? []), fact];
    pins.push(fact.id);
  }
  return pins;
}

function markStaleFacts(
  stream: StreamRecord,
  staleFacts: string[] | undefined,
  supersedes: string[] | undefined,
): void {
  if (!stream.pinnedFacts || !staleFacts?.length) return;
  for (const fact of stream.pinnedFacts) {
    if (!staleFacts.includes(fact.id) && !staleFacts.includes(fact.text)) continue;
    fact.status = "superseded";
    fact.supersededBy = supersedes?.[0];
  }
}

function normalizeStatePatch(patch: Partial<StreamCurrentState> | undefined): Partial<StreamCurrentState> | undefined {
  if (!patch) return undefined;
  const result: Partial<StreamCurrentState> = {};
  for (const [key, value] of Object.entries(patch) as [keyof StreamCurrentState, unknown][]) {
    if (Array.isArray(value)) {
      const values = value.map((item) => String(item).trim()).filter(Boolean);
      if (values.length) (result as Record<string, unknown>)[key] = values;
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      (result as Record<string, unknown>)[key] = value.trim();
    }
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizeStoredStream(scope: string, raw: StreamRecord): StreamRecord {
  return {
    ...raw,
    scope,
    status: normalizeStatus(raw.status, "active"),
    slug: raw.slug || normalizeSlug(raw.title),
    current: {
      ...raw.current,
      summary: raw.current?.summary?.trim() || "",
    },
    timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    links: normalizeLinks(raw.links),
    owners: mergeOwners(undefined, raw.owners),
    pinnedFacts: normalizePinnedFacts(raw.pinnedFacts),
  };
}

function normalizePinnedFacts(facts: StreamPinnedFact[] | undefined): StreamPinnedFact[] | undefined {
  const result = (facts ?? [])
    .map((fact) => ({
      ...fact,
      text: fact.text.trim(),
      status: normalizeFactStatus(fact.status),
    }))
    .filter((fact) => fact.text.length > 0);
  return result.length ? result : undefined;
}

function normalizeFactStatus(status: StreamFactStatus | undefined): StreamFactStatus {
  if (status === "active" || status === "superseded" || status === "disputed" || status === "needs-verification") {
    return status;
  }
  return "active";
}

async function loadScopeFile(scope: string): Promise<StreamScopeFile> {
  await ensureDir();
  const path = scopeFilePath(scope);
  try {
    const raw = await readFile(path, "utf-8");
    const data = JSON.parse(raw) as StreamScopeFile;
    const streams = Array.isArray(data.streams)
      ? data.streams.map((stream) => normalizeStoredStream(scope, stream))
      : [];
    return {
      scope,
      nextId: typeof data.nextId === "number" && data.nextId > 0 ? data.nextId : streams.length + 1,
      streams,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyScopeFile(scope);
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load stream scope ${scope} from ${path}: ${detail}`);
  }
}

async function removeTempFile(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function saveScopeFile(data: StreamScopeFile): Promise<void> {
  await ensureDir();
  const path = scopeFilePath(data.scope);
  const tempPath = join(STREAMS_DIR, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tempPath, path);
  } catch (error) {
    await removeTempFile(tempPath);
    throw error;
  }
}

function projectScopeComponentFromGitCommonDir(gitCommonDir: string): string {
  const commonDir = resolve(gitCommonDir);
  const name = basename(commonDir);
  const projectName =
    name === ".git" ? basename(dirname(commonDir)) || "project" : name.endsWith(".git") ? name.slice(0, -4) : name;
  const digest = createHash("sha1").update(commonDir).digest("hex").slice(0, 8);
  return `${projectName || "project"}-${digest}`;
}

async function resolveGitProjectScopeComponent(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["--no-optional-locks", "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd },
    );
    const gitCommonDir = stdout.trim();
    return gitCommonDir ? projectScopeComponentFromGitCommonDir(gitCommonDir) : null;
  } catch {
    return null;
  }
}

export async function defaultStreamScope(
  cwd = process.cwd(),
  serverId = process.env.COMPANION_SERVER_ID,
  sessionId = process.env.COMPANION_SESSION_ID,
): Promise<string> {
  const server = serverId?.trim() || "local";
  const session = sessionId?.trim();
  if (session) {
    const groupId = await getGroupForSession(session);
    if (groupId) return [server, "session-group", groupId].join(":");
  }
  const project = (await resolveGitProjectScopeComponent(cwd)) ?? basename(resolve(cwd)) ?? "project";
  return [server, "project", project].join(":");
}

function resolveStream(data: StreamScopeFile, ref: string): StreamRecord | null {
  return data.streams.find((stream) => streamMatchesRef(stream, ref)) ?? null;
}

function searchHaystack(stream: StreamRecord): string {
  return [
    stream.id,
    stream.slug,
    stream.title,
    stream.description,
    stream.status,
    stream.tags?.join(" "),
    stream.current.summary,
    stream.current.health,
    stream.current.operationalStatus,
    stream.current.paperworkStatus,
    stream.current.blockedOn,
    stream.current.openDecisions?.join(" "),
    stream.current.knownStaleFacts?.join(" "),
    stream.links?.map((link) => `${link.type} ${link.ref} ${link.label ?? ""}`).join(" "),
    stream.owners?.map((owner) => `${owner.ref} ${owner.role ?? ""} ${owner.steeringMode ?? ""}`).join(" "),
    stream.pinnedFacts?.map((fact) => `${fact.id} ${fact.text} ${fact.status} ${fact.source ?? ""}`).join(" "),
    stream.timeline
      .map((entry) => `${entry.type} ${entry.text} ${entry.source ?? ""} ${entry.artifacts?.join(" ") ?? ""}`)
      .join(" "),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export async function createStream(input: StreamCreateInput): Promise<StreamRecord> {
  if (!input.title.trim()) throw new Error("Stream title is required");
  const data = await loadScopeFile(input.scope);
  const now = Date.now();
  const stream: StreamRecord = {
    id: `s-${data.nextId}`,
    slug: uniqueSlug(input.title, data.streams),
    title: input.title.trim(),
    description: input.description?.trim() || undefined,
    tags: input.tags?.map((tag) => tag.trim()).filter(Boolean),
    scope: data.scope,
    status: normalizeStatus(input.status, "active"),
    createdAt: now,
    updatedAt: now,
    parentId: input.parent?.trim() || undefined,
    current: {
      summary: input.summary?.trim() || "",
      ...(input.health?.trim() ? { health: input.health.trim() } : {}),
    },
    links: normalizeLinks(input.links),
    owners: mergeOwners(undefined, input.owners),
    timeline: [],
  };
  addPinnedFacts(stream, input.pinnedFacts);
  data.streams.push(stream);
  data.nextId += 1;
  await saveScopeFile(data);
  return stream;
}

export async function listStreams(options: StreamListOptions = {}): Promise<StreamRecord[]> {
  const scope = options.scope ?? (await defaultStreamScope());
  const data = await loadScopeFile(scope);
  const query = options.text?.toLowerCase().trim();
  return data.streams
    .filter((stream) => (options.includeArchived ? true : stream.status !== "archived"))
    .filter((stream) => (options.status ? stream.status === options.status : true))
    .filter((stream) => (options.tag ? stream.tags?.includes(options.tag) : true))
    .filter((stream) => (query ? searchHaystack(stream).includes(query) : true))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getStream(ref: string, scope?: string): Promise<StreamRecord | null> {
  const data = await loadScopeFile(scope ?? (await defaultStreamScope()));
  return resolveStream(data, ref);
}

export async function updateStream(input: StreamUpdateInput): Promise<StreamRecord | null> {
  const data = await loadScopeFile(input.scope);
  const stream = resolveStream(data, input.streamRef);
  if (!stream) return null;

  const now = Date.now();
  const type = normalizeEntryType(input.type);
  const statePatch = normalizeStatePatch(input.statePatch);
  const links = normalizeLinks(input.links);
  const pins = addPinnedFacts(stream, input.pins, input.source);
  markStaleFacts(stream, input.staleFacts, input.supersedes);

  if (statePatch) {
    stream.current = { ...stream.current, ...statePatch };
  }
  if (input.status) {
    stream.status = normalizeStatus(input.status, stream.status);
    if (stream.status === "archived") stream.archivedAt = now;
  }
  stream.links = mergeLinks(stream.links, links);
  stream.owners = mergeOwners(stream.owners, input.owners);
  stream.timeline.push({
    id: `e-${stream.timeline.length + 1}`,
    type,
    text: input.text.trim(),
    ts: now,
    ...(input.authorSessionId ? { authorSessionId: input.authorSessionId } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.confidence ? { confidence: input.confidence } : {}),
    ...(links ? { links } : {}),
    ...(input.artifacts?.length ? { artifacts: input.artifacts } : {}),
    ...(pins.length ? { pins } : {}),
    ...(input.staleFacts?.length ? { staleFacts: input.staleFacts } : {}),
    ...(input.supersedes?.length ? { supersedes: input.supersedes } : {}),
    ...(statePatch ? { statePatch } : {}),
  });
  stream.updatedAt = now;
  await saveScopeFile(data);
  return stream;
}

export async function archiveStream(ref: string, scope?: string, reason?: string): Promise<StreamRecord | null> {
  return updateStream({
    streamRef: ref,
    scope: scope ?? (await defaultStreamScope()),
    type: "state-change",
    text: reason?.trim() || "Archived stream",
    status: "archived",
  });
}

export async function searchStreams(query: string, scope?: string): Promise<StreamRecord[]> {
  return listStreams({ scope: scope ?? (await defaultStreamScope()), includeArchived: true, text: query });
}

export async function getStreamDashboard(
  ref: string,
  scope?: string,
): Promise<{
  stream: StreamRecord;
  children: StreamRecord[];
} | null> {
  const data = await loadScopeFile(scope ?? (await defaultStreamScope()));
  const stream = resolveStream(data, ref);
  if (!stream) return null;
  const children = data.streams.filter(
    (candidate) => candidate.parentId === stream.id || candidate.parentId === stream.slug,
  );
  return { stream, children };
}

export function getStreamsDir(): string {
  return STREAMS_DIR;
}
