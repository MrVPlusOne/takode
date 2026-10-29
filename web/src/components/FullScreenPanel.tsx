import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTextSelection } from "../hooks/useTextSelection.js";
import { SelectionContextMenu } from "./SelectionContextMenu.js";
import { useConversationShown } from "./KeptConversationViews.js";

/**
 * An artifact shown over the whole window, for reading something long without the feed around it:
 * reports, posts and visuals open here from a button in their card's header. Escape or Close returns
 * to the feed. With `selection`, text selected inside gets the feed's selection menu (Comment, Copy),
 * and comments keep pointing at the conversation message the artifact belongs to.
 */
export function FullScreenPanel({
  title,
  actions,
  selection,
  onClose,
  children,
}: {
  title: string;
  /** Controls shown in the title bar, before Close. */
  actions?: ReactNode;
  /** The session and conversation message the content belongs to, for comments on selected text. */
  selection?: { sessionId: string; messageId: string };
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    // A layer above (a comment editor, an image viewer) handles its own Escape first.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portaled outside its conversation, so it must leave when a kept conversation is hidden.
  const conversationShown = useConversationShown();
  if (!conversationShown) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-cc-bg"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="full-screen-panel"
    >
      <div className="flex items-center gap-2 border-b border-cc-border px-4 py-2" data-copy-exclude="">
        <span className="min-w-0 truncate text-[14px] font-medium text-cc-fg">{title}</span>
        <span className="group/code ml-auto flex shrink-0 items-center gap-1">
          {actions}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2.5 py-1 text-[13px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:min-h-9"
          >
            Close
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
        {selection ? (
          <SelectableMessage sessionId={selection.sessionId} messageId={selection.messageId}>
            {children}
          </SelectableMessage>
        ) : (
          children
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The button in a card's header that opens it full screen. */
export function FullScreenButton({ onClick, label = "Full screen" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:h-8 pointer-coarse:w-8"
      data-testid="full-screen-button"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        <path d="M6 2H3.5A1.5 1.5 0 002 3.5V6M10 2h2.5A1.5 1.5 0 0114 3.5V6M14 10v2.5A1.5 1.5 0 0112.5 14H10M6 14H3.5A1.5 1.5 0 012 12.5V10" />
      </svg>
    </button>
  );
}

/**
 * Content standing in for its conversation message: the selection menu and comment capture find the
 * message by these attributes, as they do in the feed.
 */
function SelectableMessage({
  sessionId,
  messageId,
  children,
}: {
  sessionId: string;
  messageId: string;
  children: ReactNode;
}) {
  // The selection hook reads its container while rendering, so the node is kept in state: the
  // render after it mounts starts listening.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const root = useMemo(() => ({ current: node }), [node]);
  const selection = useTextSelection(root);
  return (
    <div ref={setNode} data-message-id={messageId} data-message-role="assistant">
      {children}
      <SelectionContextMenu selection={selection} sessionId={sessionId} onClose={selection.dismiss} />
    </div>
  );
}
