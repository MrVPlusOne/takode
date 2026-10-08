import { join } from "node:path";
import { homedir } from "node:os";
import type { ImageRef } from "./image-store.js";
import { buildStoredImageFilename } from "./image-store.js";

let remoteAttachmentDirectory: (sessionId: string) => string | null = () => null;

/**
 * Called once at server startup. A session on a remote host reads its
 * attachments from a directory on that host, which the resolver returns.
 */
export function configureRemoteAttachmentDirectories(resolver: (sessionId: string) => string | null): void {
  remoteAttachmentDirectory = resolver;
}

/** Where a session's agent finds its image attachments, on the machine the session runs on. */
export function attachmentDirectory(sessionId: string): string {
  return remoteAttachmentDirectory(sessionId) ?? join(homedir(), ".companion", "images", sessionId);
}

export function deriveAttachmentPaths(sessionId: string, imageRefs: ImageRef[]): string[] {
  const imgDir = attachmentDirectory(sessionId);
  return imageRefs.map((ref) => {
    return join(imgDir, buildStoredImageFilename(ref.imageId, ref.media_type, { optimized: ref.optimized === true }));
  });
}

export function formatAttachmentPathAnnotation(paths: string[]): string {
  if (paths.length === 0) return "";
  const numbered = paths.map((path, idx) => `Attachment ${idx + 1}: ${path}`).join("\n");
  return `\n[📎 Image attachments -- read these files with the Read tool before responding:\n${numbered}]`;
}
