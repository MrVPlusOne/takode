import { formatAnnotatedMessage } from "../../shared/conversation-annotations.js";
import { useCallback, useMemo, useState, type RefObject } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { ChatMessage, ComposerDraftImage, SdkSessionInfo } from "../types.js";
import { copyRichText, getMessageMarkdown, getMessagePlainText, writeClipboardText } from "../utils/copy-utils.js";
import { COPY_EXCLUDE_SELECTOR, messageCopyForSlack } from "../utils/slack-copy.js";
import { generateReplyPreview } from "../utils/reply-preview.js";
import { absoluteUrlForHash, routeSessionRefForId, sessionMessageHash } from "../utils/routing.js";
import { createComposerDraftImage } from "./composer-image-utils.js";
import { ContextMenu, useMenuButton, type ContextMenuItem } from "./ContextMenu.js";
import { MessageTimeMenuMetadata, MessageTimestampMenuTrigger } from "./MessageRailTimestamp.js";
import { useSideChatActionState } from "./SideChatControls.js";
import { useMessageStarActions } from "./use-message-star-actions.js";
import { startReadAloud, stopReadAloud, useReadAloudState } from "../read-aloud-player.js";

function buildCopyMessageLink(sessionId: string | undefined, message: ChatMessage, sdkSessions: SdkSessionInfo[]) {
  if (!sessionId) return null;
  const messageIndex =
    message.historyIndex ??
    useStore
      .getState()
      .messages.get(sessionId)
      ?.findIndex((msg) => msg.id === message.id) ??
    -1;
  if (messageIndex < 0) return null;
  const sessionRef = routeSessionRefForId(sessionId, sdkSessions);
  return absoluteUrlForHash(sessionMessageHash(sessionRef, messageIndex));
}

/** The message's HTML for a rich-text copy, without a Read aloud player shown inside it. */
function messageHtmlWithoutPlayer(content: HTMLDivElement | null): string {
  if (!content) return "";
  const copy = content.cloneNode(true) as HTMLDivElement;
  for (const control of copy.querySelectorAll(COPY_EXCLUDE_SELECTOR)) control.remove();
  return copy.innerHTML;
}

function buildDraftImageName(mediaType: string, index: number): string {
  const ext = mediaType.split("/")[1]?.replace("jpeg", "jpg").replace("svg+xml", "svg") || "bin";
  return `attachment-${index + 1}.${ext}`;
}

async function restoreMessageImagesToDraft(
  sessionId: string,
  images: NonNullable<ChatMessage["images"]>,
): Promise<ComposerDraftImage[]> {
  const restored = await Promise.all(
    images.map(async (img, idx) => {
      const res = await fetch(`/api/images/${encodeURIComponent(sessionId)}/${encodeURIComponent(img.imageId)}/full`);
      if (!res.ok) throw new Error(`Failed to fetch image ${img.imageId}: ${res.statusText}`);
      const blob = await res.blob();
      const arrayBuf = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return {
        ...createComposerDraftImage(
          {
            name: buildDraftImageName(img.media_type, idx),
            base64: btoa(binary),
            mediaType: blob.type || img.media_type,
          },
          { status: "uploading" },
        ),
      };
    }),
  );
  return restored;
}

export function UserMessageMenu({
  message,
  sessionId,
  canRevert,
}: {
  message: ChatMessage;
  sessionId?: string;
  canRevert: boolean;
}) {
  const { menu, toggle, close } = useMenuButton();
  const [copied, setCopied] = useState(false);
  const starAction = useMessageStarActions(sessionId, message);

  const showCopied = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, []);

  const handleCopy = useCallback(() => {
    writeClipboardText(formatAnnotatedMessage(message.content, message.metadata?.annotations))
      .then(showCopied)
      .catch(console.error);
  }, [message.content, message.metadata?.annotations, showCopied]);

  const handleCopyLink = useCallback(() => {
    const link = buildCopyMessageLink(sessionId, message, useStore.getState().sdkSessions);
    if (!link) return;
    writeClipboardText(link).then(showCopied).catch(console.error);
  }, [message, sessionId, showCopied]);

  const handleRevert = useCallback(async () => {
    if (!sessionId || !message.id) return;
    try {
      await api.revertToMessage(sessionId, message.id);
      const store = useStore.getState();
      store.setComposerDraft(sessionId, {
        text: message.content,
        images: [],
        annotations: message.metadata?.annotations,
      });
      if (message.images?.length) {
        try {
          const images = await restoreMessageImagesToDraft(sessionId, message.images);
          store.setComposerDraft(sessionId, {
            text: message.content,
            images,
            annotations: message.metadata?.annotations,
          });
        } catch (imageErr) {
          console.error("Failed to restore images after revert:", imageErr);
        }
      }
    } catch (err) {
      console.error("Revert failed:", err);
    }
  }, [sessionId, message.id, message.content, message.images, message.metadata?.annotations]);

  const items = useMemo(() => {
    const list: ContextMenuItem[] = [{ label: "Copy message", onClick: handleCopy }];
    if (sessionId) list.push({ label: "Copy message link", onClick: handleCopyLink });
    if (starAction.actionable) list.push({ label: starAction.label, onClick: starAction.toggleStarred });
    if (canRevert) {
      list.push({
        label: "Revert to here",
        onClick: handleRevert,
        confirm: {
          title: "Revert to here?",
          description: "All messages after this point will be removed.",
          confirmLabel: "Revert",
          destructive: true,
        },
      });
    }
    return list;
  }, [canRevert, handleCopy, handleCopyLink, handleRevert, sessionId, starAction]);

  return (
    <div className="shrink-0 self-start mt-1">
      <MessageTimestampMenuTrigger
        timestamp={message.timestamp}
        testId="message-time-user-menu"
        ariaLabel="Message options"
        title="Message options"
        onClick={toggle}
        className={`rounded p-1 transition-all cursor-pointer hover:bg-cc-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/40 ${
          menu || copied
            ? "opacity-100"
            : "opacity-100 sm:opacity-0 sm:group-hover/msg:opacity-100 sm:group-focus-within/msg:opacity-100"
        }`}
      >
        {copied ? (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="w-3.5 h-3.5 text-cc-success"
          >
            <path d="M3 8.5l3.5 3.5 6.5-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-cc-muted">
            <circle cx="3" cy="8" r="1.5" />
            <circle cx="8" cy="8" r="1.5" />
            <circle cx="13" cy="8" r="1.5" />
          </svg>
        )}
      </MessageTimestampMenuTrigger>
      {menu && (
        <ContextMenu
          {...menu}
          items={items}
          onClose={close}
          footer={<MessageTimeMenuMetadata timestamp={message.timestamp} testId="message-time-user-menu-metadata" />}
          widthClassName="w-[248px] max-w-[calc(100vw-1rem)]"
        />
      )}
    </div>
  );
}

export function AssistantMessageMenu({
  message,
  contentRef,
  sessionId,
  currentThreadKey,
  showSideChatActions,
}: {
  message: ChatMessage;
  contentRef: RefObject<HTMLDivElement | null>;
  sessionId?: string;
  currentThreadKey?: string;
  showSideChatActions: boolean;
}) {
  const { menu, toggle, close } = useMenuButton();
  const [copied, setCopied] = useState<string | null>(null);
  const starAction = useMessageStarActions(sessionId, message);
  const readAloud = useReadAloudState(message.id);
  const reading = readAloud?.status === "preparing" || readAloud?.status === "ready";
  const sideChatAction = useSideChatActionState({
    currentThreadKey,
    message,
    sessionId: sessionId ?? "",
  });

  const showFeedback = useCallback((label: string) => {
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  }, []);

  const handleCopyMarkdown = useCallback(() => {
    writeClipboardText(getMessageMarkdown(message))
      .then(() => showFeedback("Markdown"))
      .catch(console.error);
  }, [message, showFeedback]);

  const handleCopyPlainText = useCallback(() => {
    writeClipboardText(getMessagePlainText(message))
      .then(() => showFeedback("Plain text"))
      .catch(console.error);
  }, [message, showFeedback]);

  const handleCopyRichText = useCallback(() => {
    copyRichText(messageHtmlWithoutPlayer(contentRef.current), getMessagePlainText(message))
      .then(() => showFeedback("Rich text"))
      .catch(console.error);
  }, [message, contentRef, showFeedback]);

  const handleCopyForSlack = useCallback(() => {
    if (!contentRef.current) return;
    messageCopyForSlack(contentRef.current)
      .write()
      .then(() => showFeedback("Slack"))
      .catch(console.error);
  }, [contentRef, showFeedback]);

  const handleCopyLink = useCallback(() => {
    const link = buildCopyMessageLink(sessionId, message, useStore.getState().sdkSessions);
    if (!link) return;
    writeClipboardText(link)
      .then(() => showFeedback("Link"))
      .catch(console.error);
  }, [message, sessionId, showFeedback]);

  const handleReply = useCallback(() => {
    if (!sessionId) return;
    const store = useStore.getState();
    const allMessages = store.messages.get(sessionId) ?? [];
    const otherContents = allMessages
      .filter((m) => m.role === "assistant" && m.id !== message.id)
      .map((m) => m.content);
    const previewText = generateReplyPreview(message.content, otherContents);
    store.setReplyContext(sessionId, { messageId: message.id, previewText });
  }, [message, sessionId]);

  const handleReadAloud = useCallback(() => {
    if (!sessionId) return;
    startReadAloud({
      sessionId,
      messageId: message.id,
      text: getMessageMarkdown(message),
      historyIndex: message.historyIndex,
    });
  }, [message, sessionId]);

  const items = useMemo<ContextMenuItem[]>(() => {
    const list: ContextMenuItem[] = [];
    if (showSideChatActions && sessionId && sideChatAction.available) {
      if (sideChatAction.sideChat) {
        list.push({
          label: `Open Side Chat (${sideChatAction.sideChat.messageCount ?? 0})`,
          onClick: sideChatAction.handleClick,
        });
      } else if (sideChatAction.nativeReady) {
        list.push({
          label: sideChatAction.creating ? "Starting Side Chat..." : "Start Side Chat",
          onClick: sideChatAction.handleClick,
          disabled: sideChatAction.creating,
        });
      } else {
        list.push({
          label: sideChatAction.unavailableDetail ?? sideChatAction.nativeReason,
          onClick: () => {},
          disabled: true,
        });
        if (sideChatAction.preflight?.fallback.available) {
          list.push({
            label: sideChatAction.fallbackConfirming ? "Confirm replay Side Chat" : "Replay Side Chat",
            onClick: sideChatAction.handleFallbackClick,
            disabled: sideChatAction.creating,
          });
        }
      }
    }
    if (sessionId) {
      list.push(
        reading
          ? { label: "Stop reading aloud", onClick: stopReadAloud }
          : { label: "Read aloud", onClick: handleReadAloud },
      );
      list.push({ label: "Reply to this message", onClick: handleReply });
    }
    if (starAction.actionable) list.push({ label: starAction.label, onClick: starAction.toggleStarred });
    const copyItems: ContextMenuItem[] = [
      { label: "Markdown", onClick: handleCopyMarkdown },
      { label: "Rich Text", onClick: handleCopyRichText },
      { label: "Plain Text", onClick: handleCopyPlainText },
    ];
    // Rich Text carries Takode's layout, which Slack flattens (tables) or drops (headings); this copy keeps
    // every format Slack has.
    copyItems.splice(1, 0, { label: "For Slack", onClick: handleCopyForSlack });
    if (sessionId) copyItems.push({ label: "Message link", onClick: handleCopyLink });
    list.push({ label: "Copy", onClick: () => {}, children: copyItems });
    return list;
  }, [
    handleCopyForSlack,
    handleCopyLink,
    handleCopyMarkdown,
    handleCopyPlainText,
    handleCopyRichText,
    handleReadAloud,
    handleReply,
    reading,
    sessionId,
    showSideChatActions,
    sideChatAction,
    starAction,
  ]);

  return (
    <>
      {/* Raised above the text it floats in: that text's wrapper is positioned for the corner
          time, and a positioned box paints, and takes clicks, over a plain float. On a one-line
          message the time itself sits under the button. */}
      <span
        className={`relative z-20 float-right mb-0.5 ml-1 inline-flex opacity-100 transition-opacity ${
          readAloud?.status === "error"
            ? ""
            : "sm:opacity-0 sm:group-hover/msg:opacity-100 sm:group-focus-within/msg:opacity-100"
        }`}
        data-message-action-menu-placement="first-line"
        data-message-action-menu-row
      >
        <MessageTimestampMenuTrigger
          timestamp={message.timestamp}
          testId="message-time-assistant-menu"
          onClick={toggle}
          className="inline-flex h-6 w-6 touch-manipulation items-center justify-center rounded-md border border-cc-border bg-cc-card/80 text-cc-muted shadow-sm transition-colors hover:bg-cc-hover hover:text-cc-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/40"
          title="Message options"
          ariaLabel="Message options"
        >
          {copied ? (
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-3.5 w-3.5 text-cc-success"
            >
              <path d="M3 8.5l3.5 3.5 6.5-8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <circle cx="3" cy="8" r="1.5" />
              <circle cx="8" cy="8" r="1.5" />
              <circle cx="13" cy="8" r="1.5" />
            </svg>
          )}
        </MessageTimestampMenuTrigger>
        {readAloud?.status === "error" && (
          <button
            type="button"
            role="alert"
            onClick={stopReadAloud}
            className="absolute right-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-cc-error/40 bg-cc-card px-2.5 py-1.5 text-left text-xs text-cc-error shadow-md"
          >
            {readAloud.error}
          </button>
        )}
      </span>
      {menu && (
        <ContextMenu
          {...menu}
          items={items}
          onClose={close}
          footer={
            <MessageTimeMenuMetadata timestamp={message.timestamp} testId="message-time-assistant-menu-metadata" />
          }
          widthClassName="w-[248px] max-w-[calc(100vw-1rem)]"
        />
      )}
    </>
  );
}
