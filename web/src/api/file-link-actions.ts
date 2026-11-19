import { fileLinkMediaType } from "../../shared/file-link-media.js";
import { saveUrl } from "../utils/artifact-export.js";
import { isTouchDevice } from "../utils/mobile.js";

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

/** Where the file viewer's player streams a linked video or audio file from, with byte ranges. */
export function buildFileLinkMediaUrl(target: FileLinkActionTarget): string {
  return `${BASE}/fs/file-link/media?${fileLinkParams(target)}`;
}

/**
 * Whether files are saved through the system share sheet rather than downloaded: on phones that
 * can share files. There a download replaces Takode with the system's file page (in the iPhone Home
 * Screen app with no way back), and the share sheet offers Save Video, Save Image and Save to Files.
 */
export function savesThroughShareSheet(): boolean {
  if (!isTouchDevice() || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "check.txt", { type: "text/plain" })] });
  } catch {
    return false;
  }
}

/**
 * Thrown when the share sheet needs another tap: fetching the file took longer than a tap lets a
 * page open the share sheet. The file is kept, so the next save opens the sheet at once.
 */
export class ShareNeedsTapError extends Error {
  constructor() {
    super("The file is ready: tap again to save it.");
  }
}

const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};

/** The type a shared file is given: the share sheet offers Save Video or Save Image only for a file of that type. */
function shareTypeFor(name: string): string {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  return fileLinkMediaType(name)?.mimeType ?? IMAGE_TYPES[extension] ?? "application/octet-stream";
}

/** A file the browser can save to its device: where to fetch it, and the name to save it under. */
export interface SaveableFile {
  url: string;
  name: string;
}

/** A linked file as saved: its original bytes, read on the machine that holds the session's files. */
export function fileLinkDownload(target: FileLinkActionTarget): SaveableFile {
  return {
    url: `${BASE}/fs/file-link/download?${fileLinkParams(target)}`,
    name: target.path.split(/[\\/]/).pop() || "file",
  };
}

/**
 * `name` with the extension of `mimeType`, for a stored copy kept in another format than the
 * upload it is named after (an uploaded PNG is stored as WebP), so the saved file opens.
 */
export function nameForType(name: string, mimeType: string): string {
  const extension = Object.entries(IMAGE_TYPES).find(([, type]) => type === mimeType)?.[0];
  if (!extension || shareTypeFor(name) === mimeType) return name;
  return `${name.replace(/\.[a-z0-9]+$/i, "") || "image"}.${extension}`;
}

/** The file last fetched for the share sheet, kept for the second tap a slow fetch needs. */
let sharedFile: { url: string; file: File } | null = null;

/**
 * Save a file to the device the browser runs on: through the share sheet on phones (see
 * `savesThroughShareSheet`), else as a download. Rejects with `ShareNeedsTapError` when the share
 * sheet needs another tap; closing the sheet is not an error.
 */
export async function saveFileToDevice({ url, name }: SaveableFile): Promise<void> {
  if (!savesThroughShareSheet()) return saveUrl(url, name);
  let file = sharedFile?.url === url ? sharedFile.file : null;
  if (!file) {
    const response = await fetch(url);
    if (!response.ok) throw new Error((await response.text()) || `Download failed with status ${response.status}`);
    file = new File([await response.blob()], name, { type: shareTypeFor(name) });
    sharedFile = { url, file };
  }
  try {
    await navigator.share({ files: [file] });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    if (error instanceof DOMException && error.name === "NotAllowedError") throw new ShareNeedsTapError();
    throw error;
  }
}

/**
 * Save a linked file, as its original bytes and name, to the device the browser runs on (see
 * `saveFileToDevice`). The file is read on the machine that holds the linking session's files, so
 * this works for remote hosts too.
 */
export function downloadFileLink(target: FileLinkActionTarget): Promise<void> {
  return saveFileToDevice(fileLinkDownload(target));
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
