import { useMemo } from "react";
import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import { extractMentionedLocalImagePreviewItems, type ImagePreviewItem } from "./image-preview-utils.js";

export function extractMentionedLocalImagePaths(text: string, sessionId?: string): ImagePreviewItem[] {
  return extractMentionedLocalImagePreviewItems(text, { sessionId });
}

export function QuestPhaseNoteImages({ text, sessionId }: { text: string; sessionId?: string }) {
  const images = useMemo(() => extractMentionedLocalImagePreviewItems(text, { sessionId }), [sessionId, text]);
  return <ImagePreviewGroup images={images} testId="phase-note-image-thumbnails" />;
}
