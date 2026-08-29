import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export type FrontendAvailabilityReason =
  | "not_required"
  | "ready"
  | "index_unavailable"
  | "index_invalid"
  | "reference_unavailable"
  | "reference_invalid"
  | "check_failed";

export interface FrontendAvailability {
  required: boolean;
  ready: boolean;
  reason: FrontendAvailabilityReason;
}

export type FrontendAvailabilityChecker = () => Promise<FrontendAvailability>;

export interface CheckFrontendAvailabilityOptions {
  required: boolean;
  frontendRoot: string;
}

const LOCAL_REFERENCE_BASE = "https://takode-frontend.invalid/index.html";
const ATTRIBUTE_PATTERN = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const FRONTEND_TAG_PATTERN = /<(script|link)\b([^>]*)>/gi;

function isWithinRoot(root: string, candidate: string): boolean {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === "" || (pathFromRoot !== ".." && !pathFromRoot.startsWith(`..${sep}`) && !isAbsolute(pathFromRoot))
  );
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  ATTRIBUTE_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(source)) !== null) {
    const [, rawName, doubleQuoted, singleQuoted, unquoted] = match;
    attributes.set(rawName.toLowerCase(), doubleQuoted ?? singleQuoted ?? unquoted ?? "");
  }

  return attributes;
}

interface FrontendReference {
  kind: "script" | "stylesheet" | "manifest";
  value: string;
}

function collectFrontendReferences(indexHtml: string): FrontendReference[] {
  const references = new Map<string, FrontendReference>();
  FRONTEND_TAG_PATTERN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FRONTEND_TAG_PATTERN.exec(indexHtml)) !== null) {
    const [, rawTagName, rawAttributes] = match;
    const attributes = parseAttributes(rawAttributes);
    const tagName = rawTagName.toLowerCase();

    if (tagName === "script") {
      if (attributes.has("src")) {
        const value = attributes.get("src")!;
        references.set(`script:${value}`, { kind: "script", value });
      }
      continue;
    }

    const relationships = (attributes.get("rel") ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    if (relationships.includes("stylesheet") && attributes.has("href")) {
      const value = attributes.get("href")!;
      references.set(`stylesheet:${value}`, { kind: "stylesheet", value });
    }
    if (relationships.includes("manifest") && attributes.has("href")) {
      const value = attributes.get("href")!;
      references.set(`manifest:${value}`, { kind: "manifest", value });
    }
  }

  return [...references.values()];
}

function resolveLocalReference(frontendRoot: string, rawReference: string): string | null | undefined {
  const reference = rawReference.trim();
  if (!reference || reference.startsWith("#") || reference.startsWith("//")) return null;
  if (reference.includes("\0") || reference.includes("\\")) return undefined;
  if (/^[a-z][a-z\d+.-]*:/i.test(reference)) return null;

  let url: URL;
  try {
    url = new URL(reference, LOCAL_REFERENCE_BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== new URL(LOCAL_REFERENCE_BASE).origin) return null;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined;
  }

  const candidate = resolve(frontendRoot, pathname.replace(/^\/+/, ""));
  return isWithinRoot(frontendRoot, candidate) ? candidate : undefined;
}

async function isFileInsideRoot(rootRealPath: string, candidate: string): Promise<"file" | "missing" | "outside"> {
  try {
    const candidateStat = await stat(candidate);
    if (!candidateStat.isFile()) return "missing";
    const candidateRealPath = await realpath(candidate);
    return isWithinRoot(rootRealPath, candidateRealPath) ? "file" : "outside";
  } catch {
    return "missing";
  }
}

export async function checkFrontendAvailability(
  options: CheckFrontendAvailabilityOptions,
): Promise<FrontendAvailability> {
  if (!options.required) {
    return { required: false, ready: true, reason: "not_required" };
  }

  const frontendRoot = resolve(options.frontendRoot);
  let rootRealPath: string;
  try {
    rootRealPath = await realpath(frontendRoot);
  } catch {
    return { required: true, ready: false, reason: "index_unavailable" };
  }

  const indexPath = resolve(frontendRoot, "index.html");
  const indexState = await isFileInsideRoot(rootRealPath, indexPath);
  if (indexState === "missing") {
    return { required: true, ready: false, reason: "index_unavailable" };
  }
  if (indexState === "outside") {
    return { required: true, ready: false, reason: "index_invalid" };
  }

  let indexHtml: string;
  try {
    indexHtml = await readFile(indexPath, "utf-8");
  } catch {
    return { required: true, ready: false, reason: "index_unavailable" };
  }

  let localScriptCount = 0;
  let localManifestCount = 0;
  for (const reference of collectFrontendReferences(indexHtml)) {
    const referencePath = resolveLocalReference(frontendRoot, reference.value);
    if (referencePath === null) continue;
    if (referencePath === undefined) {
      return { required: true, ready: false, reason: "reference_invalid" };
    }

    const referenceState = await isFileInsideRoot(rootRealPath, referencePath);
    if (referenceState === "outside") {
      return { required: true, ready: false, reason: "reference_invalid" };
    }
    if (referenceState === "missing") {
      return { required: true, ready: false, reason: "reference_unavailable" };
    }

    if (reference.kind === "script") localScriptCount += 1;
    if (reference.kind === "manifest") localManifestCount += 1;
  }

  if (localScriptCount === 0 || localManifestCount === 0) {
    return { required: true, ready: false, reason: "index_invalid" };
  }

  return { required: true, ready: true, reason: "ready" };
}
