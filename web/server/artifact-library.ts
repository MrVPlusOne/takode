import type { BrowserIncomingMessage, ThreadWindowEntry } from "./session-types.js";
import { formatArtifactPlaceholder, type ArtifactMessageMarker } from "../shared/artifact-library.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { ArtifactLibraryStore, type CaptureResult } from "./artifact-library-store.js";
import {
  assistantMessageId,
  extractFromTextBlocks,
  extractMessageArtifacts,
  type TextSpan,
} from "./artifact-extract.js";

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
}

const CAPTURE_DELAY_MS = 50;

export class ArtifactLibrary {
  private pending = new Set<string>();
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
      this.running = this.running.then(() => this.captureSessions(ids));
    }, CAPTURE_DELAY_MS);
  }

  /** Reads every loaded session once, so history from before the library (up to a month) is captured. */
  backfill(): Promise<void> {
    const ids = this.deps.listSessions().map((session) => session.id);
    this.running = this.running.then(() => this.captureSessions(ids, { yieldBetween: true }));
    return this.running;
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
      this.running = this.running.then(() => this.captureSessions(ids));
    }
    await this.running;
    await this.store.flush();
  }

  private async captureSessions(ids: string[], options: { yieldBetween?: boolean } = {}): Promise<void> {
    const toRefresh = new Set<string>();
    for (const id of ids) {
      const session = this.deps.getSession(id);
      if (!session) continue;
      try {
        const result = await this.captureSession(session);
        if (result.captured > 0) toRefresh.add(id);
        for (const affected of result.affectedSessions) toRefresh.add(affected);
      } catch (error) {
        console.error(`[artifact-library] Capture failed for session ${id}:`, error);
      }
      if (options.yieldBetween) await new Promise((resolve) => setImmediate(resolve));
    }
    await this.store.flush();
    for (const id of toRefresh) this.deps.refreshConversation(id);
  }

  private async captureSession(session: LibrarySessionLike): Promise<CaptureResult> {
    const result: CaptureResult = { captured: 0, affectedSessions: new Set() };
    const history = session.messageHistory;
    const length = history.length;
    const start = this.store.cursorFor(session.id, history, (index) => historyMessageId(history[index]));
    const cutoff = this.store.backfillCutoff();
    const space = this.deps.spaceFor(session.id);
    for (let index = start; index < length; index += 1) {
      const message = history[index];
      if (!message || !isRootAgentHistoryMessage(message)) continue;
      const at = (message as { timestamp?: unknown }).timestamp;
      if (typeof at === "number" && at < cutoff) continue;
      const extracted = extractMessageArtifacts(message);
      if (!extracted) continue;
      await this.store.captureMessage({ sessionId: session.id, space }, extracted, result);
    }
    this.store.setCursor(session.id, length, length > 0 ? historyMessageId(history[length - 1]) : undefined);
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
      // A post's message the newest version still has stays; only the replaced ones collapse.
      const latestParts = capture.kind === "post" ? entry.latestParts : undefined;
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
export function notifySessionSavedForArtifacts(sessionId: string): void {
  activeLibrary?.sessionSaved(sessionId);
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
