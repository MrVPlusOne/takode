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
  canOpenContainingFolder: boolean;
  openContainingFolderLabel: string;
  platform: string;
  /** The remote host holding the file; absent for the server's own machine. */
  hostId?: string;
}

export async function resolveFileLinkAction(target: FileLinkActionTarget): Promise<FileLinkResolveResponse> {
  return requestJson<FileLinkResolveResponse>("/fs/file-link/resolve", {
    method: "POST",
    body: JSON.stringify(target),
  });
}

export async function revealFileLinkInFinder(
  target: FileLinkActionTarget,
): Promise<{ ok: boolean; absolutePath: string; openedPath: string; platform: string }> {
  return requestJson<{ ok: boolean; absolutePath: string; openedPath: string; platform: string }>(
    "/fs/file-link/reveal",
    {
      method: "POST",
      body: JSON.stringify(target),
    },
  );
}

/** A linked text file's contents, read on the machine that holds the linking session's files. */
export async function readFileLinkText(
  target: FileLinkActionTarget,
  signal?: AbortSignal,
): Promise<{ absolutePath: string; content: string }> {
  return requestJson<{ absolutePath: string; content: string }>(`/fs/file-link/text?${fileLinkParams(target)}`, {
    method: "GET",
    signal,
  });
}

/** One entry of a linked folder, as `GET /fs/file-link/folder` lists it. */
export interface FileLinkFolderEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: number;
}

/** A linked folder's files and subfolders, listed on the machine that holds the linking session's files. */
export async function readFileLinkFolder(
  target: FileLinkActionTarget,
  signal?: AbortSignal,
): Promise<{ path: string; entries: FileLinkFolderEntry[]; truncated: boolean }> {
  return requestJson(`/fs/file-link/folder?${fileLinkParams(target)}`, { method: "GET", signal });
}

function fileLinkParams(target: FileLinkActionTarget): string {
  const params = new URLSearchParams({
    path: target.path,
    isRelative: target.isRelative ? "1" : "0",
  });
  if (target.sessionId) params.set("sessionId", target.sessionId);
  return params.toString();
}

/**
 * Where a link to a page or PDF opens in a browser tab: HTML through the sandboxed file preview,
 * a PDF from the machine that holds it for the browser's own viewer.
 */
export function buildFileLinkBrowserUrl(target: FileLinkActionTarget): string {
  if (/\.pdf$/i.test(target.path)) return `${BASE}/fs/file-link/pdf?${fileLinkParams(target)}`;
  return `/file-preview/open?${fileLinkParams(target)}`;
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
  const body = (await response.json().catch(() => null)) as { error?: string; size?: number } | T | null;
  if (!response.ok) {
    const failure = body && typeof body === "object" && "error" in body ? body : null;
    throw new FileLinkRequestError(
      failure?.error || response.statusText || `Request failed with status ${response.status}`,
      response.status,
      typeof failure?.size === "number" ? failure.size : undefined,
    );
  }
  return body as T;
}

/** A file-link request the server refused, with its HTTP status (415: not a text file, 413: too large, 503: host offline). */
export class FileLinkRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The file's size, when the server reported it. */
    readonly size?: number,
  ) {
    super(message);
  }
}
