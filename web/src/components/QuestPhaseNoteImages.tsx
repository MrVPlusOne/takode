import { useMemo } from "react";
import type { QuestImage } from "../types.js";
import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import {
  buildQuestImagePreviewItems,
  dedupePreviewItems,
  extractMentionedLocalImagePreviewItems,
  type ImagePreviewItem,
} from "./image-preview-utils.js";

export function extractMentionedLocalImagePaths(text: string, sessionId?: string): ImagePreviewItem[] {
  return extractMentionedLocalImagePreviewItems(text, { sessionId });
}

export function QuestTextImagePreviews({
  text,
  sessionId,
  testId,
}: {
  text: string;
  sessionId?: string;
  testId: string;
}) {
  const images = useMemo(() => extractMentionedLocalImagePreviewItems(text, { sessionId }), [sessionId, text]);
  return <ImagePreviewGroup images={images} testId={testId} />;
}

export function QuestPhaseNoteImages({
  text,
  images,
  sessionId,
}: {
  text: string;
  images?: QuestImage[];
  sessionId?: string;
}) {
  const previewItems = useMemo(() => {
    const attachedImages = images ?? [];
    const attachedItems = buildQuestImagePreviewItems(attachedImages);
    const attachedPaths = new Set(attachedImages.map((image) => image.path));
    const mentionedItems = extractMentionedLocalImagePreviewItems(text, { sessionId }).filter(
      (image) => !image.title || !attachedPaths.has(image.title),
    );
    return dedupePreviewItems([...attachedItems, ...mentionedItems]);
  }, [images, sessionId, text]);

  return <ImagePreviewGroup images={previewItems} testId="phase-note-image-thumbnails" />;
}
