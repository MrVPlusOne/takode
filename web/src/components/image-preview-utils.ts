import { draftAttachmentPaths } from "../../shared/draft-posts.js";
import type { ChatMessage, ImageRef, LocalImageAttachment, QuestImage } from "../types.js";
import { api } from "../api.js";
import { buildFileLinkImageVariantUrl } from "../api/file-link-actions.js";
import { findLocalImageReferences } from "../../shared/local-image-references.js";

export { matchAbsoluteImagePaths } from "../../shared/local-image-references.js";

export interface ImagePreviewItem {
  id: string;
  filename: string;
  thumbnailUrl: string;
  fullUrl: string;
  title?: string;
  /** Local file path the image was mentioned by; the viewer shows it for copying. */
  sourcePath?: string;
  /** Explicit attachment refs reserve a visible slot while their preview loads. */
  expectedAttachment?: boolean;
  /** The author asked for this image to be shown (Markdown image syntax), so a file
   *  that cannot load keeps its slot as a missing-image tile instead of vanishing. */
  showWhenMissing?: boolean;
  /** Browser-local bytes/URL are already available; do not flash a loading placeholder. */
  immediatelyAvailable?: boolean;
  /** Exact server attachment represented by a browser-local preview. */
  localImageId?: string;
  /** Backend URLs to use if a browser-local preview fails. */
  fallback?: { thumbnailUrl: string; fullUrl: string };
}

interface LocalReferenceOptions {
  sessionId?: string;
}

export function extractMentionedLocalImagePreviewItems(
  text: string,
  options: LocalReferenceOptions = {},
): ImagePreviewItem[] {
  return findLocalImageReferences(text).map((reference) => {
    // `![caption](...)` deliberately shows an image, so it keeps a slot from the first render
    // and stays visible as missing if the file cannot load. It resolves through the session,
    // so a remote host's path works too.
    if (reference.kind === "markdown") return markdownImagePreviewItem(reference, options.sessionId);
    return reference.isRelative
      ? previewItemForRelativeFileLink(reference.path, options.sessionId)
      : previewItemForAbsolutePath(reference.path);
  });
}

/** Preview item ID of an image mentioned by local path, so links in the text can find its preview. */
export function imagePreviewIdForLocalPath(path: string, isRelative: boolean): string {
  return isRelative ? `file:${path}` : `path:${path}`;
}

export function buildAssistantImagePreviewItems(message: ChatMessage, sessionId?: string): ImagePreviewItem[] {
  const items: ImagePreviewItem[] = [];
  items.push(...imagePreviewItemsFromLocalAttachments(message.localImages ?? []));
  if (sessionId) {
    items.push(...imagePreviewItemsFromStoredRefs(message.images ?? [], sessionId));
  }
  const text = assistantVisibleText(message);
  // A file attached to a draft shows in the draft's card, not again under the message.
  const attached = draftAttachmentPaths(text);
  items.push(
    ...extractMentionedLocalImagePreviewItems(text, { sessionId }).filter(
      (item) => !(item.sourcePath && attached.has(item.sourcePath)),
    ),
  );
  return dedupePreviewItems(items);
}

export function buildUserImagePreviewItems(message: ChatMessage, sessionId?: string): ImagePreviewItem[] {
  const localImages = message.localImages ?? [];
  const storedImages = message.images ?? [];
  if (!sessionId || storedImages.length === 0) {
    return imagePreviewItemsFromLocalAttachments(localImages);
  }

  const identifiedLocalImages = localImages.filter(
    (image): image is LocalImageAttachment & { imageId: string } => typeof image.imageId === "string",
  );
  if (identifiedLocalImages.length === 0) {
    return localImages.length > 0
      ? imagePreviewItemsFromLocalAttachments(localImages)
      : imagePreviewItemsFromStoredRefs(storedImages, sessionId);
  }

  const localByImageId = new Map(identifiedLocalImages.map((image) => [image.imageId, image]));
  return storedImages.map((stored, index) => {
    const storedItem = previewItemFromStoredRef(stored, sessionId);
    const local = localByImageId.get(stored.imageId);
    // An image synced from another browser has no local bytes; use the server's copy.
    if (!local || !(local.base64 || local.previewUrl)) return storedItem;
    return previewItemFromLocalAttachment(local, index, storedItem.id, storedItem);
  });
}

export function buildStoredImagePreviewItems(images: ImageRef[], sessionId: string): ImagePreviewItem[] {
  return imagePreviewItemsFromStoredRefs(images, sessionId);
}

export function buildQuestImagePreviewItems(images: QuestImage[]): ImagePreviewItem[] {
  return images.map((image) => {
    const url = api.questImageUrl(image.id);
    return {
      id: `quest:${image.id}`,
      filename: image.filename,
      thumbnailUrl: url,
      fullUrl: url,
      title: image.filename,
      expectedAttachment: true,
    };
  });
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
  return images.flatMap((image, index) => {
    const item = previewItemFromLocalAttachment(image, index);
    return item.thumbnailUrl ? [item] : [];
  });
}

function previewItemFromLocalAttachment(
  image: LocalImageAttachment,
  index: number,
  stableId?: string,
  fallback?: ImagePreviewItem,
): ImagePreviewItem {
  const dataUrl = image.base64 ? `data:${image.mediaType};base64,${image.base64}` : "";
  const previewUrl = image.previewUrl ?? dataUrl;
  return {
    id: stableId ?? `local:${image.imageId ?? image.name ?? "attachment"}:${index}`,
    filename: image.name || `attachment-${index + 1}`,
    thumbnailUrl: previewUrl,
    fullUrl: previewUrl,
    title: image.name || "attachment",
    expectedAttachment: true,
    immediatelyAvailable: Boolean(previewUrl),
    ...(image.imageId ? { localImageId: image.imageId } : {}),
    ...(fallback ? { fallback: { thumbnailUrl: fallback.thumbnailUrl, fullUrl: fallback.fullUrl } } : {}),
  };
}

function previewItemFromStoredRef(image: ImageRef, sessionId: string): ImagePreviewItem {
  return {
    id: `stored:${sessionId}:${image.imageId}`,
    filename: image.sourceName || image.imageId,
    thumbnailUrl: `/api/images/${sessionId}/${image.imageId}/thumb`,
    fullUrl: `/api/images/${sessionId}/${image.imageId}/full`,
    title: image.sourceName || image.imageId,
    expectedAttachment: true,
  };
}

function imagePreviewItemsFromStoredRefs(images: ImageRef[], sessionId: string): ImagePreviewItem[] {
  return images.map((image) => previewItemFromStoredRef(image, sessionId));
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
    id: imagePreviewIdForLocalPath(path, false),
    filename,
    thumbnailUrl: api.getFsImageUrl(path, "thumbnail"),
    fullUrl: api.getFsImageUrl(path, "full"),
    title: path,
    sourcePath: path,
  };
}

function markdownImagePreviewItem(
  target: { path: string; isRelative: boolean },
  sessionId: string | undefined,
): ImagePreviewItem {
  const fileTarget = { ...target, ...(sessionId ? { sessionId } : {}) };
  return {
    id: imagePreviewIdForLocalPath(target.path, target.isRelative),
    filename: filenameForPath(target.path),
    thumbnailUrl: buildFileLinkImageVariantUrl(fileTarget, "thumbnail"),
    fullUrl: buildFileLinkImageVariantUrl(fileTarget, "full"),
    title: target.path,
    sourcePath: target.path,
    expectedAttachment: true,
    showWhenMissing: true,
  };
}

function previewItemForRelativeFileLink(path: string, sessionId: string | undefined): ImagePreviewItem {
  const filename = filenameForPath(path);
  const target = { path, isRelative: true, ...(sessionId ? { sessionId } : {}) };
  return {
    id: imagePreviewIdForLocalPath(path, true),
    filename,
    thumbnailUrl: buildFileLinkImageVariantUrl(target, "thumbnail"),
    fullUrl: buildFileLinkImageVariantUrl(target, "full"),
    title: path,
    sourcePath: path,
  };
}

function filenameForPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}
