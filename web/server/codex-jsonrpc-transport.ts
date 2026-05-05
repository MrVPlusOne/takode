import { randomUUID } from "node:crypto";
import type { RecorderManager } from "./recorder.js";
import { getTrafficMessageType, trafficStats } from "./traffic-stats.js";

export interface JsonRpcRequest {
  method: string;
  id: number;
  params: Record<string, unknown>;
}

export interface JsonRpcNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface JsonRpcMessageSummary {
  direction: "in" | "out";
  ts: number;
  bytes: number;
  method: string | null;
  id: number | null;
  kind: "request" | "notification" | "response" | "invalid_json";
}

export interface JsonRpcPendingRequestSummary {
  id: number;
  method: string;
  ageMs: number;
}

export interface JsonRpcTransportCloseDiagnostics {
  closeId: string;
  sessionId: string;
  closedAt: number;
  closeContext: string;
  bufferedChars: number;
  pendingRequests: JsonRpcPendingRequestSummary[];
  recentIncoming: JsonRpcMessageSummary[];
  recentOutgoing: JsonRpcMessageSummary[];
  lastIncomingAt: number | null;
  lastOutgoingAt: number | null;
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class JsonRpcTransport {
  private nextId = 1;
  private pending = new Map<
    number,
    { method: string; createdAt: number; resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private notificationHandler: ((method: string, params: Record<string, unknown>) => void) | null = null;
  private requestHandler: ((method: string, id: number, params: Record<string, unknown>) => void) | null = null;
  private rawInCbs: Array<(line: string) => void> = [];
  private rawOutCbs: Array<(data: string) => void> = [];
  private closeCb: (() => void) | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private connected = true;
  private buffer = "";
  private closeContext = "unknown";
  private sessionId: string;
  private recentIncoming: JsonRpcMessageSummary[] = [];
  private recentOutgoing: JsonRpcMessageSummary[] = [];
  private lastIncomingAt: number | null = null;
  private lastOutgoingAt: number | null = null;
  private lastCloseDiagnostics: JsonRpcTransportCloseDiagnostics | null = null;
  private recorder?: RecorderManager;
  private cwd: string;
  private static readonly RECENT_MESSAGE_SUMMARY_LIMIT = 12;

  constructor(
    stdin: WritableStream<Uint8Array> | { write(data: Uint8Array): number },
    stdout: ReadableStream<Uint8Array>,
    sessionId: string,
    recorder?: RecorderManager,
    cwd = "",
  ) {
    this.sessionId = sessionId;
    this.recorder = recorder;
    this.cwd = cwd;
    let writable: WritableStream<Uint8Array>;
    if ("write" in stdin && typeof stdin.write === "function") {
      const bunStdin = stdin as { write(data: Uint8Array): number };
      writable = new WritableStream({
        async write(chunk) {
          let offset = 0;
          while (offset < chunk.length) {
            const written = bunStdin.write(offset === 0 ? chunk : chunk.subarray(offset));
            if (written <= 0) {
              await new Promise<void>((r) => setTimeout(r, 1));
              continue;
            }
            offset += written;
          }
        },
      });
    } else {
      writable = stdin as WritableStream<Uint8Array>;
    }
    this.writer = writable.getWriter();

    this.onRawIncoming((line) => {
      recorder?.record(sessionId, "in", line, "cli", "codex", cwd);
      let messageType = "invalid_json";
      try {
        messageType = getTrafficMessageType(JSON.parse(line) as Record<string, unknown>);
      } catch {}
      trafficStats.record({
        sessionId,
        channel: "cli",
        direction: "in",
        messageType,
        payloadBytes: Buffer.byteLength(line, "utf-8"),
      });
    });
    this.onRawOutgoing((data) => {
      recorder?.record(sessionId, "out", data.trimEnd(), "cli", "codex", cwd);
      let messageType = "invalid_json";
      try {
        messageType = getTrafficMessageType(JSON.parse(data) as Record<string, unknown>);
      } catch {}
      trafficStats.record({
        sessionId,
        channel: "cli",
        direction: "out",
        messageType,
        payloadBytes: Buffer.byteLength(data, "utf-8"),
      });
    });

    this.readStdout(stdout);
  }

  private async readStdout(stdout: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          this.closeContext = `stdout_eof(buffer=${this.buffer.length})`;
          break;
        }
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } catch (err) {
      this.closeContext = `stdout_read_error:${err instanceof Error ? err.message : String(err)}`;
      console.error("[codex-adapter] stdout reader error:", err);
    } finally {
      this.connected = false;
      this.lastCloseDiagnostics = this.buildCloseDiagnostics();
      this.recorder?.recordServerEvent(
        this.sessionId,
        "codex_transport_closed",
        this.lastCloseDiagnostics as unknown as Record<string, unknown>,
        "codex",
        this.cwd,
      );
      for (const [, { reject }] of this.pending) {
        reject(new Error("Transport closed"));
      }
      this.pending.clear();
      this.closeCb?.();
    }
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.recordMessageSummary("in", trimmed);
      for (const cb of this.rawInCbs) cb(trimmed);

      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        console.warn("[codex-adapter] Failed to parse JSON-RPC:", trimmed.substring(0, 200));
        continue;
      }

      this.dispatch(msg);
    }
  }

  private dispatch(msg: JsonRpcMessage): void {
    if ("id" in msg && msg.id !== undefined) {
      if ("method" in msg && msg.method) {
        try {
          this.requestHandler?.(msg.method, msg.id as number, (msg as JsonRpcRequest).params || {});
        } catch (err) {
          console.error(`[codex-adapter] Request handler failed for ${msg.method}:`, err);
        }
      } else {
        const pending = this.pending.get(msg.id as number);
        if (pending) {
          this.pending.delete(msg.id as number);
          const resp = msg as JsonRpcResponse;
          if (resp.error) {
            pending.reject(new Error(resp.error.message));
          } else {
            pending.resolve(resp.result);
          }
        }
      }
    } else if ("method" in msg) {
      try {
        this.notificationHandler?.(msg.method, (msg as JsonRpcNotification).params || {});
      } catch (err) {
        console.error(`[codex-adapter] Notification handler failed for ${msg.method}:`, err);
      }
    }
  }

  call(method: string, params: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    return this.request(method, params, timeoutMs).promise;
  }

  request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): { id: number; promise: Promise<unknown> } {
    const id = this.nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const settle =
        <T extends unknown[]>(fn: (...args: T) => void) =>
        (...args: T) => {
          if (timeout) clearTimeout(timeout);
          fn(...args);
        };
      this.pending.set(id, { method, createdAt: Date.now(), resolve: settle(resolve), reject: settle(reject) });
      if (timeoutMs && timeoutMs > 0) {
        timeout = setTimeout(() => {
          if (!this.pending.delete(id)) return;
          reject(new Error(`${method} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }
      const request = JSON.stringify({ method, id, params });
      this.writeRaw(request + "\n").catch((err) => {
        if (timeout) clearTimeout(timeout);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
    return { id, promise };
  }

  async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const notification = JSON.stringify({ method, params });
    await this.writeRaw(notification + "\n");
  }

  async respond(id: number, result: unknown): Promise<void> {
    const response = JSON.stringify({ id, result });
    await this.writeRaw(response + "\n");
  }

  onNotification(handler: (method: string, params: Record<string, unknown>) => void): void {
    this.notificationHandler = handler;
  }

  onRequest(handler: (method: string, id: number, params: Record<string, unknown>) => void): void {
    this.requestHandler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onRawIncoming(cb: (line: string) => void): void {
    this.rawInCbs.push(cb);
  }

  onRawOutgoing(cb: (data: string) => void): void {
    this.rawOutCbs.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
  }

  getPendingIds(): number[] {
    return [...this.pending.keys()];
  }

  getPendingRequests(): JsonRpcPendingRequestSummary[] {
    return this.summarizePendingRequests(Date.now());
  }

  getCloseContext(): string {
    return this.closeContext;
  }

  getCloseDiagnostics(): JsonRpcTransportCloseDiagnostics | null {
    return this.lastCloseDiagnostics;
  }

  private async writeRaw(data: string): Promise<void> {
    if (!this.connected) {
      throw new Error("Transport closed");
    }
    this.recordMessageSummary("out", data.trimEnd());
    for (const cb of this.rawOutCbs) cb(data);
    try {
      await this.writer.write(new TextEncoder().encode(data));
    } catch (err) {
      console.error(
        `[codex-adapter] stdin write failed for session ${this.sessionId}:`,
        err instanceof Error ? err.message : String(err),
      );
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  private buildCloseDiagnostics(): JsonRpcTransportCloseDiagnostics {
    const closedAt = Date.now();
    return {
      closeId: randomUUID(),
      sessionId: this.sessionId,
      closedAt,
      closeContext: this.closeContext,
      bufferedChars: this.buffer.length,
      pendingRequests: this.summarizePendingRequests(closedAt),
      recentIncoming: [...this.recentIncoming],
      recentOutgoing: [...this.recentOutgoing],
      lastIncomingAt: this.lastIncomingAt,
      lastOutgoingAt: this.lastOutgoingAt,
    };
  }

  private summarizePendingRequests(now: number): JsonRpcPendingRequestSummary[] {
    return [...this.pending.entries()].map(([id, pending]) => ({
      id,
      method: pending.method,
      ageMs: Math.max(0, now - pending.createdAt),
    }));
  }

  private recordMessageSummary(direction: "in" | "out", raw: string): void {
    const summary = summarizeJsonRpcMessage(direction, raw);
    const target = direction === "in" ? this.recentIncoming : this.recentOutgoing;
    target.push(summary);
    if (target.length > JsonRpcTransport.RECENT_MESSAGE_SUMMARY_LIMIT) target.shift();
    if (direction === "in") this.lastIncomingAt = summary.ts;
    else this.lastOutgoingAt = summary.ts;
  }
}

function summarizeJsonRpcMessage(direction: "in" | "out", raw: string): JsonRpcMessageSummary {
  const bytes = Buffer.byteLength(raw, "utf-8");
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const method = typeof parsed.method === "string" ? parsed.method : null;
    const id = typeof parsed.id === "number" ? parsed.id : null;
    const kind: JsonRpcMessageSummary["kind"] = method ? (id !== null ? "request" : "notification") : "response";
    return { direction, ts: Date.now(), bytes, method, id, kind };
  } catch {
    return { direction, ts: Date.now(), bytes, method: null, id: null, kind: "invalid_json" };
  }
}
