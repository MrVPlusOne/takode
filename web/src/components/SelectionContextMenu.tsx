import { captureAnnotationSource } from "./annotation-passages.js";
import { useMemo, useCallback } from "react";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { useStore } from "../store.js";
import { copyRichText, writeClipboardText } from "../utils/copy-utils.js";
import { htmlFragmentToMarkdown, htmlFragmentToRichText } from "../utils/html-to-markdown.js";
import { selectionCopyForSlack } from "../utils/slack-copy.js";
import type { TextSelectionState } from "../hooks/useTextSelection.js";
import { useLeaderTopicsOn } from "../utils/leader-topics.js";
import { openInSide, sideChatOrigin } from "../utils/side-column.js";
import { newSideChatDraftKey } from "./side-column/NewSideChat.js";
import { useComposerTarget } from "./composer-target.js";

interface SelectionContextMenuProps {
  selection: TextSelectionState;
  sessionId: string;
  onClose: () => void;
}

export function formatSelectedTextAsBlockquote(text: string): string | null {
  const selectedText = text.replace(/^[\r\n]+|[\r\n]+$/g, "");
  if (!selectedText.trim()) return null;

  return selectedText
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

/**
 * Floating context menu shown when the user selects text in an assistant message.
 * Offers a comment attachment editor and a "Copy" submenu
 * with four formats: rich text, for Slack, Markdown and plain text.
 */
export function SelectionContextMenu({ selection, sessionId, onClose }: SelectionContextMenuProps) {
  // The comment goes to the composer of the conversation the passage is in (main or side).
  const draftKey = useComposerTarget(sessionId);
  const handleComment = useCallback(() => {
    if (!selection.plainText.trim()) return;
    useStore.getState().setAnnotationEditor({
      sessionId,
      draftKey,
      annotation: {
        id: crypto.randomUUID(),
        selectedText: selection.plainText,
        comment: "",
        ...captureAnnotationSource(selection.range),
      },
      ...(selection.position ? { position: selection.position } : {}),
    });
    selection.clear();
    onClose();
  }, [selection, sessionId, draftKey, onClose]);

  const handleCopyRichText = useCallback(() => {
    if (!selection.range) return;
    try {
      const { html, plainText } = htmlFragmentToRichText(selection.range);
      copyRichText(html, plainText).catch((e) => console.error("Failed to copy rich text:", e));
    } catch (e) {
      // Range may have become stale if the DOM re-rendered since selection
      console.error("Selection range became invalid:", e);
    }
    onClose();
  }, [selection, onClose]);

  const handleCopyForSlack = useCallback(() => {
    if (!selection.range) return;
    try {
      selectionCopyForSlack(selection.range)
        .write()
        .catch((e) => console.error("Failed to copy for Slack:", e));
    } catch (e) {
      console.error("Selection range became invalid:", e);
    }
    onClose();
  }, [selection, onClose]);

  const handleCopyMarkdown = useCallback(() => {
    if (!selection.range) return;
    try {
      const markdown = htmlFragmentToMarkdown(selection.range);
      writeClipboardText(markdown).catch((e) => console.error("Failed to copy markdown:", e));
    } catch (e) {
      console.error("Selection range became invalid:", e);
    }
    onClose();
  }, [selection, onClose]);

  const handleCopyPlainText = useCallback(() => {
    writeClipboardText(selection.plainText).catch((e) => console.error("Failed to copy plain text:", e));
    onClose();
  }, [selection, onClose]);

  // A leader with topics on can take the passage to a side chat about it instead of this thread.
  const canStartThread = useLeaderTopicsOn(sessionId);
  const handleAskInSideChat = useCallback(() => {
    if (!selection.plainText.trim()) return;
    openInSide(sessionId, { kind: "new-chat", startedFrom: sideChatOrigin(sessionId) });
    const store = useStore.getState();
    const draftKey = newSideChatDraftKey(sessionId);
    const current = store.composerDrafts.get(draftKey);
    store.setComposerDraft(draftKey, {
      ...current,
      text: current?.text ?? "",
      images: current?.images ?? [],
      annotations: [
        ...(current?.annotations ?? []),
        {
          id: crypto.randomUUID(),
          selectedText: selection.plainText,
          comment: "",
          ...captureAnnotationSource(selection.range),
        },
      ],
    });
    selection.clear();
    onClose();
  }, [selection, sessionId, onClose]);

  const items = useMemo<ContextMenuItem[]>(
    () => [
      { label: "Comment", onClick: handleComment },
      ...(canStartThread ? [{ label: "Ask in side chat", onClick: handleAskInSideChat }] : []),
      {
        label: "Copy",
        onClick: () => {},
        children: [
          { label: "Rich text", onClick: handleCopyRichText },
          { label: "For Slack", onClick: handleCopyForSlack },
          { label: "Markdown", onClick: handleCopyMarkdown },
          { label: "Plain text", onClick: handleCopyPlainText },
        ],
      },
    ],
    [
      canStartThread,
      handleAskInSideChat,
      handleComment,
      handleCopyRichText,
      handleCopyForSlack,
      handleCopyMarkdown,
      handleCopyPlainText,
    ],
  );

  if (!selection.isActive || !selection.position) return null;

  return <ContextMenu x={selection.position.x} y={selection.position.y} items={items} onClose={onClose} />;
}
