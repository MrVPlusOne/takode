import { mkdirSync } from "node:fs";
import { readdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
  SessionState,
  BrowserIncomingMessage,
  PermissionRequest,
  BufferedBrowserEvent,
  SessionTaskEntry,
} from "./session-types.js";

// ─── Serializable session shape ─────────────────────────────────────────────

export interface PersistedSession {
  id: string;
  state: SessionState;
  messageHistory: BrowserIncomingMessage[];
  pendingMessages: string[];
  pendingPermissions: [string, PermissionRequest][];
  eventBuffer?: BufferedBrowserEvent[];
  nextEventSeq?: number;
  lastAckSeq?: number;
  processedClientMessageIds?: string[];
  archived?: boolean;
  /** Epoch ms when this session was archived */
  archivedAt?: number;
  /** Serialized Map entries for full tool results (tool_use_id → result) */
  toolResults?: [string, { content: string; is_error: boolean; timestamp: number }][];
  /** Epoch ms when the user last viewed this session (server-authoritative) */
  lastReadAt?: number;
  /** Current attention reason: why this session needs the user's attention */
  attentionReason?: "action" | "error" | "review" | null;
  /** High-level task history recognized by the session auto-namer */
  taskHistory?: SessionTaskEntry[];
  /** Accumulated search keywords from the session auto-namer */
  keywords?: string[];
}

// ─── Store ──────────────────────────────────────────────────────────────────

const DEFAULT_BASE_DIR = join(homedir(), ".companion", "sessions");

export class SessionStore {
  private dir: string;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingSaves = new Map<string, PersistedSession>();
  /** Track in-flight async writes so flushAll can await them. */
  private inflightWrites = new Set<Promise<unknown>>();

  constructor(dir?: string, port?: number) {
    if (dir) {
      this.dir = dir;
    } else {
      // Isolate storage per port so dev/prod servers don't share state
      this.dir = port ? join(DEFAULT_BASE_DIR, String(port)) : DEFAULT_BASE_DIR;
    }
    mkdirSync(this.dir, { recursive: true });
  }

  private filePath(sessionId: string): string {
    return join(this.dir, `${sessionId}.json`);
  }

  /** Debounced write — batches rapid changes (e.g. multiple stream events). */
  save(session: PersistedSession): void {
    const existing = this.debounceTimers.get(session.id);
    if (existing) clearTimeout(existing);

    this.pendingSaves.set(session.id, session);
    const timer = setTimeout(() => {
      this.debounceTimers.delete(session.id);
      this.pendingSaves.delete(session.id);
      this.saveSync(session);
    }, 150);
    this.debounceTimers.set(session.id, timer);
  }

  /**
   * Fire-and-forget async write — does not block the event loop.
   * Despite the "Sync" name (kept for API compatibility), this now uses
   * async fs internally. Errors are logged but never thrown.
   */
  saveSync(session: PersistedSession): void {
    const data = JSON.stringify(session);
    const p = writeFile(this.filePath(session.id), data, "utf-8")
      .catch((err) => {
        console.error(`[session-store] Failed to save session ${session.id}:`, err);
      })
      .finally(() => {
        this.inflightWrites.delete(p);
      });
    this.inflightWrites.add(p);
  }

  /** Load a single session from disk. */
  async load(sessionId: string): Promise<PersistedSession | null> {
    try {
      const raw = await readFile(this.filePath(sessionId), "utf-8");
      return JSON.parse(raw) as PersistedSession;
    } catch {
      return null;
    }
  }

  /** Load all sessions from disk. */
  async loadAll(): Promise<PersistedSession[]> {
    const sessions: PersistedSession[] = [];
    try {
      const files = (await readdir(this.dir)).filter(
        (f) => f.endsWith(".json") && f !== "launcher.json",
      );
      for (const file of files) {
        try {
          const raw = await readFile(join(this.dir, file), "utf-8");
          sessions.push(JSON.parse(raw));
        } catch {
          // Skip corrupt files
        }
      }
    } catch {
      // Dir doesn't exist yet
    }
    return sessions;
  }

  /** Set the archived flag on a persisted session. */
  async setArchived(sessionId: string, archived: boolean): Promise<boolean> {
    const session = await this.load(sessionId);
    if (!session) return false;
    session.archived = archived;
    session.archivedAt = archived ? Date.now() : undefined;
    this.saveSync(session);
    return true;
  }

  /** Flush all pending debounced saves and await in-flight writes. Call before shutdown. */
  async flushAll(): Promise<void> {
    for (const [, timer] of this.debounceTimers) {
      clearTimeout(timer);
    }
    for (const [, session] of this.pendingSaves) {
      this.saveSync(session);
    }
    this.debounceTimers.clear();
    this.pendingSaves.clear();
    // Wait for all in-flight writes to complete
    await Promise.allSettled([...this.inflightWrites]);
  }

  /** Remove a session file from disk. */
  remove(sessionId: string): void {
    const timer = this.debounceTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(sessionId);
    }
    this.pendingSaves.delete(sessionId);
    const p = unlink(this.filePath(sessionId))
      .catch(() => { /* File may not exist */ })
      .finally(() => { this.inflightWrites.delete(p); });
    this.inflightWrites.add(p);
  }

  /** Persist launcher state (separate file). */
  saveLauncher(data: unknown): void {
    const p = writeFile(join(this.dir, "launcher.json"), JSON.stringify(data), "utf-8")
      .catch((err) => { console.error("[session-store] Failed to save launcher state:", err); })
      .finally(() => { this.inflightWrites.delete(p); });
    this.inflightWrites.add(p);
  }

  /** Load launcher state. */
  async loadLauncher<T>(): Promise<T | null> {
    try {
      const raw = await readFile(join(this.dir, "launcher.json"), "utf-8");
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  get directory(): string {
    return this.dir;
  }
}
