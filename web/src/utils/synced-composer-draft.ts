import {
  normalizeSyncedComposerDraft,
  type SyncedComposerDraft,
  type SyncedDraftImage,
} from "../../shared/session-drafts.js";
import type { ComposerDraft, ComposerDraftImage } from "../types.js";

/**
 * Converts between this tab's composer draft and the part of it the server shares
 * with the user's other browsers (see draft-sync.ts). Images are shared once their
 * upload has finished; images still being read, uploaded or retried stay in the tab.
 */
export function toSyncedComposerDraft(draft: ComposerDraft | undefined): SyncedComposerDraft | null {
  if (!draft) return null;
  const images: SyncedDraftImage[] = draft.images.flatMap((image) =>
    image.status === "ready" && image.prepared
      ? [{ imageRef: image.prepared.imageRef, name: image.name, path: image.prepared.path }]
      : [],
  );
  return normalizeSyncedComposerDraft({
    text: draft.text,
    ...(draft.annotations ? { annotations: draft.annotations } : {}),
    ...(draft.reportRecipientSessionId ? { reportRecipientSessionId: draft.reportRecipientSessionId } : {}),
    ...(images.length ? { images } : {}),
  });
}

function isSharedImage(image: ComposerDraftImage): boolean {
  return image.status === "ready" && !!image.prepared;
}

/**
 * Applies another browser's draft to this tab's draft. Uploaded images follow the
 * other browser's list, reusing this tab's copy of an image when it has one (which
 * keeps its local preview); this tab's unfinished uploads are kept after them.
 * Returns undefined when nothing is left.
 */
export function mergeSyncedComposerDraft(
  current: ComposerDraft | undefined,
  synced: SyncedComposerDraft | null,
): ComposerDraft | undefined {
  const localImages = current?.images ?? [];
  const localById = new Map(
    localImages.filter(isSharedImage).map((image) => [image.prepared!.imageRef.imageId, image] as const),
  );
  const images = [
    ...(synced?.images ?? []).map(
      (image): ComposerDraftImage =>
        localById.get(image.imageRef.imageId) ?? {
          id: `synced-${image.imageRef.imageId}`,
          name: image.name,
          mediaType: image.imageRef.media_type,
          base64: "",
          status: "ready",
          prepared: { imageRef: image.imageRef, path: image.path },
        },
    ),
    ...localImages.filter((image) => !isSharedImage(image)),
  ];
  if (!synced && images.length === 0) return undefined;
  return {
    text: synced?.text ?? "",
    images,
    ...(synced?.annotations ? { annotations: synced.annotations } : {}),
    ...(synced?.reportRecipientSessionId ? { reportRecipientSessionId: synced.reportRecipientSessionId } : {}),
  };
}
