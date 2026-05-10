import { useMemo } from "react";
import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import { extractMentionedLocalImagePreviewItems, type ImagePreviewItem } from "./image-preview-utils.js";

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

export function QuestPhaseNoteImages({ text, sessionId }: { text: string; sessionId?: string }) {
  return <QuestTextImagePreviews text={text} sessionId={sessionId} testId="phase-note-image-thumbnails" />;
}
