import { randomUUID } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, posix, relative, resolve, sep } from "node:path";
import { Hono } from "hono";
import { getMimeType } from "hono/utils/mime";
import type { RouteContext } from "./context.js";
import { getFileLinkRootForSession, resolveFileLinkPath, type FileLinkResolveRequest } from "./filesystem.js";

const FILE_LINK_BROWSER_CAPABILITY_TTL_MS = 12 * 60 * 60 * 1000;
const FILE_LINK_BROWSER_CAPABILITY_LIMIT = 1024;
const FILE_LINK_BROWSER_ASSET_LIMIT = 4096;
const FILE_LINK_BROWSER_SCAN_OPERATION_LIMIT = 256;
const FILE_LINK_BROWSER_SCAN_FILE_BYTE_LIMIT = 8 * 1024 * 1024;
const FILE_LINK_BROWSER_SCAN_TOTAL_BYTE_LIMIT = 32 * 1024 * 1024;
const FILE_LINK_BROWSER_REFERENCE_LENGTH_LIMIT = 4096;
const FILE_LINK_BROWSER_PREFIX = "/file-preview";
const FILE_LINK_BROWSER_SANDBOX = [
  "sandbox",
  "allow-downloads",
  "allow-forms",
  "allow-modals",
  "allow-orientation-lock",
  "allow-pointer-lock",
  "allow-popups",
  "allow-presentation",
  "allow-scripts",
  "allow-top-navigation-by-user-activation",
].join(" ");
const SENSITIVE_ASSET_SEGMENT_RE =
  /^(?:(?:credentials?|secrets?|keys?)(?:[._-].*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?|\.env(?:[._-].*)?|\.(?:ssh|aws|azure|gnupg|kube|docker|git|npmrc|pypirc|netrc))$|\.(?:pem|key|p12|pfx|kdbx)$/i;
const DOCUMENT_EXTENSIONS = new Set([".html", ".htm", ".xhtml", ".svg"]);
const SCRIPT_EXTENSIONS = new Set([".js", ".mjs", ".cjs"]);

type ReferenceBase = "source" | "runtime";
type TargetRuntimeBase = "inherit" | "self" | null;

interface LiteralAssetReference {
  value: string;
  base: ReferenceBase;
  targetRuntimeBase: TargetRuntimeBase;
}

interface FileLinkBrowserCapabilityData {
  rootPath: string;
  entryVirtualPath: string;
  entryRealVirtualPath: string;
  allowedVirtualPaths: Set<string>;
  runtimeBasesByVirtualPath: Map<string, Set<string>>;
  scannedReferenceContexts: Set<string>;
  scannedBytes: number;
}

interface FileLinkBrowserCapability extends FileLinkBrowserCapabilityData {
  expiresAt: number;
}

interface FileLinkBrowserRouteOptions {
  capabilityTtlMs?: number;
  now?: () => number;
  scanFileByteLimit?: number;
  scanTotalByteLimit?: number;
  scanOperationLimit?: number;
}

interface ResolvedVirtualReference {
  virtualPath: string;
  virtualUrlPath: string;
}

function isPathInsideRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = relative(rootPath, candidatePath);
  return (
    relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath))
  );
}

function toVirtualPath(rootPath: string, targetPath: string): string | null {
  const relativePath = relative(rootPath, targetPath);
  if (!relativePath || !isPathInsideRoot(rootPath, targetPath)) return null;
  return relativePath.split(sep).join("/");
}

function encodeVirtualPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function decodedPathSegmentIsUnsafe(segment: string): boolean {
  let candidate = segment;
  for (let depth = 0; depth < 2; depth += 1) {
    if (!candidate || candidate === "." || candidate === ".." || /[\\/\0]/.test(candidate)) return true;
    if (!/%[0-9a-f]{2}/i.test(candidate)) break;
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  return candidate === "." || candidate === ".." || /[\\/\0]/.test(candidate);
}

function decodeVirtualPath(encodedPath: string): string[] | null {
  const trimmed = encodedPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;

  const parts: string[] = [];
  for (const encodedPart of trimmed.split("/")) {
    let decodedPart: string;
    try {
      decodedPart = decodeURIComponent(encodedPart);
    } catch {
      return null;
    }
    if (decodedPathSegmentIsUnsafe(decodedPart)) return null;
    parts.push(decodedPart);
  }
  return parts;
}

function contentTypeForPath(path: string): string {
  return getMimeType(path) || "application/octet-stream";
}

function previewHeaders(virtualPath: string): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "null",
    "Cache-Control": "private, no-store",
    "Content-Disposition": "inline",
    "Content-Type": contentTypeForPath(virtualPath),
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
    "X-Takode-File-Preview": "1",
  });
  if (DOCUMENT_EXTENSIONS.has(extname(virtualPath).toLowerCase())) {
    headers.set("Content-Security-Policy", FILE_LINK_BROWSER_SANDBOX);
    headers.set("Cross-Origin-Opener-Policy", "same-origin");
  }
  return headers;
}

function errorResponse(message: string, status: 400 | 403 | 404 | 410): Response {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function redirectResponse(location: string, status: 302 | 307): Response {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Location: location,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function addMatches(
  target: LiteralAssetReference[],
  seen: Set<string>,
  source: string,
  pattern: RegExp,
  valueGroups: number[],
  base: ReferenceBase,
  targetRuntimeBase: TargetRuntimeBase,
): void {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const value = valueGroups.map((index) => match?.[index]).find((candidate) => candidate !== undefined);
    if (!value || value.length > FILE_LINK_BROWSER_REFERENCE_LENGTH_LIMIT) continue;
    const key = `${base}\0${targetRuntimeBase ?? ""}\0${value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    target.push({ value, base, targetRuntimeBase });
    if (target.length >= FILE_LINK_BROWSER_ASSET_LIMIT) return;
  }
}

function documentAttributeSource(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(<script\b[^>]*>)[\s\S]*?<\/script\s*>/gi, "$1</script>")
    .replace(/(<style\b[^>]*>)[\s\S]*?<\/style\s*>/gi, "$1</style>");
}

function extractDocumentBaseReference(source: string): string | null {
  const match = /<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(
    documentAttributeSource(source),
  );
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? null;
}

function extractLiteralAssetReferences(path: string, source: string): LiteralAssetReference[] {
  const references: LiteralAssetReference[] = [];
  const seen = new Set<string>();
  const extension = extname(path).toLowerCase();
  const isDocument = DOCUMENT_EXTENSIONS.has(extension);
  const isStyle = extension === ".css" || isDocument;
  const isScript = SCRIPT_EXTENSIONS.has(extension) || isDocument;
  const embeddedSourceBase: ReferenceBase = isDocument ? "runtime" : "source";

  if (isDocument) {
    const attributeSource = documentAttributeSource(source);
    addMatches(
      references,
      seen,
      attributeSource,
      /\b(?:src|href|poster|data|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      [1, 2, 3],
      "runtime",
      "inherit",
    );
    const srcsets = new Set<string>();
    const srcsetMatches: LiteralAssetReference[] = [];
    addMatches(
      srcsetMatches,
      new Set<string>(),
      attributeSource,
      /\b(?:srcset|imagesrcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi,
      [1, 2, 3],
      "runtime",
      "inherit",
    );
    for (const match of srcsetMatches) srcsets.add(match.value);
    for (const srcset of srcsets) {
      for (const candidate of srcset.split(",")) {
        const value = candidate.trim().split(/\s+/, 1)[0];
        if (!value || value.length > FILE_LINK_BROWSER_REFERENCE_LENGTH_LIMIT) continue;
        const key = `runtime\0inherit\0${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        references.push({ value, base: "runtime", targetRuntimeBase: "inherit" });
        if (references.length >= FILE_LINK_BROWSER_ASSET_LIMIT) return references;
      }
    }
  }

  if (isStyle) {
    addMatches(
      references,
      seen,
      source,
      /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^\s"')]+))\s*\)/gi,
      [1, 2, 3],
      embeddedSourceBase,
      null,
    );
    addMatches(references, seen, source, /@import\s+(?:url\(\s*)?["']([^"']+)["']/gi, [1], embeddedSourceBase, null);
  }

  if (isScript) {
    addMatches(references, seen, source, /\bfetch\s*\(\s*["']([^"']+)["']/gi, [1], "runtime", null);
    addMatches(references, seen, source, /\bfetch\s*\(\s*`((?:(?!\$\{)[^`])*)`/gi, [1], "runtime", null);
    addMatches(references, seen, source, /\bimport\s*\(\s*["']([^"']+)["']/gi, [1], embeddedSourceBase, "inherit");
    addMatches(references, seen, source, /\bimport\s*\(\s*`((?:(?!\$\{)[^`])*)`/gi, [1], embeddedSourceBase, "inherit");
    addMatches(
      references,
      seen,
      source,
      /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*["']([^"']+)["']/gi,
      [1],
      "runtime",
      "self",
    );
    addMatches(
      references,
      seen,
      source,
      /\bnew\s+(?:Worker|SharedWorker)\s*\(\s*`((?:(?!\$\{)[^`])*)`/gi,
      [1],
      "runtime",
      "self",
    );
    addMatches(references, seen, source, /\bnew\s+EventSource\s*\(\s*["']([^"']+)["']/gi, [1], "runtime", null);
    addMatches(references, seen, source, /\bnew\s+EventSource\s*\(\s*`((?:(?!\$\{)[^`])*)`/gi, [1], "runtime", null);
    addMatches(
      references,
      seen,
      source,
      /\bnew\s+URL\s*\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*\)/gi,
      [1],
      embeddedSourceBase,
      null,
    );
    addMatches(
      references,
      seen,
      source,
      /\bnew\s+URL\s*\(\s*`((?:(?!\$\{)[^`])*)`\s*,\s*import\.meta\.url\s*\)/gi,
      [1],
      embeddedSourceBase,
      null,
    );
    addMatches(
      references,
      seen,
      source,
      /\b(?:import|export)\s+(?:[^"';]*?\s+from\s*)?["']([^"']+)["']/gi,
      [1],
      embeddedSourceBase,
      "inherit",
    );
    addMatches(references, seen, source, /\.open\s*\(\s*["'][A-Z]+["']\s*,\s*["']([^"']+)["']/gi, [1], "runtime", null);
    addMatches(
      references,
      seen,
      source,
      /\.open\s*\(\s*(?:["'][A-Z]+["']|`[A-Z]+`)\s*,\s*`((?:(?!\$\{)[^`])*)`/gi,
      [1],
      "runtime",
      null,
    );
    addMatches(references, seen, source, /\bimportScripts\s*\(\s*["']([^"']+)["']/gi, [1], "runtime", "inherit");
    addMatches(references, seen, source, /\bimportScripts\s*\(\s*`((?:(?!\$\{)[^`])*)`/gi, [1], "runtime", "inherit");
  }

  return references;
}

function resolveVirtualReference(baseVirtualUrlPath: string, rawReference: string): ResolvedVirtualReference | null {
  const reference = rawReference.trim().replaceAll("&amp;", "&");
  if (
    !reference ||
    reference.startsWith("#") ||
    reference.startsWith("?") ||
    reference.startsWith("/") ||
    reference.startsWith("\\") ||
    /^[a-z][a-z0-9+.-]*:/i.test(reference)
  ) {
    return null;
  }

  const pathOnly = reference.split(/[?#]/, 1)[0];
  if (!pathOnly) return null;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathOnly);
  } catch {
    return null;
  }
  if (!decodedPath || posix.isAbsolute(decodedPath) || /[\\\0]/.test(decodedPath)) return null;

  const baseDirectory = baseVirtualUrlPath.endsWith("/")
    ? baseVirtualUrlPath.replace(/\/+$/, "")
    : posix.dirname(baseVirtualUrlPath);
  const normalized = posix.normalize(posix.join(baseDirectory, decodedPath)).replace(/\/+$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    posix.isAbsolute(normalized)
  ) {
    return null;
  }
  return {
    virtualPath: normalized,
    virtualUrlPath: decodedPath.endsWith("/") ? `${normalized}/` : normalized,
  };
}

function pathUsesSensitiveSegmentOutsideEntry(entryVirtualPath: string, candidateVirtualPath: string): boolean {
  if (candidateVirtualPath === entryVirtualPath) return false;
  const entryDirectoryParts = posix.dirname(entryVirtualPath).split("/").filter(Boolean);
  return candidateVirtualPath
    .split("/")
    .filter(Boolean)
    .some((part, index) => SENSITIVE_ASSET_SEGMENT_RE.test(part) && entryDirectoryParts[index] !== part);
}

function requestedPathIsSensitive(capability: FileLinkBrowserCapabilityData, virtualPath: string): boolean {
  return pathUsesSensitiveSegmentOutsideEntry(capability.entryVirtualPath, virtualPath);
}

function canonicalPathIsSensitive(capability: FileLinkBrowserCapabilityData, virtualPath: string): boolean {
  return pathUsesSensitiveSegmentOutsideEntry(capability.entryRealVirtualPath, virtualPath);
}

function addRuntimeBase(capability: FileLinkBrowserCapabilityData, virtualPath: string, runtimeBase: string): void {
  const current = capability.runtimeBasesByVirtualPath.get(virtualPath);
  if (current) {
    current.add(runtimeBase);
    return;
  }
  capability.runtimeBasesByVirtualPath.set(virtualPath, new Set([runtimeBase]));
}

function addAllowedVirtualPath(
  capability: FileLinkBrowserCapabilityData,
  virtualPath: string,
  runtimeBase?: string,
): boolean {
  if (requestedPathIsSensitive(capability, virtualPath)) return false;
  if (!capability.allowedVirtualPaths.has(virtualPath)) {
    if (capability.allowedVirtualPaths.size >= FILE_LINK_BROWSER_ASSET_LIMIT) return false;
    capability.allowedVirtualPaths.add(virtualPath);
  }
  if (runtimeBase) addRuntimeBase(capability, virtualPath, runtimeBase);
  return true;
}

function authorizeLiteralReferences(
  capability: FileLinkBrowserCapabilityData,
  sourceVirtualPath: string,
  source: string,
  runtimeBase: string | null,
): void {
  for (const reference of extractLiteralAssetReferences(sourceVirtualPath, source)) {
    const resolutionBase = reference.base === "source" ? sourceVirtualPath : runtimeBase;
    if (!resolutionBase) continue;
    const resolvedReference = resolveVirtualReference(resolutionBase, reference.value);
    if (!resolvedReference) continue;

    let targetRuntimeBase: string | undefined;
    if (reference.targetRuntimeBase === "inherit" && runtimeBase) targetRuntimeBase = runtimeBase;
    if (reference.targetRuntimeBase === "self") targetRuntimeBase = resolvedReference.virtualUrlPath;
    addAllowedVirtualPath(capability, resolvedReference.virtualPath, targetRuntimeBase);
  }
}

function isScannableAsset(virtualPath: string): boolean {
  const extension = extname(virtualPath).toLowerCase();
  return DOCUMENT_EXTENSIONS.has(extension) || SCRIPT_EXTENSIONS.has(extension) || extension === ".css";
}

async function readBoundedScannableSource(
  capability: FileLinkBrowserCapabilityData,
  contextKey: string,
  realAssetPath: string,
  limits: { fileBytes: number; totalBytes: number; operations: number },
): Promise<string | null> {
  if (capability.scannedReferenceContexts.has(contextKey)) return null;
  if (capability.scannedReferenceContexts.size >= limits.operations) return null;
  const remainingBytes = limits.totalBytes - capability.scannedBytes;
  if (remainingBytes <= 0) return null;

  capability.scannedReferenceContexts.add(contextKey);
  const byteLimit = Math.min(limits.fileBytes, remainingBytes);
  // Reserve before the first await/allocation so concurrent asset requests cannot
  // each observe the same remaining total and collectively bypass the heap bound.
  capability.scannedBytes += byteLimit;
  let consumedBytes = 0;
  let file: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const buffer = Buffer.allocUnsafe(byteLimit + 1);
    file = await open(realAssetPath, "r");
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
    }
    consumedBytes = Math.min(bytesRead, byteLimit);
    if (bytesRead > byteLimit) return null;
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    capability.scannedBytes -= byteLimit - consumedBytes;
    await file?.close();
  }
}

async function scanLiteralReferences(
  capability: FileLinkBrowserCapabilityData,
  virtualPath: string,
  realAssetPath: string,
  limits: { fileBytes: number; totalBytes: number; operations: number },
): Promise<void> {
  if (!isScannableAsset(virtualPath) || capability.allowedVirtualPaths.size >= FILE_LINK_BROWSER_ASSET_LIMIT) return;
  const extension = extname(virtualPath).toLowerCase();
  const isDocument = DOCUMENT_EXTENSIONS.has(extension);
  const isScript = SCRIPT_EXTENSIONS.has(extension);
  const runtimeBases = isDocument
    ? [virtualPath]
    : isScript
      ? [...(capability.runtimeBasesByVirtualPath.get(virtualPath) ?? [])]
      : [null];

  for (const inheritedRuntimeBase of runtimeBases) {
    const contextKey = `${virtualPath}\0${isDocument ? "document" : (inheritedRuntimeBase ?? "source")}`;
    let source: string | null;
    try {
      source = await readBoundedScannableSource(capability, contextKey, realAssetPath, limits);
    } catch {
      continue;
    }
    if (source === null) continue;

    let runtimeBase = inheritedRuntimeBase;
    if (isDocument) {
      const baseReference = extractDocumentBaseReference(source);
      runtimeBase = baseReference
        ? (resolveVirtualReference(virtualPath, baseReference)?.virtualUrlPath ?? null)
        : virtualPath;
    }
    authorizeLiteralReferences(capability, virtualPath, source, runtimeBase);
  }
}

export function createFileLinkBrowserRoutes(wsBridge: RouteContext["wsBridge"], options?: FileLinkBrowserRouteOptions) {
  const routes = new Hono();
  const capabilities = new Map<string, FileLinkBrowserCapability>();
  const now = options?.now ?? Date.now;
  const capabilityTtlMs = options?.capabilityTtlMs ?? FILE_LINK_BROWSER_CAPABILITY_TTL_MS;
  const scanLimits = {
    fileBytes: options?.scanFileByteLimit ?? FILE_LINK_BROWSER_SCAN_FILE_BYTE_LIMIT,
    totalBytes: options?.scanTotalByteLimit ?? FILE_LINK_BROWSER_SCAN_TOTAL_BYTE_LIMIT,
    operations: options?.scanOperationLimit ?? FILE_LINK_BROWSER_SCAN_OPERATION_LIMIT,
  };

  const pruneCapabilities = (timestamp: number) => {
    for (const [token, capability] of capabilities) {
      if (capability.expiresAt <= timestamp) capabilities.delete(token);
    }
    while (capabilities.size >= FILE_LINK_BROWSER_CAPABILITY_LIMIT) {
      const oldestToken = capabilities.keys().next().value as string | undefined;
      if (!oldestToken) break;
      capabilities.delete(oldestToken);
    }
  };

  const issueCapability = (capability: FileLinkBrowserCapabilityData) => {
    const issuedAt = now();
    pruneCapabilities(issuedAt);
    const token = randomUUID();
    capabilities.set(token, { ...capability, expiresAt: issuedAt + capabilityTtlMs });
    return token;
  };

  routes.get(`${FILE_LINK_BROWSER_PREFIX}/open`, async (c) => {
    const fetchSite = c.req.header("Sec-Fetch-Site")?.toLowerCase();
    const fetchMode = c.req.header("Sec-Fetch-Mode")?.toLowerCase();
    const fetchDest = c.req.header("Sec-Fetch-Dest")?.toLowerCase();
    const fetchUser = c.req.header("Sec-Fetch-User")?.toLowerCase();
    if (
      (fetchSite && fetchSite !== "same-origin") ||
      (fetchMode && fetchMode !== "navigate") ||
      (fetchDest && fetchDest !== "document") ||
      (fetchUser && fetchUser !== "?1")
    ) {
      return errorResponse("HTML files can only be opened by user navigation from Takode", 403);
    }

    const requestedPath = c.req.query("path");
    if (!requestedPath) return errorResponse("Cannot open HTML file: path is required", 400);

    const sessionId = c.req.query("sessionId");
    const request: FileLinkResolveRequest = {
      path: requestedPath,
      isRelative: c.req.query("isRelative") === "1" || c.req.query("isRelative") === "true",
      ...(sessionId ? { sessionId } : {}),
    };

    try {
      const target = await resolveFileLinkPath(request, wsBridge);
      if (!target.exists || !target.isFile) {
        return errorResponse(`Cannot open HTML file: ${target.absolutePath} was not found`, 404);
      }
      if (extname(target.absolutePath).toLowerCase() !== ".html") {
        return errorResponse("Cannot open HTML file: the resolved target is not an .html file", 400);
      }

      const requestedTargetPath = resolve(target.absolutePath);
      const realTargetPath = await realpath(requestedTargetPath);
      let rootPath: string;
      let requestedRootPath: string;
      const sessionRoot = getFileLinkRootForSession(wsBridge, request.sessionId);
      const resolvedSessionRoot = sessionRoot ? resolve(sessionRoot) : null;
      if (resolvedSessionRoot && isPathInsideRoot(resolvedSessionRoot, requestedTargetPath)) {
        const realSessionRoot = await realpath(resolvedSessionRoot);
        if (!isPathInsideRoot(realSessionRoot, realTargetPath)) {
          return errorResponse("Cannot open HTML file: entry symlink escapes the session root", 403);
        }
        rootPath = realSessionRoot;
        requestedRootPath = resolvedSessionRoot;
      } else {
        requestedRootPath = resolve(requestedTargetPath, "..");
        rootPath = await realpath(requestedRootPath);
        if (!isPathInsideRoot(rootPath, realTargetPath)) {
          return errorResponse("Cannot open HTML file: entry symlink escapes the selected directory", 403);
        }
      }

      const entryVirtualPath =
        toVirtualPath(requestedRootPath, requestedTargetPath) ?? toVirtualPath(rootPath, realTargetPath);
      const entryRealVirtualPath = toVirtualPath(rootPath, realTargetPath);
      if (!entryVirtualPath || !entryRealVirtualPath) {
        return errorResponse("Cannot open HTML file: resolved path is outside the preview root", 403);
      }
      if (
        entryVirtualPath !== entryRealVirtualPath &&
        pathUsesSensitiveSegmentOutsideEntry(entryVirtualPath, entryRealVirtualPath)
      ) {
        return errorResponse("Cannot open HTML file: resolved target points to a protected path", 403);
      }

      const capability: FileLinkBrowserCapabilityData = {
        rootPath,
        entryVirtualPath,
        entryRealVirtualPath,
        allowedVirtualPaths: new Set([entryVirtualPath]),
        runtimeBasesByVirtualPath: new Map([[entryVirtualPath, new Set([entryVirtualPath])]]),
        scannedReferenceContexts: new Set(),
        scannedBytes: 0,
      };
      await scanLiteralReferences(capability, entryVirtualPath, realTargetPath, scanLimits);
      const token = issueCapability(capability);
      return redirectResponse(
        `${FILE_LINK_BROWSER_PREFIX}/content/${token}/root/${encodeVirtualPath(entryVirtualPath)}`,
        302,
      );
    } catch (error) {
      return errorResponse(
        `Cannot open HTML file: ${error instanceof Error ? error.message : "unable to resolve target"}`,
        400,
      );
    }
  });

  routes.options(`${FILE_LINK_BROWSER_PREFIX}/content/:token/root/*`, (c) =>
    c.body(null, 204, {
      "Access-Control-Allow-Headers": c.req.header("Access-Control-Request-Headers") || "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Origin": "null",
      "Access-Control-Max-Age": "600",
      Vary: "Origin, Access-Control-Request-Headers",
    }),
  );

  routes.get(`${FILE_LINK_BROWSER_PREFIX}/content/:token/root/*`, async (c) => {
    const token = c.req.param("token");
    const capability = capabilities.get(token);
    if (!capability) return errorResponse("This HTML preview link is unavailable", 404);
    if (capability.expiresAt <= now()) {
      capabilities.delete(token);
      return errorResponse("This HTML preview link has expired", 410);
    }

    const url = new URL(c.req.url);
    const encodedPrefix = `${FILE_LINK_BROWSER_PREFIX}/content/${encodeURIComponent(token)}/root/`;
    const prefixIndex = url.pathname.indexOf(encodedPrefix);
    const encodedPath = prefixIndex >= 0 ? url.pathname.slice(prefixIndex + encodedPrefix.length) : "";
    const virtualParts = decodeVirtualPath(encodedPath);
    if (!virtualParts) return errorResponse("Invalid HTML preview asset path", 400);

    let virtualPath = virtualParts.join("/");
    if (!capability.allowedVirtualPaths.has(virtualPath)) {
      return errorResponse("HTML preview asset was not declared by an authorized document", 403);
    }
    if (requestedPathIsSensitive(capability, virtualPath)) {
      return errorResponse("HTML preview asset is outside the allowed document package", 403);
    }

    try {
      let requestedAssetPath = resolve(capability.rootPath, ...virtualParts);
      if (!isPathInsideRoot(capability.rootPath, requestedAssetPath)) {
        return errorResponse("HTML preview asset path escapes its authorized root", 403);
      }

      const requestedInfo = await stat(requestedAssetPath);
      if (requestedInfo.isDirectory()) {
        if (!url.pathname.endsWith("/")) return redirectResponse(`${url.pathname}/${url.search}`, 307);
        requestedAssetPath = resolve(requestedAssetPath, "index.html");
        virtualPath = posix.join(virtualPath, "index.html");
        if (!addAllowedVirtualPath(capability, virtualPath)) {
          return errorResponse("HTML preview directory index is outside the allowed document package", 403);
        }
      }
      const realAssetPath = await realpath(requestedAssetPath);
      if (!isPathInsideRoot(capability.rootPath, realAssetPath)) {
        return errorResponse("HTML preview asset path escapes its authorized root", 403);
      }
      const realVirtualPath = toVirtualPath(capability.rootPath, realAssetPath);
      if (!realVirtualPath || canonicalPathIsSensitive(capability, realVirtualPath)) {
        return errorResponse("HTML preview asset resolves to a protected path", 403);
      }

      const info = await stat(realAssetPath);
      if (!info.isFile()) return errorResponse("HTML preview asset was not found", 404);
      await scanLiteralReferences(capability, virtualPath, realAssetPath, scanLimits);
      return new Response(Bun.file(realAssetPath), { status: 200, headers: previewHeaders(virtualPath) });
    } catch {
      return errorResponse("HTML preview asset was not found", 404);
    }
  });

  routes.all(FILE_LINK_BROWSER_PREFIX, () => errorResponse("Unknown HTML preview route", 404));
  routes.all(`${FILE_LINK_BROWSER_PREFIX}/*`, () => errorResponse("Unknown HTML preview route", 404));

  return routes;
}
