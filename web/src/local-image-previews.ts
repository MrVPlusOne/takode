import type { BrowserIncomingMessage, ChatMessage, LocalImageAttachment, PendingUserUpload } from "./types.js";
import type { AppState } from "./store-types.js";

type UserMessage = Extract<BrowserIncomingMessage, { type: "user_message" }>;

type PreviewSource = {
  messageId?: string;
  imageIds: string[];
  localImages: LocalImageAttachment[];
};

const managedObjectUrlsBySession = new Map<string, Set<string>>();
const mountedObjectUrlStates = new Map<string, { mounted: number; settled: number; settlementNotified: boolean }>();

function mountedObjectUrlStateKey(sessionId: string, previewUrl: string): string {
  return `${sessionId}\u0000${previewUrl}`;
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function localImagesForMessage(message: ChatMessage): LocalImageAttachment[] {
  if (!message.localImages?.length || !message.images?.length) return [];
  const authoritativeIds = new Set(message.images.map((image) => image.imageId));
  return message.localImages.filter(
    (image): image is LocalImageAttachment & { imageId: string } =>
      typeof image.imageId === "string" && authoritativeIds.has(image.imageId),
  );
}

function sourceFromMessage(message: ChatMessage): PreviewSource | null {
  if (!message.clientMsgId || !message.images?.length) return null;
  const localImages = localImagesForMessage(message);
  if (localImages.length === 0) return null;
  return {
    messageId: message.id,
    imageIds: message.images.map((image) => image.imageId),
    localImages,
  };
}

function sourceFromPendingUpload(upload: PendingUserUpload): PreviewSource | null {
  const refs =
    upload.prepared?.imageRefs ?? upload.images.flatMap((image) => (image.prepared ? [image.prepared.imageRef] : []));
  if (refs.length === 0) return null;

  const draftsByImageId = new Map(
    upload.images.flatMap((image) => (image.prepared ? [[image.prepared.imageRef.imageId, image] as const] : [])),
  );
  const localImages = refs.flatMap((ref) => {
    const draft = draftsByImageId.get(ref.imageId);
    if (!draft?.base64) return [];
    return [
      {
        imageId: ref.imageId,
        name: draft.name,
        base64: draft.base64,
        mediaType: draft.mediaType,
      },
    ];
  });
  if (localImages.length === 0) return null;
  return { imageIds: refs.map((ref) => ref.imageId), localImages };
}

function addSource(sources: Map<string, PreviewSource | null>, clientMsgId: string, candidate: PreviewSource): void {
  const existing = sources.get(clientMsgId);
  if (existing === null) return;
  if (!existing) {
    sources.set(clientMsgId, candidate);
    return;
  }
  if (
    (existing.messageId && candidate.messageId && existing.messageId !== candidate.messageId) ||
    !arraysEqual(existing.imageIds, candidate.imageIds)
  ) {
    sources.set(clientMsgId, null);
    return;
  }

  const imagesById = new Map(existing.localImages.flatMap((image) => (image.imageId ? [[image.imageId, image]] : [])));
  for (const image of candidate.localImages) {
    if (image.imageId && !imagesById.has(image.imageId)) imagesById.set(image.imageId, image);
  }
  sources.set(clientMsgId, {
    messageId: existing.messageId ?? candidate.messageId,
    imageIds: existing.imageIds,
    localImages: existing.imageIds.flatMap((imageId) => {
      const image = imagesById.get(imageId);
      return image ? [image] : [];
    }),
  });
}

/**
 * Snapshot browser-local image ownership before an authoritative message/window replacement.
 * Server message and attachment identities remain authoritative; this only carries matching preview bytes/URLs.
 */
export function collectLocalImagePreviewSources(
  state: Pick<AppState, "messages" | "threadWindowMessages" | "pendingUserUploads" | "pendingUserUploadRestorations">,
  sessionId: string,
): Map<string, PreviewSource | null> {
  const sources = new Map<string, PreviewSource | null>();
  const messageLists: ChatMessage[][] = [state.messages.get(sessionId) ?? []];
  for (const messages of state.threadWindowMessages.get(sessionId)?.values() ?? []) messageLists.push(messages);

  for (const messages of messageLists) {
    for (const message of messages) {
      const source = sourceFromMessage(message);
      if (source && message.clientMsgId) addSource(sources, message.clientMsgId, source);
    }
  }

  const pending = state.pendingUserUploads.get(sessionId) ?? [];
  const restorations = [...(state.pendingUserUploadRestorations.get(sessionId)?.values() ?? [])];
  for (const upload of [...pending, ...restorations]) {
    const source = sourceFromPendingUpload(upload);
    if (source) addSource(sources, upload.id, source);
  }
  return sources;
}

function decodeBase64(base64: string): Uint8Array | null {
  if (typeof globalThis.atob !== "function") return null;
  try {
    const binary = globalThis.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function createManagedPreview(
  sessionId: string,
  image: LocalImageAttachment & { imageId: string },
): LocalImageAttachment {
  if (image.previewUrl) return image;
  const bytes = image.base64 ? decodeBase64(image.base64) : null;
  if (
    !bytes ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function"
  ) {
    return image;
  }

  try {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const previewUrl = URL.createObjectURL(new Blob([buffer], { type: image.mediaType }));
    const urls = managedObjectUrlsBySession.get(sessionId) ?? new Set<string>();
    urls.add(previewUrl);
    managedObjectUrlsBySession.set(sessionId, urls);
    return { imageId: image.imageId, name: image.name, mediaType: image.mediaType, previewUrl };
  } catch {
    return image;
  }
}

/** Overlay only exact origin-browser attachments onto an authoritative user message. */
export function resolveLocalImagePreviews(
  sessionId: string,
  message: UserMessage,
  sources: Map<string, PreviewSource | null>,
): LocalImageAttachment[] | undefined {
  if (message.codexSubagent || typeof message.client_msg_id !== "string" || !message.images?.length) return undefined;
  const source = sources.get(message.client_msg_id);
  if (!source) return undefined;
  if (source.messageId && message.id && source.messageId !== message.id) return undefined;
  if (!source.messageId && typeof message.id === "string" && message.id.trim()) source.messageId = message.id;

  const localByImageId = new Map(
    source.localImages.flatMap((image) => (image.imageId ? [[image.imageId, image] as const] : [])),
  );
  const resolved = message.images.flatMap((ref) => {
    const local = localByImageId.get(ref.imageId);
    if (!local) return [];
    const preview = createManagedPreview(sessionId, { ...local, imageId: ref.imageId });
    localByImageId.set(ref.imageId, preview);
    return [preview];
  });
  source.localImages = source.imageIds.flatMap((imageId) => {
    const image = localByImageId.get(imageId);
    return image ? [image] : [];
  });
  return resolved.length > 0 ? resolved : undefined;
}

function collectReferencedPreviewUrls(
  state: Pick<AppState, "messages" | "threadWindowMessages">,
  sessionId: string,
): Set<string> {
  const referenced = new Set<string>();
  const collect = (messages: readonly ChatMessage[]) => {
    for (const message of messages) {
      for (const image of message.localImages ?? []) {
        if (image.previewUrl) referenced.add(image.previewUrl);
      }
    }
  };
  collect(state.messages.get(sessionId) ?? []);
  for (const messages of state.threadWindowMessages.get(sessionId)?.values() ?? []) collect(messages);
  return referenced;
}

function revokeManagedUrl(sessionId: string, previewUrl: string): void {
  const urls = managedObjectUrlsBySession.get(sessionId);
  if (!urls?.delete(previewUrl)) return;
  mountedObjectUrlStates.delete(mountedObjectUrlStateKey(sessionId, previewUrl));
  try {
    URL.revokeObjectURL(previewUrl);
  } catch {
    // The browser releases document-owned blob URLs on teardown even if explicit cleanup is unavailable.
  }
  if (urls.size === 0) managedObjectUrlsBySession.delete(sessionId);
}

/** Revoke object URLs only after no authoritative browser view references them. */
export function reconcileLocalImagePreviewUrls(
  state: Pick<AppState, "messages" | "threadWindowMessages">,
  sessionId: string,
): void {
  const urls = managedObjectUrlsBySession.get(sessionId);
  if (!urls?.size) return;
  const referenced = collectReferencedPreviewUrls(state, sessionId);
  for (const url of [...urls]) {
    if (
      !referenced.has(url) &&
      (mountedObjectUrlStates.get(mountedObjectUrlStateKey(sessionId, url))?.mounted ?? 0) === 0
    ) {
      revokeManagedUrl(sessionId, url);
    }
  }
}

/**
 * Keep local blob previews alive while rendered preview groups own them.
 * Shared preview state settles only after every currently mounted owner has decoded the blob.
 */
export function retainLocalImagePreviewUrls(
  sessionId: string,
  previewUrls: readonly string[],
  callbacks: {
    onAllSettled: (previewUrls: string[]) => void;
    onUnused: (previewUrls: string[]) => void;
  },
): { markSettled: (previewUrl: string) => void; release: () => void } {
  const retained = [...new Set(previewUrls.filter((url) => url.startsWith("blob:")))];
  const ownerSettledUrls = new Set<string>();
  let released = false;
  for (const url of retained) {
    const key = mountedObjectUrlStateKey(sessionId, url);
    const state = mountedObjectUrlStates.get(key) ?? { mounted: 0, settled: 0, settlementNotified: false };
    state.mounted += 1;
    mountedObjectUrlStates.set(key, state);
  }

  const notifyIfAllSettled = (url: string) => {
    const state = mountedObjectUrlStates.get(mountedObjectUrlStateKey(sessionId, url));
    if (!state || state.settlementNotified || state.mounted === 0 || state.settled < state.mounted) return;
    state.settlementNotified = true;
    callbacks.onAllSettled([url]);
  };

  return {
    markSettled: (url) => {
      if (released || !retained.includes(url) || ownerSettledUrls.has(url)) return;
      ownerSettledUrls.add(url);
      const state = mountedObjectUrlStates.get(mountedObjectUrlStateKey(sessionId, url));
      if (!state) return;
      state.settled += 1;
      notifyIfAllSettled(url);
    },
    release: () => {
      if (released) return;
      released = true;
      // StrictMode and same-commit remounts can reacquire before this microtask runs.
      queueMicrotask(() => {
        const unused: string[] = [];
        for (const url of retained) {
          const key = mountedObjectUrlStateKey(sessionId, url);
          const state = mountedObjectUrlStates.get(key);
          if (!state) continue;
          state.mounted = Math.max(0, state.mounted - 1);
          if (ownerSettledUrls.has(url)) state.settled = Math.max(0, state.settled - 1);
          if (state.mounted === 0) {
            mountedObjectUrlStates.delete(key);
            unused.push(url);
          } else {
            notifyIfAllSettled(url);
          }
        }
        if (unused.length > 0) callbacks.onUnused(unused);
      });
    },
  };
}

export function releaseSessionLocalImagePreviewUrls(sessionId: string): void {
  const urls = managedObjectUrlsBySession.get(sessionId);
  if (!urls) return;
  for (const url of [...urls]) revokeManagedUrl(sessionId, url);
}

export function releaseAllLocalImagePreviewUrls(): void {
  for (const sessionId of [...managedObjectUrlsBySession.keys()]) releaseSessionLocalImagePreviewUrls(sessionId);
}
