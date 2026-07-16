import { randomUUID } from "node:crypto";
import type { CodexUpstreamProgressState } from "./session-types.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface CodexUpstreamProgressProxyRegistry {
  registerSessionUpstream(sessionId: string, upstreamBaseUrl: string, options?: { containerized?: boolean }): string;
}

interface ProxyEntry {
  sessionId: string;
  upstreamBaseUrl: string;
}

interface RequestProgress {
  eventCount: number;
  requestId: string;
  safeContent: string;
  startedAt: number;
}

export class CodexUpstreamProgressProxy implements CodexUpstreamProgressProxyRegistry {
  private byToken = new Map<string, ProxyEntry>();
  private tokenBySession = new Map<string, string>();

  constructor(
    private readonly options: {
      port: number;
      emitProgress: (sessionId: string, progress: CodexUpstreamProgressState) => void;
      fetchImpl?: FetchLike;
      now?: () => number;
      tokenFactory?: () => string;
    },
  ) {}

  registerSessionUpstream(sessionId: string, upstreamBaseUrl: string, options?: { containerized?: boolean }): string {
    const previous = this.tokenBySession.get(sessionId);
    if (previous) this.byToken.delete(previous);
    const token = this.options.tokenFactory?.() ?? randomUUID();
    this.tokenBySession.set(sessionId, token);
    this.byToken.set(token, { sessionId, upstreamBaseUrl: normalizeBaseUrl(upstreamBaseUrl) });
    const host = options?.containerized
      ? process.env.COMPANION_CONTAINER_SDK_HOST || "host.docker.internal"
      : "127.0.0.1";
    return "http://" + host + ":" + this.options.port + "/api/codex-upstream-progress-proxy/" + token + "/v1";
  }

  async handleRequest(request: Request, token: string, proxiedPath: string): Promise<Response> {
    const entry = this.byToken.get(token);
    if (!entry) return new Response("Unknown proxy token", { status: 404 });

    const targetUrl = buildUpstreamUrl(entry.upstreamBaseUrl, stripProxyVersionPrefix(proxiedPath), request.url);
    const upstreamResponse = await (this.options.fetchImpl ?? fetch)(targetUrl, {
      method: request.method,
      headers: filterHeaders(request.headers),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual",
    });

    const responseHeaders = filterHeaders(upstreamResponse.headers);
    const contentType = upstreamResponse.headers.get("content-type") || "";
    if (!upstreamResponse.body || !contentType.toLowerCase().includes("text/event-stream")) {
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      });
    }

    responseHeaders.delete("content-length");
    const progress: RequestProgress = {
      eventCount: 0,
      requestId: this.options.tokenFactory?.() ?? randomUUID(),
      safeContent: "",
      startedAt: this.now(),
    };
    this.emit(entry.sessionId, progress, "proxy.stream_start", "stream_start", true);
    const body = this.instrumentSseBody(entry, upstreamResponse.body, progress);
    return new Response(body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  private instrumentSseBody(
    entry: ProxyEntry,
    body: ReadableStream<Uint8Array>,
    progress: RequestProgress,
  ): ReadableStream<Uint8Array> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const parser = new SafeSseProgressParser((eventName, data) =>
      this.handleSseEvent(entry, progress, eventName, data),
    );
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await reader.read();
        if (chunk.done) {
          const tail = decoder.decode();
          if (tail) parser.push(tail);
          parser.finish();
          controller.close();
          return;
        }
        parser.push(decoder.decode(chunk.value, { stream: true }));
        controller.enqueue(chunk.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });
  }

  private handleSseEvent(entry: ProxyEntry, progress: RequestProgress, eventName: string, data: string): void {
    const parsed = parseJsonObject(data);
    const eventType = eventName || stringField(parsed, "type") || "message";
    if (isOrdinaryOutputTextDelta(eventType)) return;
    const safeDelta = extractSafeSummaryText(eventType, parsed);
    if (safeDelta) progress.safeContent += safeDelta;
    const phase = phaseForEvent(eventType, parsed);
    const terminal =
      phase === "response_completed" ||
      phase === "response_failed" ||
      phase === "response_incomplete" ||
      phase === "stream_done";
    this.emit(entry.sessionId, progress, eventType, phase, !terminal, parsed);
  }

  private emit(
    sessionId: string,
    progress: RequestProgress,
    eventType: string,
    phase: CodexUpstreamProgressState["phase"],
    active: boolean,
    parsed?: Record<string, unknown>,
  ): void {
    progress.eventCount += 1;
    this.options.emitProgress(sessionId, {
      source: "copilot",
      active,
      event_count: progress.eventCount,
      event_type: eventType,
      elapsed_ms: Math.max(0, this.now() - progress.startedAt),
      has_safe_content: progress.safeContent.trim().length > 0,
      phase,
      request_id: progress.requestId,
      timestamp: this.now(),
      item_type: itemType(parsed),
      part_type: partType(parsed),
      safe_content: progress.safeContent || undefined,
      status: statusField(parsed),
    });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}

class SafeSseProgressParser {
  private buffer = "";

  constructor(private readonly onEvent: (eventName: string, data: string) => void) {}

  push(text: string): void {
    this.buffer += text;
    let boundary = findSseBoundary(this.buffer);
    while (boundary !== null) {
      const rawEvent = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      this.parseEvent(rawEvent);
      boundary = findSseBoundary(this.buffer);
    }
  }

  finish(): void {
    if (this.buffer.trim()) this.parseEvent(this.buffer);
    this.buffer = "";
    this.onEvent("done", "[DONE]");
  }

  private parseEvent(rawEvent: string): void {
    let eventName = "";
    const dataLines: string[] = [];
    for (const line of rawEvent.split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice("event:".length).trim();
      if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    this.onEvent(data === "[DONE]" ? "done" : eventName, data);
  }
}

function filterHeaders(headers: Headers): Headers {
  const out = new Headers(headers);
  for (const header of HOP_BY_HOP_HEADERS) out.delete(header);
  return out;
}

function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

function stripProxyVersionPrefix(path: string): string {
  return path === "/v1" ? "" : path.startsWith("/v1/") ? path.slice(3) : path;
}

function buildUpstreamUrl(upstreamBaseUrl: string, proxiedPath: string, originalUrl: string): string {
  const original = new URL(originalUrl);
  const suffix = proxiedPath.startsWith("/") ? proxiedPath : "/" + proxiedPath;
  return normalizeBaseUrl(upstreamBaseUrl) + suffix + original.search;
}

function findSseBoundary(input: string): { index: number; length: number } | null {
  const lf = input.indexOf("\n\n");
  const crlf = input.indexOf("\r\n\r\n");
  if (lf === -1) return crlf === -1 ? null : { index: crlf, length: 4 };
  if (crlf === -1 || lf < crlf) return { index: lf, length: 2 };
  return { index: crlf, length: 4 };
}

function parseJsonObject(data: string): Record<string, unknown> | undefined {
  if (!data || data === "[DONE]") return undefined;
  try {
    const parsed = JSON.parse(data);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function stringField(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key];
  return typeof value === "string" ? value : undefined;
}

function itemType(input: Record<string, unknown> | undefined): string | undefined {
  const item = input?.item;
  if (item && typeof item === "object" && !Array.isArray(item))
    return stringField(item as Record<string, unknown>, "type");
  return stringField(input, "item_type");
}

function partType(input: Record<string, unknown> | undefined): string | undefined {
  const part = input?.part;
  if (part && typeof part === "object" && !Array.isArray(part))
    return stringField(part as Record<string, unknown>, "type");
  return stringField(input, "part_type");
}

function statusField(input: Record<string, unknown> | undefined): string | undefined {
  const response = input?.response;
  if (response && typeof response === "object" && !Array.isArray(response))
    return stringField(response as Record<string, unknown>, "status");
  return stringField(input, "status");
}

function phaseForEvent(
  eventType: string,
  parsed: Record<string, unknown> | undefined,
): CodexUpstreamProgressState["phase"] {
  if (eventType === "done") return "stream_done";
  if (eventType === "response.created") return "response_created";
  if (eventType === "response.in_progress") return "response_in_progress";
  if (eventType === "response.completed") return "response_completed";
  if (eventType === "response.failed") return "response_failed";
  if (eventType === "response.incomplete") return "response_incomplete";
  if (eventType.includes("reasoning_summary") && eventType.endsWith(".delta")) return "safe_content_delta";
  if (eventType.includes("reasoning_summary") && eventType.endsWith(".done")) return "safe_content_done";
  if (eventType === "response.output_item.added" && itemType(parsed) === "reasoning") return "reasoning_started";
  if (eventType === "response.output_item.done" && itemType(parsed) === "reasoning") return "reasoning_done";
  if (eventType === "response.output_item.added") return "output_item_started";
  if (eventType === "response.output_item.done") return "output_item_done";
  if (eventType === "response.content_part.added") return "content_part_started";
  if (eventType === "response.content_part.done") return "content_part_done";
  return "stream_event";
}

function isOrdinaryOutputTextDelta(eventType: string): boolean {
  return eventType === "response.output_text.delta";
}

function extractSafeSummaryText(eventType: string, parsed: Record<string, unknown> | undefined): string {
  if (!parsed) return "";
  if (eventType.includes("reasoning_summary") && typeof parsed.delta === "string") return parsed.delta;
  if (eventType.includes("reasoning_summary") && typeof parsed.text === "string") return parsed.text;
  const item = parsed.item;
  if (!item || typeof item !== "object" || Array.isArray(item)) return "";
  const summary = (item as Record<string, unknown>).summary;
  if (!Array.isArray(summary)) return "";
  return summary
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
      const record = entry as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : "";
      return type.includes("summary") && typeof record.text === "string" ? record.text : "";
    })
    .join("");
}
