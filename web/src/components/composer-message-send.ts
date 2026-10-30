import { useStore } from "../store.js";
import { sendToSession } from "../ws.js";
import type { ComposerDraft } from "../types.js";
import type { VsCodeSelectionContextPayload } from "../utils/vscode-context.js";
import { formatReplyContentForAssistant } from "../utils/reply-context.js";
import { nextPendingUploadId } from "./composer-image-utils.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";

/** Send a draft, retaining editable attachments when delivery has a local pending owner. */
export function sendComposerDraft(
  sessionId: string,
  draft: ComposerDraft,
  route: {
    threadKey: string;
    questId?: string;
    vscodeSelection?: VsCodeSelectionContextPayload;
    /** Where the draft is kept, when not the session's main draft (a side chat's composer). */
    draftKey?: string;
  },
  isCodex: boolean,
): "sent" | "retained" | "failed" {
  const store = useStore.getState();
  const content = draft.text.trim();
  const draftKey = route.draftKey ?? sessionId;
  const replyContext = store.replyContexts.get(draftKey);
  const paths = draft.images.flatMap((image) => (image.prepared ? [image.prepared.path] : []));
  const imageRefs = draft.images.flatMap((image) => (image.prepared ? [image.prepared.imageRef] : []));
  const deliveryContent =
    formatReplyContentForAssistant(content, replyContext ?? undefined) +
    (paths.length
      ? `\n[📎 Image attachments -- read these files with the Read tool before responding:\n${paths.map((path, index) => `Attachment ${index + 1}: ${path}`).join("\n")}]`
      : "");
  const metadata = {
    ...(draft.annotations?.length ? { annotations: draft.annotations } : {}),
    ...(replyContext ? { replyContext } : {}),
    ...(route.vscodeSelection ? { vscodeSelection: route.vscodeSelection } : {}),
    threadKey: route.threadKey,
    ...(isQuestThreadKey(route.threadKey) ? { questId: route.questId ?? route.threadKey } : {}),
  };
  const ownsPending = isCodex || draft.images.length > 0 || !!draft.annotations?.length;
  const pendingId = ownsPending ? nextPendingUploadId() : undefined;
  if (pendingId) {
    store.addPendingUserUpload(sessionId, {
      id: pendingId,
      content,
      images: draft.images,
      timestamp: Date.now(),
      stage: "delivering",
      ...metadata,
      ...(draftKey !== sessionId ? { draftKey } : {}),
      prepared: { deliveryContent, imageRefs },
    });
  }
  const sent = sendToSession(sessionId, {
    type: "user_message",
    content,
    ...metadata,
    ...(deliveryContent !== content ? { deliveryContent } : {}),
    ...(imageRefs.length ? { imageRefs } : {}),
    ...(pendingId ? { client_msg_id: pendingId } : {}),
    inputSource: "composer",
    session_id: sessionId,
  });
  if (pendingId)
    store.updatePendingUserUpload(sessionId, pendingId, (upload) => ({
      ...upload,
      stage: sent ? "delivering" : "failed",
      error: sent ? undefined : "Connection lost before delivery.",
    }));
  if (!sent && !ownsPending) return "failed";
  store.clearComposerDraft(draftKey);
  store.setReplyContext(draftKey, null);
  if (sent) store.requestBottomAlignOnNextUserMessage(sessionId);
  return sent ? "sent" : "retained";
}
