/**
 * Local images a message mentions, found the way the chat feed shows them: Markdown images,
 * `file:` links and plain absolute paths to image files. The browser turns them into image
 * previews; the server prepares their thumbnails and full views before anyone opens them.
 */

export interface LocalImageReference {
  /** Offset in the text where the mention starts. */
  index: number;
  /** `markdown`: `![caption](...)`, which asks for the image to be shown; `file`: a `file:`
   *  link; `path`: a plain absolute path. */
  kind: "markdown" | "file" | "path";
  path: string;
  isRelative: boolean;
}

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "tif",
  "tiff",
  "heic",
  "heif",
]);

/** The local images `text` mentions, each once, in order of appearance. */
export function findLocalImageReferences(text: string): LocalImageReference[] {
  const references: LocalImageReference[] = [];
  const codeRanges: Array<{ start: number; end: number }> = [];
  const localLinkRanges: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();

  const addAbsolutePath = (rawPath: string, index: number) => {
    const path = cleanCandidatePath(rawPath);
    if (!isSupportedLocalImagePath(path) || seen.has(`path:${path}`)) return;
    seen.add(`path:${path}`);
    references.push({ index, kind: "path", path, isRelative: false });
  };

  const addFileHref = (rawHref: string, index: number) => {
    const target = parseFileHref(rawHref);
    if (!target || seen.has(`file:${target.path}:${target.isRelative ? "relative" : "absolute"}`)) return;
    seen.add(`file:${target.path}:${target.isRelative ? "relative" : "absolute"}`);
    references.push({ index, kind: "file", ...target });
  };

  // `![caption](/abs/shot.png)` and `![caption](file:...)` deliberately show an image.
  const addMarkdownImage = (rawTarget: string, index: number) => {
    const target = /^file:/i.test(rawTarget)
      ? parseFileHref(rawTarget)
      : isAbsoluteLocalPath(rawTarget) && isSupportedLocalImagePath(cleanCandidatePath(rawTarget))
        ? { path: cleanCandidatePath(rawTarget), isRelative: false }
        : null;
    if (!target) return;
    const key = target.isRelative ? `file:${target.path}:relative` : `path:${target.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Plain mentions of the same absolute path elsewhere in the text are the same image.
    if (!target.isRelative) seen.add(`file:${target.path}:absolute`);
    references.push({ index, kind: "markdown", ...target });
  };

  // Image syntax quoted as code (an instruction example) shows nothing.
  const literalRanges = [...text.matchAll(/```[\s\S]*?(?:```|$)|`[^`\n]+`/g)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
  // `<...>` targets may hold spaces (`<file:/Users/me/Library/Mobile Documents/...>`).
  for (const match of text.matchAll(/!\[[^\]\n]*\]\(\s*(?:<([^<>\n]+)>|([^)\s>]+))(?:\s+"[^"\n]*")?\s*\)/g)) {
    const matchStart = match.index ?? 0;
    if (literalRanges.some((range) => matchStart >= range.start && matchStart < range.end)) continue;
    localLinkRanges.push({ start: matchStart, end: matchStart + match[0].length });
    addMarkdownImage(match[1] ?? match[2] ?? "", matchStart);
  }

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const matchStart = match.index ?? 0;
    codeRanges.push({ start: matchStart, end: matchStart + match[0].length });
    const codeText = match[1] ?? "";
    if (/^file:/i.test(codeText.trim())) addFileHref(codeText, matchStart);
    else addAbsolutePath(codeText, matchStart);
  }

  for (const match of text.matchAll(/!?\[[^\]\n]*\]\((?:<(file:[^<>\n]+)>|(file:[^)]+))\)/gi)) {
    const matchStart = match.index ?? 0;
    localLinkRanges.push({ start: matchStart, end: matchStart + match[0].length });
    addFileHref(match[1] ?? match[2] ?? "", matchStart);
  }

  for (const match of text.matchAll(/\bfile:[^\s`"'<>]+/gi)) {
    const matchStart = match.index ?? 0;
    if (codeRanges.some((range) => matchStart >= range.start && matchStart < range.end)) continue;
    localLinkRanges.push({ start: matchStart, end: matchStart + match[0].length });
    addFileHref(match[0], matchStart);
  }

  for (const { index, path } of matchAbsoluteImagePaths(text)) {
    if (codeRanges.some((range) => index >= range.start && index < range.end)) continue;
    if (localLinkRanges.some((range) => index >= range.start && index < range.end)) continue;
    addAbsolutePath(path, index);
  }

  return references.sort((left, right) => left.index - right.index);
}

/** Absolute image paths in plain text, with the offset where each starts. */
export function matchAbsoluteImagePaths(text: string): Array<{ index: number; path: string }> {
  const matches: Array<{ index: number; path: string }> = [];
  for (const match of text.matchAll(/\/[^\s`"'<>]+/g)) {
    const path = cleanCandidatePath(match[0]);
    if (isSupportedLocalImagePath(path)) matches.push({ index: match.index ?? 0, path });
  }
  return matches;
}

function parseFileHref(rawHref: string): { path: string; isRelative: boolean } | null {
  const trimmed = rawHref.trim();
  if (!/^file:/i.test(trimmed)) return null;

  let rawPath = trimmed.slice(5);
  if (rawPath.startsWith("///")) {
    rawPath = rawPath.slice(2);
  } else if (rawPath.startsWith("//")) {
    const slashAt = rawPath.indexOf("/", 2);
    rawPath = slashAt >= 0 ? rawPath.slice(slashAt) : "/";
  }

  let decoded = rawPath;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  const path = cleanCandidatePath(stripFileLocationSuffix(decoded));
  if (!isSupportedLocalImagePath(path)) return null;
  return {
    path,
    isRelative: !isAbsoluteLocalPath(path),
  };
}

function cleanCandidatePath(rawPath: string): string {
  let path = rawPath.trim();
  while (/[.,;:!?)}\]]$/.test(path)) {
    path = path.slice(0, -1);
  }
  return path;
}

function stripFileLocationSuffix(path: string): string {
  const lineRangeMatch = path.match(/^(.*):(\d+)-(\d+)$/);
  if (lineRangeMatch) return lineRangeMatch[1] ?? path;
  const lineColMatch = path.match(/^(.*):(\d+):(\d+)$/);
  if (lineColMatch) return lineColMatch[1] ?? path;
  const lineOnlyMatch = path.match(/^(.*):(\d+)$/);
  if (lineOnlyMatch) return lineOnlyMatch[1] ?? path;
  return path;
}

function isSupportedLocalImagePath(path: string): boolean {
  if (path.startsWith("//")) return false;
  const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return Boolean(extension && SUPPORTED_IMAGE_EXTENSIONS.has(extension));
}

function isAbsoluteLocalPath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}
