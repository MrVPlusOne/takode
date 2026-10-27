import type { BrowserIncomingMessage, ThreadWindowEntry } from "./session-types.js";
import {
  ARTIFACT_KINDS,
  formatArtifactPlaceholder,
  type ArtifactKind,
  type ArtifactMessageMarker,
} from "../shared/artifact-library.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { ArtifactLibraryStore, type CaptureResult } from "./artifact-library-store.js";
import {
  assistantMessageId,
  extractFromTextBlocks,
  extractMessageArtifacts,
  messageImageReferences,
  type TextSpan,
} from "./artifact-extract.js";
import type { LocalImageReference } from "../shared/local-image-references.js";

/**
 * Connects the artifact library to conversations. Every session's history is read as it is
 * saved, so artifacts are captured for every leader and worker without any agent action; the
 * month before the library started is read once at startup (backfill). Messages sent to browsers
 * are then projected: a version a newer one replaced shows as one collapsed line whose content is
 * not sent, and a current version carries a marker the feed shows as a "Saved in Library" line.
 */

export interface LibrarySessionLike {
  id: string;
  messageHistory: BrowserIncomingMessage[];
}

export interface ArtifactLibraryDeps {
  getSession: (sessionId: string) => LibrarySessionLike | undefined;
  listSessions: () => LibrarySessionLike[];
  spaceFor: (sessionId: string) => string;
  /** Re-sends a session's conversation to its browsers after its messages' projection changed. */
  refreshConversation: (sessionId: string) => void;
  /** Called for each new version, after it is saved. */
  onNewVersion?: (input: {
    sessionId: string;
    threadKey: string;
    title: string;
    kind: string;
    version: number;
  }) => void;
  /** Called with the local images each new agent answer shows or links, to prepare their previews. */
  onImagesShown?: (sessionId: string, images: LocalImageReference[]) => void;
  /** Called for each new figure version, to prepare its gallery thumbnail. */
  onFigureSaved?: (artifactId: string) => void;
}

const CAPTURE_DELAY_MS = 50;

export class ArtifactLibrary {
  private pending = new Set<string>();
  /** Per session: the newest agent message as last read, which the next read starts from. */
  private lastAgentMessage = new Map<
    string,
    { index: number; message: BrowserIncomingMessage | undefined; blocks: number; readTo: number }
  >();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(
    readonly store: ArtifactLibraryStore,
    private readonly deps: ArtifactLibraryDeps,
  ) {}

  /** Called whenever a session is saved; captures run shortly after, a few sessions at a time. */
  sessionSaved(sessionId: string): void {
    if (!this.store.loaded) return;
    this.pending.add(sessionId);
    this.timer ??= setTimeout(() => {
      this.timer = null;
      const ids = [...this.pending];
      this.pending.clear();
      this.running = this.running.then(() => this.captureSessions(ids, { live: true }));
    }, CAPTURE_DELAY_MS);
  }

  /**
   * Reads every loaded session once, so history from before the library (up to a month) is
   * captured. Kinds the library learned later are read from that history once as well, and so
   * were, once, the messages skipped before the newest message was read again (see `captureSession`).
   */
  backfill(): Promise<void> {
    const ids = this.deps.listSessions().map((session) => session.id);
    this.running = this.running.then(async () => {
      await this.captureSessions(ids, { yieldBetween: true });
      const kinds = this.store.kindsToBackfill();
      if (kinds.length > 0) {
        await this.captureSessions(ids, { yieldBetween: true, onlyKinds: kinds });
        this.store.markKindsBackfilled(kinds);
        await this.store.flush();
      }
      if (this.store.needsSkippedTextReread()) await this.rereadSkippedText(ids);
    });
    return this.running;
  }

  /**
   * Captures, once, what the library skipped while a message's text could arrive after its
   * thinking was read. A skipped draft older than its artifact's newest version is left out:
   * added, it would become the newest and collapse the card that really is. The index is backed up
   * first, and nobody is told about these old versions.
   */
  private async rereadSkippedText(ids: string[]): Promise<void> {
    const backup = await this.store.backUpIndex("skipped-text");
    const before = this.store.list().total;
    let versions = 0;
    await this.captureSessions(ids, {
      yieldBetween: true,
      onlyKinds: ARTIFACT_KINDS.filter((kind) => kind !== "figure"),
      onlyNewer: true,
      quiet: true,
      onVersions: (count) => {
        versions += count;
      },
    });
    this.store.markSkippedTextReread();
    await this.store.flush();
    console.log(
      `[artifact-library] Read history again for skipped captures: ${versions} new version(s), ` +
        `${this.store.list().total - before} of them new artifacts; index backed up to ${backup}`,
    );
  }

  spaceFor(sessionId: string): string {
    return this.deps.spaceFor(sessionId);
  }

  refreshConversation(sessionId: string): void {
    this.deps.refreshConversation(sessionId);
  }

  /** Waits for captures already scheduled or running; for tests and shutdown. */
  async idle(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      const ids = [...this.pending];
      this.pending.clear();
      this.running = this.running.then(() => this.captureSessions(ids, { live: true }));
    }
    await this.running;
    await this.store.flush();
  }

  private async captureSessions(
    ids: string[],
    options: {
      yieldBetween?: boolean;
      onlyKinds?: readonly ArtifactKind[];
      /** New messages, rather than history read at startup: their images are prepared. */
      live?: boolean;
      /** Skip captures older than their artifact's newest version (see `rereadSkippedText`). */
      onlyNewer?: boolean;
      /** Old versions found late: nobody is told about them. */
      quiet?: boolean;
      onVersions?: (count: number) => void;
    } = {},
  ): Promise<void> {
    const toRefresh = new Set<string>();
    for (const id of ids) {
      const session = this.deps.getSession(id);
      if (!session) continue;
      try {
        const result = options.onlyKinds
          ? await this.captureKinds(session, options.onlyKinds, options.onlyNewer ?? false)
          : await this.captureSession(session, options.live ?? false);
        if (result.captured > 0) toRefresh.add(id);
        options.onVersions?.(result.newVersions?.length ?? 0);
        for (const added of options.quiet ? [] : (result.newVersions ?? [])) {
          const artifact = this.store.get(added.artifactId);
          if (!artifact) continue;
          if (options.live && artifact.kind === "figure") this.deps.onFigureSaved?.(artifact.id);
          this.deps.onNewVersion?.({
            sessionId: id,
            threadKey: added.threadKey,
            title: artifact.title,
            kind: artifact.kind,
            version: added.n,
          });
        }
        for (const affected of result.affectedSessions) toRefresh.add(affected);
      } catch (error) {
        console.error(`[artifact-library] Capture failed for session ${id}:`, error);
      }
      if (options.yieldBetween) await new Promise((resolve) => setImmediate(resolve));
    }
    await this.store.flush();
    for (const id of toRefresh) this.deps.refreshConversation(id);
  }

  /**
   * Reads a session's messages since the last read. The newest agent message is read again next
   * time, since it can still grow: Claude sends a message's thinking and its text as separate parts,
   * and the text joins the row already saved (in place, or replacing it). Reading the thinking alone
   * and moving past it lost every draft, table and report in that text.
   */
  private async captureSession(session: LibrarySessionLike, live: boolean): Promise<CaptureResult> {
    const result: CaptureResult = { captured: 0, affectedSessions: new Set(), newVersions: [] };
    const history = session.messageHistory;
    const length = history.length;
    const start = this.store.cursorFor(session.id, history, (index) => historyMessageId(history[index]));
    const cutoff = this.store.backfillCutoff();
    const space = this.deps.spaceFor(session.id);
    const reread = this.lastAgentMessage.get(session.id);
    let next = length;
    for (let index = start; index < length; index += 1) {
      const message = history[index];
      if (!message || !isRootAgentHistoryMessage(message)) continue;
      if (message.type === "assistant") next = index;
      // Read last time and unchanged: only the newest agent message can have grown since.
      if (reread && index < reread.readTo) {
        const grown =
          index === reread.index && (message !== reread.message || contentBlockCount(message) !== reread.blocks);
        if (!grown) continue;
      }
      const at = (message as { timestamp?: unknown }).timestamp;
      if (typeof at === "number" && at < cutoff) continue;
      if (live) {
        const images = messageImageReferences(message);
        if (images.length > 0) this.deps.onImagesShown?.(session.id, images);
      }
      const extracted = extractMessageArtifacts(message);
      if (!extracted) continue;
      await this.store.captureMessage({ sessionId: session.id, space }, extracted, result);
    }
    if (next < length) {
      const message = history[next];
      this.lastAgentMessage.set(session.id, {
        index: next,
        message,
        blocks: contentBlockCount(message),
        readTo: length,
      });
    } else {
      this.lastAgentMessage.delete(session.id);
    }
    this.store.setCursor(session.id, next, next > 0 ? historyMessageId(history[next - 1]) : undefined);
    return result;
  }

  /** Reads a session's whole history (within the backfill month) for some kinds only, leaving its cursor alone. */
  private async captureKinds(
    session: LibrarySessionLike,
    kinds: readonly ArtifactKind[],
    onlyNewer: boolean,
  ): Promise<CaptureResult> {
    const result: CaptureResult = { captured: 0, affectedSessions: new Set(), newVersions: [] };
    const cutoff = this.store.backfillCutoff();
    const space = this.deps.spaceFor(session.id);
    for (const message of session.messageHistory) {
      if (!message || !isRootAgentHistoryMessage(message)) continue;
      const at = (message as { timestamp?: unknown }).timestamp;
      if (typeof at === "number" && at < cutoff) continue;
      const extracted = extractMessageArtifacts(message);
      if (!extracted?.captures.some((capture) => kinds.includes(capture.kind))) continue;
      await this.store.captureMessage({ sessionId: session.id, space }, extracted, result, {
        onlyKinds: kinds,
        onlyNewer,
      });
    }
    return result;
  }

  /** Projects history messages for a browser; returns the input array when nothing changes. */
  projectMessages(sessionId: string, messages: BrowserIncomingMessage[]): BrowserIncomingMessage[] {
    let projected: BrowserIncomingMessage[] | null = null;
    for (let index = 0; index < messages.length; index += 1) {
      const message = this.projectMessage(sessionId, messages[index]);
      if (message === messages[index] && !projected) continue;
      projected ??= messages.slice(0, index);
      projected.push(message);
    }
    return projected ?? messages;
  }

  projectThreadEntries(sessionId: string, entries: ThreadWindowEntry[]): ThreadWindowEntry[] {
    let changed = false;
    const projected = entries.map((entry) => {
      const message = this.projectMessage(sessionId, entry.message);
      if (message === entry.message) return entry;
      changed = true;
      return { ...entry, message };
    });
    return changed ? projected : entries;
  }

  projectMessage(sessionId: string, message: BrowserIncomingMessage): BrowserIncomingMessage {
    if (!this.store.loaded) return message;
    const messageId =
      message.type === "markdown_report"
        ? message.id
        : message.type === "assistant"
          ? assistantMessageId(message)
          : undefined;
    if (!messageId) return message;
    const markers = this.store.markersForMessage(sessionId, messageId);
    if (markers.length === 0) return message;
    const current = markers.filter((entry) => !entry.superseded).map((entry) => entry.marker);
    if (message.type === "markdown_report") {
      const [only] = markers;
      return only.superseded
        ? { ...message, content: formatArtifactPlaceholder(only.marker) }
        : { ...message, artifacts: current };
    }
    if (message.type !== "assistant") return message;
    const superseded = new Map(
      markers.filter((entry) => entry.superseded).map((entry) => [entry.label, entry] as const),
    );
    const withMarkers = { ...message, artifacts: current };
    if (superseded.size === 0) return withMarkers;
    const content = message.message?.content;
    if (!Array.isArray(content)) return withMarkers;
    const texts = content.map((block) =>
      block && block.type === "text" && typeof block.text === "string" ? block.text : null,
    );
    const edits = new Map<number, Array<{ span: TextSpan; replacement: string }>>();
    for (const capture of extractFromTextBlocks(texts)) {
      const entry = superseded.get(capture.label);
      if (!entry || !("spans" in capture)) continue;
      // A post's message the newest version still has stays; only the replaced ones collapse. A
      // copy of the newest version that a later message repeats collapses whole.
      const latestParts = capture.kind === "post" && !entry.marker.repeated ? entry.latestParts : undefined;
      const replacedParts = capture.spans
        .map((_, part) => part)
        .filter((part) => !latestParts || !latestParts.includes(capture.kind === "post" ? capture.parts[part] : ""));
      const marker =
        replacedParts.length < capture.spans.length ? { ...entry.marker, parts: replacedParts } : entry.marker;
      replacedParts.forEach((part, position) => {
        const span = capture.spans[part];
        const list = edits.get(span.block) ?? [];
        list.push({
          span,
          replacement: position === 0 ? collapsedLine(marker) : "",
        });
        edits.set(span.block, list);
      });
    }
    if (edits.size === 0) return withMarkers;
    return {
      ...withMarkers,
      message: {
        ...message.message,
        content: content.map((block, blockIndex) => {
          const blockEdits = edits.get(blockIndex);
          if (!blockEdits || block.type !== "text") return block;
          let text = block.text;
          for (const { span, replacement } of blockEdits.sort((a, b) => b.span.start - a.span.start)) {
            text = text.slice(0, span.start) + replacement + text.slice(span.end);
          }
          return { ...block, text };
        }),
      },
    };
  }
}

/** The placeholder on its own lines, so it renders as a block even where an image sat inside a paragraph. */
function collapsedLine(marker: ArtifactMessageMarker): string {
  return `\n${formatArtifactPlaceholder(marker)}\n`;
}

function contentBlockCount(message: BrowserIncomingMessage | undefined): number {
  const content = message?.type === "assistant" ? message.message?.content : undefined;
  return Array.isArray(content) ? content.length : 0;
}

function historyMessageId(message: BrowserIncomingMessage | undefined): string | undefined {
  if (!message) return undefined;
  if (message.type === "assistant") return assistantMessageId(message);
  const record = message as { id?: unknown; uuid?: unknown };
  if (typeof record.id === "string") return record.id;
  return typeof record.uuid === "string" ? record.uuid : undefined;
}

let activeLibrary: ArtifactLibrary | null = null;

/** The server's library, once started; null in tests and before startup, where nothing is projected. */
export function getArtifactLibrary(): ArtifactLibrary | null {
  return activeLibrary;
}

export function setArtifactLibrary(library: ArtifactLibrary | null): void {
  activeLibrary = library;
}

/** Hook for session saves; does nothing until the library is started. */
const sessionSaveListeners: Array<(sessionId: string) => void> = [];

/** Other Library parts (topics) that read sessions as they are saved. */
export function addSessionSaveListener(listener: (sessionId: string) => void): void {
  sessionSaveListeners.push(listener);
}

export function notifySessionSavedForArtifacts(sessionId: string): void {
  activeLibrary?.sessionSaved(sessionId);
  for (const listener of sessionSaveListeners) listener(sessionId);
}

export function projectArtifactsInMessages(
  sessionId: string,
  messages: BrowserIncomingMessage[],
): BrowserIncomingMessage[] {
  return activeLibrary ? activeLibrary.projectMessages(sessionId, messages) : messages;
}

export function projectArtifactsInThreadEntries(sessionId: string, entries: ThreadWindowEntry[]): ThreadWindowEntry[] {
  return activeLibrary ? activeLibrary.projectThreadEntries(sessionId, entries) : entries;
}
