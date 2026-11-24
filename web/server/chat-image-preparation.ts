import type { LocalImageReference } from "../shared/local-image-references.js";
import { getArtifactThumbnails } from "./artifact-thumbnails.js";
import { imageConversionQueue } from "./image-conversion-queue.js";
import { sharedLocalImageVariantStore } from "./local-image-variant-store.js";
import { localCopyOfHostFile } from "./remote-host/host-file-cache.js";
import type { RouteContext } from "./routes/context.js";
import { resolveFileLinkPath } from "./routes/filesystem.js";

/**
 * Prepares the images agents show in chats before anyone opens them: each image's feed
 * thumbnail and full view, made from the same file the feed's preview requests read, and the
 * Library thumbnail of each figure saved from a chat. Conversions wait in the background queue.
 */

/** Queues the thumbnail and full view of each local image a session's agent mentioned. */
export function prepareChatImages(
  sessionId: string,
  references: LocalImageReference[],
  wsBridge: RouteContext["wsBridge"],
): void {
  for (const reference of references) {
    imageConversionQueue.add(`Preparing ${reference.path}`, async () => {
      const source = await previewSource(sessionId, reference, wsBridge);
      if (source) await sharedLocalImageVariantStore().prepare(source.path, source.mimeType);
    });
  }
}

/** Queues the gallery thumbnail of a figure the Library just saved. */
export function prepareLibraryThumbnail(artifactId: string): void {
  // A figure's thumbnail is the same for both themes.
  imageConversionQueue.add(`Library thumbnail ${artifactId}`, async () =>
    getArtifactThumbnails()?.get(artifactId, "dark"),
  );
}

/**
 * The local file the feed's preview of `reference` is made from, or null when there is none.
 * Mirrors the browser: every local image resolves through the session, and a remote host's file
 * is copied here first.
 */
async function previewSource(
  sessionId: string,
  reference: LocalImageReference,
  wsBridge: RouteContext["wsBridge"],
): Promise<{ path: string; mimeType: string } | null> {
  const target = await resolveFileLinkPath(
    { path: reference.path, isRelative: reference.isRelative, sessionId },
    wsBridge,
  );
  if (!target.isImage || !target.mimeType) return null;
  const path = target.hostId
    ? await localCopyOfHostFile(target.hostId, target.absolutePath, target.size)
    : target.absolutePath;
  return { path, mimeType: target.mimeType };
}
