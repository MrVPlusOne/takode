import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTextSelection } from "../hooks/useTextSelection.js";
import {
  SECONDARY_VIEWER_LAYER_CLASS,
  isTopViewerLayer,
  useSecondaryViewAvailable,
  useSecondaryViewTarget,
  type SecondaryViewSize,
} from "../utils/secondary-view.js";
import { SelectionContextMenu } from "./SelectionContextMenu.js";
import { useConversationShown } from "./KeptConversationViews.js";

/**
 * An artifact opened from a button in its card's header, for reading something long without the
 * feed around it: reports, posts and visuals. Wide screens show it in the secondary view, the panel
 * that slides in from the right, whose left edge sets its width (and so a report's line length);
 * elsewhere, such as on phones, it covers the window. Escape or Close returns to the feed. With
 * `selection`, text selected inside gets the feed's selection menu (Comment, Copy), and comments
 * keep pointing at the conversation message the artifact belongs to.
 */
export function ArtifactPanel({
  title,
  size,
  fullScreenColumn = "",
  actions,
  selection,
  onClose,
  children,
}: {
  title: string;
  /** How wide the side panel grows for it, as for the other viewers there. */
  size: SecondaryViewSize;
  /** Classes bounding the content's column when it covers the window, such as `max-w-4xl`; in the
   *  side panel the content fills the width the user gives the panel. */
  fullScreenColumn?: string;
  /** Controls shown in the title bar, before Close. */
  actions?: ReactNode;
  /** The session and conversation message the content belongs to, for comments on selected text. */
  selection?: { sessionId: string; messageId: string };
  onClose: () => void;
  children: ReactNode;
}) {
  const layerRef = useRef<HTMLDivElement>(null);
  const dockTarget = useSecondaryViewTarget(true, onClose, size);
  const docked = dockTarget !== null;
  useEffect(() => {
    // A layer above handles its own Escape: a comment editor first, a viewer opened from a link
    // inside afterwards (its listener was added later), which may close itself before it renders.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (layerRef.current && !isTopViewerLayer(layerRef.current)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Portaled outside its conversation, so it must leave when a kept conversation is hidden.
  const conversationShown = useConversationShown();
  if (!conversationShown) return null;
  const content = <div className={docked ? "" : `mx-auto ${fullScreenColumn}`}>{children}</div>;
  return createPortal(
    <div
      ref={layerRef}
      className={docked ? SECONDARY_VIEWER_LAYER_CLASS : "fixed inset-0 z-50 flex flex-col bg-cc-bg"}
      role="dialog"
      aria-modal={docked ? undefined : "true"}
      aria-label={title}
      data-testid="artifact-panel"
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
            {content}
          </SelectableMessage>
        ) : (
          content
        )}
      </div>
    </div>,
    dockTarget ?? document.body,
  );
}

/**
 * The button in a card's header that opens it in an `ArtifactPanel`: a side-panel icon where the
 * panel slides in from the right, a full-screen one where it covers the window.
 */
export function ArtifactPanelButton({ onClick }: { onClick: () => void }) {
  const inPanel = useSecondaryViewAvailable();
  const label = inPanel ? "Open in panel" : "Full screen";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:h-8 pointer-coarse:w-8"
      data-testid="artifact-panel-button"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-3.5 w-3.5"
        aria-hidden="true"
      >
        {inPanel ? (
          <>
            <rect x="2" y="2.75" width="12" height="10.5" rx="1.5" />
            <path d="M9.5 2.75v10.5" />
          </>
        ) : (
          <path d="M6 2H3.5A1.5 1.5 0 002 3.5V6M10 2h2.5A1.5 1.5 0 0114 3.5V6M14 10v2.5A1.5 1.5 0 0112.5 14H10M6 14H3.5A1.5 1.5 0 012 12.5V10" />
        )}
      </svg>
    </button>
  );
}

/**
 * Content standing in for its conversation message: the selection menu and comment capture find the
 * message by these attributes, as they do in the feed.
 */
export function SelectableMessage({
  sessionId,
  messageId,
  className,
  children,
}: {
  sessionId: string;
  messageId: string;
  className?: string;
  children: ReactNode;
}) {
  // The selection hook reads its container while rendering, so the node is kept in state: the
  // render after it mounts starts listening.
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const root = useMemo(() => ({ current: node }), [node]);
  const selection = useTextSelection(root);
  return (
    <div ref={setNode} className={className} data-message-id={messageId} data-message-role="assistant">
      {children}
      <SelectionContextMenu selection={selection} sessionId={sessionId} onClose={selection.dismiss} />
    </div>
  );
}
