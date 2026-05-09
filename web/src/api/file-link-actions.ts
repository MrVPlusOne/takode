const BASE = "/api";

export interface FileLinkActionTarget {
  path: string;
  isRelative: boolean;
  sessionId?: string;
}

export interface FileLinkResolveResponse {
  absolutePath: string;
  requestedPath: string;
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  isImage: boolean;
  mimeType?: string;
  size?: number;
  canRevealInFinder: boolean;
  platform: string;
}

export async function resolveFileLinkAction(target: FileLinkActionTarget): Promise<FileLinkResolveResponse> {
  return requestJson<FileLinkResolveResponse>("/fs/file-link/resolve", {
    method: "POST",
    body: JSON.stringify(target),
  });
}

export async function revealFileLinkInFinder(
  target: FileLinkActionTarget,
): Promise<{ ok: boolean; absolutePath: string }> {
  return requestJson<{ ok: boolean; absolutePath: string }>("/fs/file-link/reveal", {
    method: "POST",
    body: JSON.stringify(target),
  });
}

export function buildFileLinkPreviewUrl(target: FileLinkActionTarget): string {
  const params = new URLSearchParams({
    path: target.path,
    isRelative: target.isRelative ? "1" : "0",
  });
  if (target.sessionId) params.set("sessionId", target.sessionId);
  return `${BASE}/fs/file-link/preview?${params.toString()}`;
}

export function buildFileLinkImageVariantUrl(target: FileLinkActionTarget, variant: "thumbnail" | "full"): string {
  const params = new URLSearchParams({
    path: target.path,
    isRelative: target.isRelative ? "1" : "0",
    variant,
  });
  if (target.sessionId) params.set("sessionId", target.sessionId);
  return `${BASE}/fs/file-link/image?${params.toString()}`;
}

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | T | null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body ? body.error : response.statusText;
    throw new Error(message || `Request failed with status ${response.status}`);
  }
  return body as T;
}
