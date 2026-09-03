import {
  normalizeViewportHandoffRecord,
  normalizeViewportHandoffSessionState,
  normalizeViewportHandoffThreadKey,
  type ViewportHandoffReadResponse,
  type ViewportHandoffWriteRequest,
  type ViewportHandoffWriteResponse,
} from "../../shared/viewport-handoff.js";

const BASE = "/api";

export class ViewportHandoffApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "ViewportHandoffApiError";
  }
}

function viewportHandoffPath(sessionId: string, threadKey?: string): string {
  const path = `${BASE}/sessions/${encodeURIComponent(sessionId)}/viewport-handoff`;
  if (!threadKey) return path;
  const params = new URLSearchParams({ threadKey });
  return `${path}?${params.toString()}`;
}

async function readError(response: Response): Promise<ViewportHandoffApiError> {
  const body = await response.json().catch(() => ({ error: response.statusText }));
  const message =
    body && typeof body === "object" && "error" in body && typeof body.error === "string" && body.error.length > 0
      ? body.error
      : response.statusText || `HTTP ${response.status}`;
  return new ViewportHandoffApiError(message, response.status, body);
}

function finiteServerNow(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseReadResponse(
  value: unknown,
  sessionId: string,
  requestedThreadKey?: string,
): ViewportHandoffReadResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Viewport handoff response must be an object");
  }
  const raw = value as Record<string, unknown>;
  const state = normalizeViewportHandoffSessionState(raw.state, sessionId);
  const serverNow = finiteServerNow(raw.serverNow);
  if (!state || serverNow === null) throw new Error("Viewport handoff response is invalid");

  if (!requestedThreadKey) return { state, serverNow };
  const threadKey = normalizeViewportHandoffThreadKey(raw.threadKey);
  if (threadKey !== requestedThreadKey || !("record" in raw)) {
    throw new Error("Viewport handoff thread response is invalid");
  }
  const record = raw.record === null ? null : normalizeViewportHandoffRecord(raw.record);
  if (raw.record !== null && (!record || record.threadKey !== requestedThreadKey)) {
    throw new Error("Viewport handoff thread record is invalid");
  }
  return { state, serverNow, threadKey, record };
}

function parseWriteResponse(value: unknown, sessionId: string, threadKey: string): ViewportHandoffWriteResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Viewport handoff write response must be an object");
  }
  const raw = value as Record<string, unknown>;
  const status = raw.status;
  const state = normalizeViewportHandoffSessionState(raw.state, sessionId);
  const serverNow = finiteServerNow(raw.serverNow);
  const record = raw.record === null ? null : normalizeViewportHandoffRecord(raw.record);
  if (
    (status !== "accepted" && status !== "stale" && status !== "duplicate") ||
    !state ||
    serverNow === null ||
    (raw.record !== null && (!record || record.threadKey !== threadKey))
  ) {
    throw new Error("Viewport handoff write response is invalid");
  }
  return { status, state, record, serverNow };
}

export async function fetchViewportHandoffSession(
  sessionId: string,
  signal?: AbortSignal,
): Promise<ViewportHandoffReadResponse> {
  const response = await fetch(viewportHandoffPath(sessionId), signal ? { signal } : undefined);
  if (!response.ok) throw await readError(response);
  return parseReadResponse(await response.json(), sessionId);
}

export async function fetchViewportHandoffThread(
  sessionId: string,
  threadKey: string,
  signal?: AbortSignal,
): Promise<ViewportHandoffReadResponse> {
  const normalizedThreadKey = normalizeViewportHandoffThreadKey(threadKey);
  if (!normalizedThreadKey) throw new Error("Viewport handoff thread key is invalid");
  const response = await fetch(viewportHandoffPath(sessionId, normalizedThreadKey), signal ? { signal } : undefined);
  if (!response.ok) throw await readError(response);
  return parseReadResponse(await response.json(), sessionId, normalizedThreadKey);
}

export async function putViewportHandoff(
  sessionId: string,
  request: ViewportHandoffWriteRequest,
  options: { keepalive?: boolean; signal?: AbortSignal } = {},
): Promise<ViewportHandoffWriteResponse> {
  const response = await fetch(viewportHandoffPath(sessionId), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    keepalive: options.keepalive === true,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!response.ok) throw await readError(response);
  return parseWriteResponse(await response.json(), sessionId, request.threadKey);
}
