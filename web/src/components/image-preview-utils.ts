import type { ChatMessage, ImageRef, LocalImageAttachment } from "../types.js";
import { api } from "../api.js";
import { buildFileLinkImageVariantUrl } from "../api/file-link-actions.js";

export interface ImagePreviewItem {
  id: string;
  filename: string;
  thumbnailUrl: string;
  fullUrl: string;
  title?: string;
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

interface LocalReferenceOptions {
  sessionId?: string;
}

export function extractMentionedLocalImagePreviewItems(
  text: string,
  options: LocalReferenceOptions = {},
): ImagePreviewItem[] {
  const references: Array<{ index: number; item: ImagePreviewItem }> = [];
  const codeRanges: Array<{ start: number; end: number }> = [];
  const localLinkRanges: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();

  const addAbsolutePath = (rawPath: string, index: number) => {
    const path = cleanCandidatePath(rawPath);
    if (!isSupportedLocalImagePath(path) || seen.has(`path:${path}`)) return;
    seen.add(`path:${path}`);
    references.push({ index, item: previewItemForAbsolutePath(path) });
  };

  const addFileHref = (rawHref: string, index: number) => {
    const target = parseFileHref(rawHref);
    if (!target || seen.has(`file:${target.path}:${target.isRelative ? "relative" : "absolute"}`)) return;
    seen.add(`file:${target.path}:${target.isRelative ? "relative" : "absolute"}`);
    references.push({
      index,
      item: target.isRelative
        ? previewItemForRelativeFileLink(target.path, options.sessionId)
        : previewItemForAbsolutePath(target.path),
    });
  };

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const matchStart = match.index ?? 0;
    codeRanges.push({ start: matchStart, end: matchStart + match[0].length });
    const codeText = match[1] ?? "";
    if (/^file:/i.test(codeText.trim())) addFileHref(codeText, matchStart);
    else addAbsolutePath(codeText, matchStart);
  }

  for (const match of text.matchAll(/!?\[[^\]\n]*\]\((file:[^)]+)\)/gi)) {
    const matchStart = match.index ?? 0;
    localLinkRanges.push({ start: matchStart, end: matchStart + match[0].length });
    addFileHref(match[1] ?? "", matchStart);
  }

  for (const match of text.matchAll(/\bfile:[^\s`"'<>]+/gi)) {
    const matchStart = match.index ?? 0;
    if (codeRanges.some((range) => matchStart >= range.start && matchStart < range.end)) continue;
    localLinkRanges.push({ start: matchStart, end: matchStart + match[0].length });
    addFileHref(match[0], matchStart);
  }

  for (const match of text.matchAll(/\/[^\s`"'<>]+/g)) {
    const matchStart = match.index ?? 0;
    if (codeRanges.some((range) => matchStart >= range.start && matchStart < range.end)) continue;
    if (localLinkRanges.some((range) => matchStart >= range.start && matchStart < range.end)) continue;
    addAbsolutePath(match[0], matchStart);
  }

  return references.sort((left, right) => left.index - right.index).map(({ item }) => item);
}

export function buildAssistantImagePreviewItems(message: ChatMessage, sessionId?: string): ImagePreviewItem[] {
  const items: ImagePreviewItem[] = [];
  items.push(...imagePreviewItemsFromLocalAttachments(message.localImages ?? []));
  if (sessionId) {
    items.push(...imagePreviewItemsFromStoredRefs(message.images ?? [], sessionId));
  }
  items.push(...extractMentionedLocalImagePreviewItems(assistantVisibleText(message), { sessionId }));
  return dedupePreviewItems(items);
}

export function dedupePreviewItems(items: ImagePreviewItem[]): ImagePreviewItem[] {
  const seen = new Set<string>();
  const deduped: ImagePreviewItem[] = [];
  for (const item of items) {
    const key = item.fullUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function imagePreviewItemsFromLocalAttachments(images: LocalImageAttachment[]): ImagePreviewItem[] {
  return images.map((image, index) => {
    const dataUrl = `data:${image.mediaType};base64,${image.base64}`;
    return {
      id: `local:${image.name || index}`,
      filename: image.name || `attachment-${index + 1}`,
      thumbnailUrl: dataUrl,
      fullUrl: dataUrl,
      title: image.name || "attachment",
    };
  });
}

function imagePreviewItemsFromStoredRefs(images: ImageRef[], sessionId: string): ImagePreviewItem[] {
  return images.map((image) => ({
    id: `stored:${sessionId}:${image.imageId}`,
    filename: image.sourceName || image.imageId,
    thumbnailUrl: `/api/images/${sessionId}/${image.imageId}/thumb`,
    fullUrl: `/api/images/${sessionId}/${image.imageId}/full`,
    title: image.sourceName || image.imageId,
  }));
}

function assistantVisibleText(message: ChatMessage): string {
  const blocks = message.contentBlocks ?? [];
  const blockText = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return blockText.trim() ? blockText : message.content;
}

function previewItemForAbsolutePath(path: string): ImagePreviewItem {
  const filename = filenameForPath(path);
  return {
    id: `path:${path}`,
    filename,
    thumbnailUrl: api.getFsImageUrl(path, "thumbnail"),
    fullUrl: api.getFsImageUrl(path, "full"),
    title: path,
  };
}

function previewItemForRelativeFileLink(path: string, sessionId: string | undefined): ImagePreviewItem {
  const filename = filenameForPath(path);
  const target = { path, isRelative: true, ...(sessionId ? { sessionId } : {}) };
  return {
    id: `file:${path}`,
    filename,
    thumbnailUrl: buildFileLinkImageVariantUrl(target, "thumbnail"),
    fullUrl: buildFileLinkImageVariantUrl(target, "full"),
    title: path,
  };
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

function filenameForPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
