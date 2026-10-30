import { useMemo } from "react";
import { useStore } from "../store.js";
import { sendToSession } from "../ws.js";
import type { ChatMessage, PendingCodexInput, PendingUserUpload } from "../types.js";
import { MessageBubble, rendersAsUserBubble } from "./MessageBubble.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { getFooterFeedBlockId, getPendingCodexFeedBlockId } from "./message-feed-utils.js";

type PendingStatus = "sending" | "queued" | "delivering" | "failed";

interface PendingInputItem {
  key: string;
  blockId: string;
  message: ChatMessage;
  status: PendingStatus;
  error?: string;
  /** Cancels delivery; the server or store puts the text back in the composer. */
  onCancel?: () => void;
  onRetry?: () => void;
  /** True when Cancel restores the message to the composer for editing. */
  cancelRestores: boolean;
}

interface PendingInputProps {
  sessionId: string;
  uploads: PendingUserUpload[];
  codexInputs: PendingCodexInput[];
  questLinkSurface?: QuestLinkSurface;
}

/**
 * Pending messages drawn as the bubbles they will become once delivered, faded,
 * at the end of the feed where the delivered message lands. Their state and
 * actions sit in a pill on the bubble's lower edge, outside the layout, so the
 * feed keeps its shape when a message lands.
 */
export function PendingMessages(props: PendingInputProps) {
  if (props.uploads.length === 0 && props.codexInputs.length === 0) return null;
  return <PendingMessageList {...props} />;
}

function PendingMessageList(props: PendingInputProps) {
  const items = usePendingInputItems(props.sessionId, props.uploads, props.codexInputs);
  return (
    <div className="space-y-5" data-feed-block-id={getFooterFeedBlockId("pending-inputs")}>
      {items.map((item) => (
        <div key={item.key} className="relative" data-feed-block-id={item.blockId} data-pending-status={item.status}>
          <div className={item.status === "failed" ? "opacity-80" : "opacity-55"}>
            <MessageBubble
              message={item.message}
              sessionId={props.sessionId}
              showTimestamp
              questLinkSurface={props.questLinkSurface}
            />
          </div>
          <PendingStatusPill item={item} side={rendersAsUserBubble(item.message) ? "right" : "left"} />
        </div>
      ))}
    </div>
  );
}

/**
 * Sits across the message's lower edge: beside the menu slot for user bubbles,
 * under the icon for left-side event cards.
 */
function PendingStatusPill({ item, side }: { item: PendingInputItem; side: "left" | "right" }) {
  const failed = item.status === "failed";
  const label =
    item.status === "sending"
      ? "Sending…"
      : item.status === "queued"
        ? "Queued"
        : item.status === "delivering"
          ? "Delivering…"
          : item.error || "Not delivered";
  return (
    <div
      className={`absolute -bottom-2.5 z-20 flex max-w-[calc(100%-3rem)] text-[11px] leading-4 ${
        side === "right" ? "right-[34px] justify-end" : "left-9"
      }`}
      data-testid="pending-input-status"
    >
      <span
        className={`flex min-w-0 items-center gap-1.5 rounded-full border bg-cc-card px-2 py-0.5 shadow-sm ${
          failed ? "border-cc-error/30 text-cc-error" : "border-cc-border text-cc-muted"
        }`}
      >
        {failed ? <AlertIcon /> : <ClockIcon />}
        <span className="truncate">{label}</span>
        {item.onRetry && (
          <StatusAction label="Retry" title="Try delivering this message again" onClick={item.onRetry} primary />
        )}
        {item.onCancel && (
          <StatusAction
            label={failed && item.cancelRestores ? "Edit" : "Cancel"}
            title={
              item.cancelRestores
                ? "Cancel delivery and put this message back in the composer"
                : "Cancel delivery of this message"
            }
            onClick={item.onCancel}
          />
        )}
      </span>
    </div>
  );
}

function StatusAction({
  label,
  title,
  onClick,
  primary,
}: {
  label: string;
  title: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <>
      <span aria-hidden="true" className="text-cc-muted/40">
        ·
      </span>
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`-my-1 cursor-pointer rounded px-0.5 py-1 font-medium transition-colors hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/60 ${
          primary ? "text-cc-primary" : "text-cc-muted hover:text-cc-fg"
        }`}
      >
        {label}
      </button>
    </>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3 shrink-0">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3 shrink-0">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 11h.01" strokeLinecap="round" />
    </svg>
  );
}

function usePendingInputItems(
  sessionId: string,
  uploads: PendingUserUpload[],
  codexInputs: PendingCodexInput[],
): PendingInputItem[] {
  const restorations = useStore((state) => state.pendingUserUploadRestorations.get(sessionId));
  // Stable message objects let the memoized bubbles skip unrelated feed renders.
  return useMemo(() => {
    const items = [
      ...uploads.map((upload) => uploadItem(sessionId, upload)),
      ...codexInputs.map((input) =>
        codexItem(sessionId, input, input.clientMsgId ? restorations?.get(input.clientMsgId) : undefined),
      ),
    ];
    return items.sort((a, b) => a.message.timestamp - b.message.timestamp);
  }, [codexInputs, restorations, sessionId, uploads]);
}

function uploadItem(sessionId: string, upload: PendingUserUpload): PendingInputItem {
  const failed = upload.stage === "failed";
  const message: ChatMessage = {
    id: `pending-upload-${upload.id}`,
    role: "user",
    content: upload.content,
    localImages: upload.images.map(({ name, base64, mediaType, prepared }) => ({
      name,
      base64,
      mediaType,
      ...(prepared ? { imageId: prepared.imageRef.imageId } : {}),
    })),
    // Server copies stand in for images synced from another browser, which have no local bytes.
    ...(upload.prepared?.imageRefs.length && upload.images.some((image) => !image.base64)
      ? { images: upload.prepared.imageRefs }
      : {}),
    timestamp: upload.timestamp,
    metadata: pendingMetadata(upload),
    ephemeral: true,
    pendingState: "queued",
    clientMsgId: upload.id,
  };

  const restoreToDraft = () => {
    const store = useStore.getState();
    store.removePendingUserUpload(sessionId, upload.id);
    // Back into the composer it was sent from (a side chat's, or the main one).
    const draftKey = upload.draftKey ?? sessionId;
    store.setComposerDraft(draftKey, { text: upload.content, images: upload.images, annotations: upload.annotations });
    store.setReplyContext(draftKey, upload.replyContext ?? null);
    store.focusComposer();
  };

  const retry = () => {
    if (!upload.prepared) return;
    const sent = sendToSession(sessionId, {
      type: "user_message",
      content: upload.content,
      deliveryContent: upload.prepared.deliveryContent,
      imageRefs: upload.prepared.imageRefs,
      ...(upload.annotations?.length ? { annotations: upload.annotations } : {}),
      ...(upload.replyContext ? { replyContext: upload.replyContext } : {}),
      ...(upload.vscodeSelection ? { vscodeSelection: upload.vscodeSelection } : {}),
      ...(upload.threadKey ? { threadKey: upload.threadKey } : {}),
      ...(upload.questId ? { questId: upload.questId } : {}),
      session_id: sessionId,
      client_msg_id: upload.id,
      inputSource: "composer",
    });
    useStore
      .getState()
      .updatePendingUserUpload(sessionId, upload.id, (current) =>
        sent
          ? { ...current, stage: "delivering", error: undefined }
          : { ...current, stage: "failed", error: "Connection lost before delivery." },
      );
  };

  return {
    key: `upload:${upload.id}`,
    blockId: getFooterFeedBlockId(`pending-upload:${upload.id}`),
    message,
    status: failed ? "failed" : "sending",
    error: upload.error,
    ...(failed ? { onCancel: restoreToDraft, ...(upload.prepared ? { onRetry: retry } : {}) } : {}),
    cancelRestores: true,
  };
}

function codexItem(sessionId: string, input: PendingCodexInput, restoration?: PendingUserUpload): PendingInputItem {
  const failed = input.deliveryState === "failed";
  // This browser's own copies of the images show instantly instead of waiting for the server copies.
  const localImages = restoration?.images.flatMap(({ name, base64, mediaType, prepared }) =>
    prepared ? [{ name, base64, mediaType, imageId: prepared.imageRef.imageId }] : [],
  );
  const message: ChatMessage = {
    id: `pending-codex-${input.id}`,
    role: "user",
    content: input.content,
    timestamp: input.timestamp,
    ...(input.imageRefs?.length ? { images: input.imageRefs } : {}),
    ...(localImages?.length ? { localImages } : {}),
    metadata: {
      ...pendingMetadata(input),
      ...(input.threadRefs?.length ? { threadRefs: input.threadRefs } : {}),
    },
    ...(input.agentSource ? { agentSource: input.agentSource } : {}),
    ephemeral: true,
    pendingState: "queued",
    ...(input.clientMsgId ? { clientMsgId: input.clientMsgId } : {}),
  };
  const cancel = () => sendToSession(sessionId, { type: "cancel_pending_codex_input", id: input.id });
  const retry = () => sendToSession(sessionId, { type: "retry_pending_codex_input", id: input.id });
  return {
    key: `codex:${input.id}`,
    blockId: getPendingCodexFeedBlockId(input.id),
    message,
    status: failed ? "failed" : input.cancelable ? "queued" : "delivering",
    error: failed ? input.failureMessage || "Codex rejected this input before delivery." : undefined,
    ...(input.cancelable ? { onCancel: cancel, ...(failed ? { onRetry: retry } : {}) } : {}),
    // Cancelling puts the text back in the composer unless only server copies of its images remain.
    // Only the sending browser keeps the draft to edit; elsewhere Cancel just withdraws the message.
    cancelRestores: Boolean(restoration),
  };
}

function pendingMetadata(source: {
  annotations?: PendingUserUpload["annotations"];
  replyContext?: PendingUserUpload["replyContext"];
  vscodeSelection?: PendingUserUpload["vscodeSelection"];
  threadKey?: string;
  questId?: string;
}): ChatMessage["metadata"] {
  return {
    ...(source.annotations?.length ? { annotations: source.annotations } : {}),
    ...(source.replyContext ? { replyContext: source.replyContext } : {}),
    ...(source.vscodeSelection ? { vscodeSelection: source.vscodeSelection } : {}),
    ...(source.threadKey ? { threadKey: source.threadKey } : {}),
    ...(source.questId ? { questId: source.questId } : {}),
  };
}
