import type { SdkSessionInfo } from "../types.js";
import type {
  CodexInstructionContentRequest,
  CodexInstructionContentResponse,
} from "../../shared/codex-instruction-content.js";

const BASE = "/api";

async function getSessionInfoResponse(path: string): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }
  return response.json();
}

export async function listSessions(options?: { includeArchived?: boolean }): Promise<SdkSessionInfo[]> {
  const params = new URLSearchParams();
  if (typeof options?.includeArchived === "boolean") {
    params.set("includeArchived", options.includeArchived ? "true" : "false");
  }
  const query = params.toString();
  return getSessionInfoResponse(`/sessions${query ? `?${query}` : ""}`) as Promise<SdkSessionInfo[]>;
}

/**
 * Re-read the active session list. Given the ETag of the list last read, the
 * server answers 304 (null here) when only fields the session socket keeps
 * current have changed since.
 */
export async function pollActiveSessions(
  etag: string | null,
): Promise<{ sessions: SdkSessionInfo[]; etag: string | null } | null> {
  const response = await fetch(`${BASE}/sessions?includeArchived=false`, {
    cache: "no-store",
    ...(etag ? { headers: { "If-None-Match": etag } } : {}),
  });
  if (response.status === 304) return null;
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || response.statusText);
  }
  return { sessions: (await response.json()) as SdkSessionInfo[], etag: response.headers.get("ETag") };
}

export function getSessionInfo(sessionId: string): Promise<SdkSessionInfo> {
  return getSessionInfoResponse(
    `/sessions/${encodeURIComponent(sessionId)}?includeCodexContextWindowDiagnostics=true&includeCodexInstructionSnapshot=true`,
  ) as Promise<SdkSessionInfo>;
}

export function getSessionInstructionContent(
  sessionId: string,
  selection: CodexInstructionContentRequest,
): Promise<CodexInstructionContentResponse> {
  const query = new URLSearchParams({ ...selection, capturedAt: String(selection.capturedAt) });
  return getSessionInfoResponse(
    `/sessions/${encodeURIComponent(sessionId)}/instruction-content?${query}`,
  ) as Promise<CodexInstructionContentResponse>;
}
