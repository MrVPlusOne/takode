import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type {
  ArtifactDetail,
  ArtifactKind,
  ArtifactListQuery,
  ArtifactListResponse,
  ArtifactMessageMarker,
  ArtifactMessageRef,
  ArtifactSummary,
  ArtifactVersionContent,
  ArtifactVersionSummary,
} from "../shared/artifact-library.js";
import { untitledPostKey, type ExtractedMessage, type MessageCapture } from "./artifact-extract.js";

/**
 * The server's artifact library: an index of artifacts and their versions, plus the saved content
 * of each version. Text written by the model (posts, reports, reviews, visuals) keeps every
 * version; a figure keeps only its newest file, and older figure versions remain as records.
 *
 * Layout under the root: `index.json` (the whole index, rewritten atomically), `text/<sha>.json`
 * (one file per distinct text version) and `files/<sha><ext>` (newest figure files).
 */

/** Untitled redrafts group only while they keep coming; a day later the same first line starts a new post. */
export const UNTITLED_POST_GROUPING_MS = 12 * 60 * 60 * 1000;
/** Figures larger than this are recorded but not copied. */
export const MAX_FIGURE_COPY_BYTES = 20 * 1024 * 1024;
const PREVIEW_CHARS = 240;
/** Kinds the library learned to find after it first started; their earlier history is read once. */
const KINDS_ADDED_LATER: readonly ArtifactKind[] = ["table"];
const CURSOR_WRITE_INTERVAL_MS = 60_000;

interface StoredVersion extends ArtifactVersionSummary {
  /** Hash identifying the content; a new version needs a different hash. */
  sha: string;
  /** Saved content: a text file name, or a figure file name. */
  stored?: string;
}

interface StoredArtifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  /** Who chose the title: the user or an agent explicitly keeps it; derived titles follow the newest version. */
  titleSource: "user" | "explicit" | "derived";
  key: string;
  space: string;
  sessionId: string;
  threadKey: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  preview: string;
  /** The newest version's text with its lines kept, for text thumbnails; see `ArtifactSummary.excerpt`. */
  excerpt?: string;
  /** The figure's file path, for figures. */
  path?: string;
  /** The newest version's parts, for posts: an older message's draft equal to one of them is still current. */
  latestParts?: string[];
  versions: StoredVersion[];
}

interface MessageEntry {
  label: string;
  artifactId: string;
  n: number;
}

interface LibraryIndex {
  version: 1;
  /** When the library started; history older than a month before it is not backfilled. */
  installedAt: number;
  artifacts: Record<string, StoredArtifact>;
  /** Grouping key to artifact ID. */
  keys: Record<string, string>;
  /** `${sessionId}\n${messageId}` to the versions that message holds. */
  messages: Record<string, MessageEntry[]>;
  /** Per session: how many history messages were already read, and the ID of the last one. */
  cursors: Record<string, { count: number; lastId?: string }>;
  /** Kinds added after the library started whose earlier history was already read for them. */
  backfilledKinds?: ArtifactKind[];
}

export interface CaptureContext {
  sessionId: string;
  space: string;
}

/** What a capture changed: sessions whose messages show a now-older version need a refresh. */
export interface CaptureResult {
  captured: number;
  affectedSessions: Set<string>;
  /** Versions this capture added, with the tab they appeared in. */
  newVersions?: Array<{ artifactId: string; n: number; threadKey: string }>;
}

export class ArtifactLibraryStore {
  private index: LibraryIndex | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private dirty = false;
  private cursorsChanged = false;
  private lastWriteAt = 0;

  constructor(
    readonly root: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    if (this.index) return;
    try {
      const parsed = JSON.parse(await readFile(join(this.root, "index.json"), "utf-8")) as LibraryIndex;
      if (parsed?.version !== 1 || typeof parsed.artifacts !== "object") throw new Error("unknown index format");
      this.index = parsed;
      await this.fillMissingExcerpts();
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        // Never overwrite an index we could not read; keep it aside and start a fresh one.
        console.error("[artifact-library] Unreadable index, keeping it aside:", error);
        await rename(join(this.root, "index.json"), join(this.root, `index.unreadable-${this.now()}.json`)).catch(
          () => {},
        );
      }
      this.index = {
        version: 1,
        installedAt: this.now(),
        artifacts: {},
        keys: {},
        messages: {},
        cursors: {},
        // A new library reads every kind from the start.
        backfilledKinds: [...KINDS_ADDED_LATER],
      };
      this.dirty = true;
      await this.flush();
    }
  }

  /** Kinds added after this library started whose earlier history still needs reading for them. */
  kindsToBackfill(): ArtifactKind[] {
    const done = this.state().backfilledKinds ?? [];
    return KINDS_ADDED_LATER.filter((kind) => !done.includes(kind));
  }

  markKindsBackfilled(kinds: readonly ArtifactKind[]): void {
    const index = this.state();
    index.backfilledKinds = [...new Set([...(index.backfilledKinds ?? []), ...kinds])];
    this.dirty = true;
  }

  /** Artifacts saved before excerpts existed get one from their newest saved text. */
  private async fillMissingExcerpts(): Promise<void> {
    for (const artifact of Object.values(this.state().artifacts)) {
      if (artifact.excerpt !== undefined || artifact.kind === "figure" || artifact.kind === "visual") continue;
      const stored = artifact.versions.at(-1)?.stored;
      if (!stored) continue;
      try {
        const content = JSON.parse(await readFile(join(this.root, "text", stored), "utf-8")) as ArtifactVersionContent;
        artifact.excerpt = excerptOf(content);
        this.dirty = true;
      } catch (error) {
        console.error(`[artifact-library] Could not read ${stored} for its excerpt:`, error);
      }
    }
  }

  get loaded(): boolean {
    return this.index !== null;
  }

  /** History before this time is not captured: the last month before the library started. */
  backfillCutoff(): number {
    return this.state().installedAt - 30 * 24 * 60 * 60 * 1000;
  }

  /** Where reading this session's history resumes, after checking the history still has that message. */
  cursorFor(sessionId: string, history: ReadonlyArray<unknown>, idAt: (index: number) => string | undefined): number {
    const cursor = this.state().cursors[sessionId];
    if (!cursor) return 0;
    if (cursor.count > history.length) return history.length;
    if (cursor.count > 0 && cursor.lastId && idAt(cursor.count - 1) !== cursor.lastId) return history.length;
    return cursor.count;
  }

  setCursor(sessionId: string, count: number, lastId: string | undefined): void {
    const cursors = this.state().cursors;
    const previous = cursors[sessionId];
    if (previous?.count === count && previous.lastId === lastId) return;
    cursors[sessionId] = { count, ...(lastId ? { lastId } : {}) };
    // Cursors move with every message. Re-reading messages after a restart captures nothing twice,
    // so a cursor change alone is written at most once a minute instead of rewriting the index each time.
    this.cursorsChanged = true;
  }

  /** Records one message's captures as artifact versions. */
  async captureMessage(
    ctx: CaptureContext,
    extracted: ExtractedMessage,
    result: CaptureResult,
    options: { onlyKinds?: readonly ArtifactKind[] } = {},
  ): Promise<void> {
    const index = this.state();
    const messageKey = messageIndexKey(ctx.sessionId, extracted.messageId);
    // A message read again (its kind new to the library, or grown since) adds only captures it
    // didn't have; the ones it had stay as captured.
    const existing = index.messages[messageKey];
    const ref: ArtifactMessageRef = {
      sessionId: ctx.sessionId,
      messageId: extracted.messageId,
      threadKey: extracted.threadKey,
      at: extracted.at || this.now(),
    };
    const entries: MessageEntry[] = [];
    const figureIdsByLabel = new Map<string, string>();
    for (const capture of extracted.captures) {
      if (options.onlyKinds && !options.onlyKinds.includes(capture.kind)) continue;
      if (existing?.some((entry) => entry.label === capture.label)) continue;
      const entry = await this.captureOne(ctx, ref, capture, figureIdsByLabel, result);
      if (!entry) continue;
      entries.push(entry);
      if (capture.kind === "figure") figureIdsByLabel.set(capture.label, entry.artifactId);
    }
    if (entries.length === 0) return;
    index.messages[messageKey] = [...(existing ?? []), ...entries];
    result.captured += entries.length;
    this.dirty = true;
  }

  private async captureOne(
    ctx: CaptureContext,
    ref: ArtifactMessageRef,
    capture: MessageCapture,
    figureIdsByLabel: Map<string, string>,
    result: CaptureResult,
  ): Promise<MessageEntry | null> {
    const key = groupingKey(ctx, ref, capture);
    let artifact = this.artifactForKey(key, capture, ref.at);
    const prepared = await this.prepare(capture, figureIdsByLabel, artifact?.latestParts);
    if (!prepared) return null;
    if (!artifact) {
      artifact = {
        id: randomUUID(),
        kind: capture.kind,
        title: prepared.title,
        titleSource: prepared.titleSource,
        key,
        space: ctx.space,
        sessionId: ctx.sessionId,
        threadKey: ref.threadKey,
        createdAt: ref.at,
        updatedAt: ref.at,
        starred: false,
        preview: prepared.preview,
        ...(prepared.excerpt !== undefined ? { excerpt: prepared.excerpt } : {}),
        ...(capture.kind === "figure" ? { path: capture.path } : {}),
        versions: [],
      };
      this.state().artifacts[artifact.id] = artifact;
      this.state().keys[key] = artifact.id;
    }
    const latest = artifact.versions.at(-1);
    if (latest && latest.sha === prepared.sha) {
      return { label: capture.label, artifactId: artifact.id, n: latest.n };
    }
    const version: StoredVersion = {
      n: (latest?.n ?? 0) + 1,
      at: ref.at,
      bytes: prepared.bytes,
      kept: prepared.stored !== undefined,
      sha: prepared.sha,
      ...(prepared.stored ? { stored: prepared.stored } : {}),
      ...(prepared.parts ? { parts: prepared.parts } : {}),
      ...(prepared.figureIds?.length ? { figureIds: prepared.figureIds } : {}),
      source: ref,
    };
    if (latest && artifact.kind === "figure") await this.dropFigureFile(latest);
    artifact.versions.push(version);
    if (prepared.postParts) artifact.latestParts = prepared.postParts;
    artifact.updatedAt = Math.max(artifact.updatedAt, ref.at);
    artifact.preview = prepared.preview;
    if (prepared.excerpt !== undefined) artifact.excerpt = prepared.excerpt;
    if (
      artifact.titleSource !== "user" &&
      (prepared.titleSource === "explicit" || artifact.titleSource === "derived")
    ) {
      artifact.title = prepared.title;
      artifact.titleSource = prepared.titleSource;
    }
    if (latest) {
      for (const sessionId of this.sessionsShowingArtifact(artifact.id)) result.affectedSessions.add(sessionId);
    }
    this.dirty = true;
    result.newVersions?.push({ artifactId: artifact.id, n: version.n, threadKey: ref.threadKey });
    return { label: capture.label, artifactId: artifact.id, n: version.n };
  }

  private artifactForKey(key: string, capture: MessageCapture, at: number): StoredArtifact | undefined {
    const id = this.state().keys[key];
    const artifact = id ? this.state().artifacts[id] : undefined;
    if (!artifact) return undefined;
    // An untitled post resumes its group only while redrafts keep coming.
    if (capture.kind === "post" && !capture.title) {
      const latest = artifact.versions.at(-1);
      if (latest && at - latest.at > UNTITLED_POST_GROUPING_MS) return undefined;
    }
    return artifact;
  }

  private async prepare(
    capture: MessageCapture,
    figureIdsByLabel: Map<string, string>,
    previousParts: readonly string[] | undefined,
  ): Promise<{
    sha: string;
    bytes: number;
    title: string;
    titleSource: StoredArtifact["titleSource"];
    preview: string;
    excerpt?: string;
    stored?: string;
    parts?: number;
    figureIds?: string[];
    postParts?: string[];
  } | null> {
    if (capture.kind === "figure") return this.prepareFigure(capture);
    let content: ArtifactVersionContent;
    let title: string;
    let titleSource: StoredArtifact["titleSource"];
    let previewText: string;
    if (capture.kind === "post") {
      const figureIds = capture.figureLabels
        .map((label) => figureIdsByLabel.get(label))
        .filter((id): id is string => !!id);
      content = { kind: "post", parts: mergePostParts(previousParts, capture.parts), figureIds };
      title = capture.title ?? capture.autoTitle;
      titleSource = capture.title ? "explicit" : "derived";
      previewText = content.parts.join("\n\n");
    } else if (capture.kind === "visual") {
      content = { kind: "visual", source: capture.source };
      title = capture.title ?? visualAltTitle(capture.source);
      titleSource = capture.title ? "explicit" : "derived";
      previewText = visualAltTitle(capture.source);
    } else if (capture.kind === "table") {
      content = { kind: "table", markdown: capture.markdown };
      title = capture.title;
      titleSource = "derived";
      previewText = capture.markdown;
    } else {
      content = {
        kind: capture.kind,
        markdown: capture.markdown,
        sourcePath: capture.sourcePath,
      };
      title = capture.title;
      titleSource = "derived";
      previewText = capture.markdown;
    }
    // The hash covers what the user sees; a post's figure list changes with every new figure ID.
    const shaInput = content.kind === "post" ? JSON.stringify(content.parts) : JSON.stringify(content);
    const sha = sha256(shaInput);
    const json = JSON.stringify(content);
    const stored = `${sha}.json`;
    await this.writeIfMissing(join(this.root, "text", stored), json);
    return {
      sha,
      bytes: Buffer.byteLength(json, "utf-8"),
      title,
      titleSource,
      preview: previewOf(previewText),
      ...(content.kind === "visual" ? {} : { excerpt: excerptOf(content) }),
      stored,
      ...(content.kind === "post"
        ? { parts: content.parts.length, figureIds: content.figureIds, postParts: content.parts }
        : {}),
    };
  }

  private async prepareFigure(capture: Extract<MessageCapture, { kind: "figure" }>) {
    const title = capture.alt.trim() || capture.path.split("/").pop() || capture.path;
    let bytes: Buffer;
    try {
      const info = await stat(capture.path);
      if (!info.isFile()) return null;
      if (info.size > MAX_FIGURE_COPY_BYTES) {
        return {
          sha: `size:${info.size}:${info.mtimeMs}`,
          bytes: info.size,
          title,
          titleSource: "derived" as const,
          preview: "",
        };
      }
      bytes = await readFile(capture.path);
    } catch {
      // A figure whose file is gone is not saved; the message still shows its path.
      return null;
    }
    const sha = createHash("sha256").update(bytes).digest("hex");
    const stored = `${sha}${extname(capture.path).toLowerCase()}`;
    const target = join(this.root, "files", stored);
    if (!(await exists(target))) {
      await mkdir(join(this.root, "files"), { recursive: true });
      await writeFile(target, bytes);
    }
    return {
      sha,
      bytes: bytes.length,
      title,
      titleSource: "derived" as const,
      preview: "",
      stored,
    };
  }

  private async dropFigureFile(version: StoredVersion): Promise<void> {
    if (!version.stored) return;
    const stillUsed = Object.values(this.state().artifacts).some((artifact) =>
      artifact.versions.some((other) => other !== version && other.stored === version.stored && other.kept),
    );
    if (!stillUsed) await unlink(join(this.root, "files", version.stored)).catch(() => {});
    delete version.stored;
    version.kept = false;
  }

  /** Sessions with a message showing some version of the artifact. */
  sessionsShowingArtifact(artifactId: string): Set<string> {
    const sessions = new Set<string>();
    for (const [key, entries] of Object.entries(this.state().messages)) {
      if (entries.some((entry) => entry.artifactId === artifactId)) sessions.add(key.slice(0, key.indexOf("\n")));
    }
    return sessions;
  }

  /** What a message shows: each version it holds, and whether a newer version replaced it. */
  markersForMessage(
    sessionId: string,
    messageId: string,
  ): Array<{
    label: string;
    marker: ArtifactMessageMarker;
    superseded: boolean;
    latestParts?: readonly string[];
  }> {
    const entries = this.index?.messages[messageIndexKey(sessionId, messageId)];
    if (!entries) return [];
    const markers = [];
    for (const entry of entries) {
      const artifact = this.index!.artifacts[entry.artifactId];
      const latest = artifact?.versions.at(-1);
      if (!artifact || !latest) continue;
      markers.push({
        label: entry.label,
        marker: {
          id: artifact.id,
          kind: artifact.kind,
          title: artifact.title,
          version: entry.n,
          versionCount: artifact.versions.length,
        },
        superseded: entry.n !== latest.n,
        ...(artifact.latestParts ? { latestParts: artifact.latestParts } : {}),
      });
    }
    return markers;
  }

  list(query: ArtifactListQuery = {}): ArtifactListResponse {
    const all = Object.values(this.state().artifacts);
    const spaces = [...new Set(all.map((artifact) => artifact.space))].sort();
    const words = (query.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const inSessions = query.sessionIds ? this.artifactsOfSessions(query.sessionIds) : null;
    const others = all
      .filter((artifact) => !query.space || artifact.space === query.space)
      .filter((artifact) => !query.sessionId || artifact.sessionId === query.sessionId)
      .filter((artifact) => !query.threadKeys || query.threadKeys.includes(artifact.threadKey))
      .filter((artifact) => !inSessions || inSessions.has(artifact.id))
      .filter((artifact) => !query.starred || artifact.starred)
      .filter((artifact) => query.since === undefined || artifact.updatedAt >= query.since)
      .filter((artifact) => {
        if (words.length === 0) return true;
        const text = `${artifact.title}\n${artifact.preview}`.toLowerCase();
        return words.every((word) => text.includes(word));
      });
    const kinds: Partial<Record<ArtifactKind, number>> = {};
    for (const artifact of others) kinds[artifact.kind] = (kinds[artifact.kind] ?? 0) + 1;
    const matches = others
      .filter((artifact) => !query.kind || artifact.kind === query.kind)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const offset = Math.max(0, query.offset ?? 0);
    const limit = Math.min(Math.max(1, query.limit ?? 100), 500);
    return {
      artifacts: matches.slice(offset, offset + limit).map(summarize),
      total: matches.length,
      kinds,
      spaces,
    };
  }

  /** Artifacts made in any of these sessions or shown in one of their messages. */
  private artifactsOfSessions(sessionIds: readonly string[]): Set<string> {
    const sessions = new Set(sessionIds);
    const ids = new Set<string>();
    for (const artifact of Object.values(this.state().artifacts)) {
      if (sessions.has(artifact.sessionId)) ids.add(artifact.id);
    }
    for (const [key, entries] of Object.entries(this.state().messages)) {
      if (!sessions.has(key.slice(0, key.indexOf("\n")))) continue;
      for (const entry of entries) ids.add(entry.artifactId);
    }
    return ids;
  }

  /** An artifact ID from an exact ID or a unique prefix of at least 4 characters. */
  resolveId(ref: string): string | null {
    const artifacts = this.state().artifacts;
    if (artifacts[ref]) return ref;
    if (ref.length < 4) return null;
    const matches = Object.keys(artifacts).filter((id) => id.startsWith(ref));
    return matches.length === 1 ? matches[0] : null;
  }

  get(id: string): ArtifactDetail | null {
    const artifact = this.state().artifacts[id];
    return artifact
      ? {
          ...summarize(artifact),
          versions: artifact.versions.map(publicVersion),
        }
      : null;
  }

  /** A version's saved content, or null when that version was not kept. */
  async versionContent(id: string, n: number): Promise<ArtifactVersionContent | null> {
    const artifact = this.state().artifacts[id];
    const version = artifact?.versions.find((candidate) => candidate.n === n);
    if (!artifact || !version) return null;
    if (artifact.kind === "figure") {
      return {
        kind: "figure",
        path: artifact.path ?? "",
        fileUrl: version.kept && version.stored ? `/api/artifacts/${artifact.id}/file` : null,
      };
    }
    if (!version.stored) return null;
    return JSON.parse(await readFile(join(this.root, "text", version.stored), "utf-8")) as ArtifactVersionContent;
  }

  /** What the newest version's thumbnail is made from, keyed by its version; null for kinds shown as text. */
  thumbnailSource(
    ref: string,
  ):
    | { kind: "figure"; key: string; filePath: string }
    | { kind: "visual"; key: string; visualSource: () => Promise<string> }
    | null {
    const id = this.resolveId(ref);
    const artifact = id ? this.state().artifacts[id] : undefined;
    const key = artifact ? thumbKey(artifact) : undefined;
    const latest = artifact?.versions.at(-1);
    if (!artifact || !key || !latest?.stored) return null;
    if (artifact.kind === "figure") return { kind: "figure", key, filePath: join(this.root, "files", latest.stored) };
    const stored = latest.stored;
    return {
      kind: "visual",
      key,
      visualSource: async () => {
        const content = JSON.parse(await readFile(join(this.root, "text", stored), "utf-8")) as ArtifactVersionContent;
        return content.kind === "visual" ? content.source : "";
      },
    };
  }

  /** The newest figure file, for serving. */
  figureFile(id: string): { path: string; ext: string } | null {
    const artifact = this.state().artifacts[id];
    const latest = artifact?.versions.at(-1);
    if (!artifact || artifact.kind !== "figure" || !latest?.kept || !latest.stored) return null;
    return {
      path: join(this.root, "files", latest.stored),
      ext: extname(latest.stored),
    };
  }

  setStarred(id: string, starred: boolean): ArtifactDetail | null {
    const artifact = this.state().artifacts[id];
    if (!artifact) return null;
    if (artifact.starred !== starred) {
      artifact.starred = starred;
      this.dirty = true;
    }
    return this.get(id);
  }

  rename(id: string, title: string): ArtifactDetail | null {
    const artifact = this.state().artifacts[id];
    const trimmed = title.trim();
    if (!artifact || !trimmed) return null;
    artifact.title = trimmed.slice(0, 200);
    artifact.titleSource = "user";
    this.dirty = true;
    return this.get(id);
  }

  /**
   * Makes `fromId`'s versions versions of `intoId`, ordered by time, for revisions that were saved
   * as separate artifacts. Returns the sessions whose messages show a now-older version.
   */
  merge(fromId: string, intoId: string): { artifact: ArtifactDetail; affectedSessions: Set<string> } | null {
    const index = this.state();
    const from = index.artifacts[fromId];
    const into = index.artifacts[intoId];
    if (!from || !into || from === into || from.kind !== into.kind) return null;
    const combined = [
      ...into.versions.map((version) => ({ version, owner: intoId })),
      ...from.versions.map((version) => ({ version, owner: fromId })),
    ].sort((a, b) => a.version.at - b.version.at);
    const renumber = new Map<string, number>();
    into.versions = combined.map(({ version, owner }, position) => {
      renumber.set(`${owner}\n${version.n}`, position + 1);
      return { ...version, n: position + 1 };
    });
    // A figure keeps only its newest file.
    if (into.kind === "figure") {
      for (const version of into.versions.slice(0, -1)) void this.dropFigureFile(version);
    }
    const affectedSessions = new Set<string>();
    for (const [key, entries] of Object.entries(index.messages)) {
      for (const entry of entries) {
        if (entry.artifactId !== fromId && entry.artifactId !== intoId) continue;
        entry.n = renumber.get(`${entry.artifactId}\n${entry.n}`) ?? entry.n;
        entry.artifactId = intoId;
        affectedSessions.add(key.slice(0, key.indexOf("\n")));
      }
    }
    for (const [key, id] of Object.entries(index.keys)) if (id === fromId) index.keys[key] = intoId;
    into.createdAt = Math.min(into.createdAt, from.createdAt);
    into.updatedAt = Math.max(into.updatedAt, from.updatedAt);
    into.starred = into.starred || from.starred;
    const latest = into.versions.at(-1)!;
    if (from.versions.some((version) => version.sha === latest.sha)) {
      into.preview = from.preview;
      if (from.latestParts) into.latestParts = from.latestParts;
    }
    delete index.artifacts[fromId];
    this.dirty = true;
    return { artifact: this.get(intoId)!, affectedSessions };
  }

  /** Writes the index when something changed; writes run one after another. */
  flush(): Promise<void> {
    if (!this.index) return this.writeChain;
    const cursorsDue = this.cursorsChanged && this.now() - this.lastWriteAt >= CURSOR_WRITE_INTERVAL_MS;
    if (!this.dirty && !cursorsDue) return this.writeChain;
    this.dirty = false;
    this.cursorsChanged = false;
    this.lastWriteAt = this.now();
    const json = JSON.stringify(this.index);
    this.writeChain = this.writeChain
      .then(async () => {
        await mkdir(this.root, { recursive: true });
        const tempPath = join(this.root, "index.json.tmp");
        await writeFile(tempPath, json, "utf-8");
        await rename(tempPath, join(this.root, "index.json"));
      })
      .catch((error) => console.error("[artifact-library] Failed to write the index:", error));
    return this.writeChain;
  }

  private state(): LibraryIndex {
    if (!this.index) throw new Error("Artifact library is not loaded");
    return this.index;
  }

  private async writeIfMissing(path: string, content: string): Promise<void> {
    if (await exists(path)) return;
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content, "utf-8");
  }
}

function groupingKey(ctx: CaptureContext, ref: ArtifactMessageRef, capture: MessageCapture): string {
  const scope = `${ctx.sessionId}|${ref.threadKey}`;
  switch (capture.kind) {
    case "post":
      return capture.title
        ? `post|${scope}|t|${normalizeTitle(capture.title)}`
        : `post|${scope}|a|${untitledPostKey(capture.autoTitle)}`;
    case "visual":
      return capture.title
        ? `visual|${scope}|${normalizeTitle(capture.title)}`
        : `visual|${ctx.sessionId}|${ref.messageId}|${capture.label}`;
    case "figure":
      return `figure|${capture.path}`;
    case "table":
      // Each table is its own artifact: tables in later answers are new results, not revisions.
      return `table|${ctx.sessionId}|${ref.messageId}|${capture.label}`;
    case "report":
    case "review":
      return `${capture.kind}|${ctx.space}|${capture.sourcePath}`;
  }
}

/**
 * A post's parts after a revision. A revision with fewer messages than the post had revises some
 * of them ("the other two messages stay as drafted"): each new message replaces the old one with
 * the same first line, and the rest are kept. Otherwise the revision is the whole post.
 */
export function mergePostParts(previous: readonly string[] | undefined, next: string[]): string[] {
  if (!previous || next.length >= previous.length) return next;
  const keyOf = (part: string) => untitledPostKey(part.split("\n").find((line) => line.trim()) ?? "");
  const merged = [...previous];
  const replaced = new Set<number>();
  for (const part of next) {
    const index = merged.findIndex(
      (candidate, position) => !replaced.has(position) && keyOf(candidate) === keyOf(part),
    );
    if (index < 0) {
      merged.push(part);
      continue;
    }
    merged[index] = part;
    replaced.add(index);
  }
  return merged;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function visualAltTitle(source: string): string {
  const alt = /^alt:[ \t]*(.+?)[ \t]*$/im.exec(source.split(/\n---[ \t]*\n/)[0] ?? "")?.[1];
  const text = alt || "Visual";
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

const EXCERPT_CHARS = 700;
const EXCERPT_LINES = 16;

/** The start of a text version, lines kept, for the gallery's text thumbnails. */
export function excerptOf(content: ArtifactVersionContent): string {
  const text =
    content.kind === "post"
      ? content.parts.join("\n\n")
      : content.kind === "report" || content.kind === "review" || content.kind === "table"
        ? content.markdown
        : "";
  const lines = text.replace(/\r/g, "").split("\n").slice(0, EXCERPT_LINES).join("\n").trimEnd();
  return lines.length > EXCERPT_CHARS ? lines.slice(0, EXCERPT_CHARS) : lines;
}

function previewOf(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, PREVIEW_CHARS);
}

function messageIndexKey(sessionId: string, messageId: string): string {
  return `${sessionId}\n${messageId}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function publicVersion(version: StoredVersion): ArtifactVersionSummary {
  const { sha: _sha, stored: _stored, ...rest } = version;
  return rest;
}

function summarize(artifact: StoredArtifact): ArtifactSummary {
  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    space: artifact.space,
    sessionId: artifact.sessionId,
    threadKey: artifact.threadKey,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    starred: artifact.starred,
    versionCount: artifact.versions.length,
    latest: publicVersion(artifact.versions.at(-1)!),
    preview: artifact.preview,
    ...(artifact.excerpt ? { excerpt: artifact.excerpt } : {}),
    ...(thumbKey(artifact) ? { thumb: thumbKey(artifact) } : {}),
  };
}

/** Identifies the newest version's picture thumbnail; none for kinds shown as text, or a figure not kept. */
export function thumbKey(artifact: { kind: ArtifactKind; versions: Array<{ sha: string; kept: boolean }> }) {
  const latest = artifact.versions.at(-1);
  if (!latest) return undefined;
  if (artifact.kind === "visual" || (artifact.kind === "figure" && latest.kept)) return latest.sha.slice(0, 16);
  return undefined;
}
