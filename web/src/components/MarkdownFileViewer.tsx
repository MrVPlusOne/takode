import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { readFileLinkText, type FileLinkActionTarget } from "../api/file-link-actions.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";
import { SECONDARY_VIEWER_LAYER_CLASS, useSecondaryViewTarget } from "../utils/secondary-view.js";

/**
 * Open viewers, bottom first. They live outside the link that opened them, so a viewer stays open
 * when that link unmounts: a notification popover closing, or the feed moving its window.
 */
const useViewerStack = create<{ stack: FileLinkActionTarget[] }>(() => ({ stack: [] }));

/** Whether a linked file is Markdown, which Takode shows itself instead of handing it to an editor. */
export function isMarkdownFilePath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * Show a linked Markdown file inside Takode, above anything already open. The file is read on the
 * machine that holds the linking session's files, so this works on a phone and for files on
 * another machine, where a local editor cannot reach them.
 */
export function openMarkdownFileViewer(target: FileLinkActionTarget): void {
  useViewerStack.setState((state) => ({ stack: [...state.stack, target] }));
}

/** Renders the open Markdown file viewers; mount once at the app root. */
export function MarkdownFileViewerHost() {
  const stack = useViewerStack((state) => state.stack);
  return stack.map((target, index) => (
    <MarkdownFileViewer
      // The stack only grows and shrinks at its end, so a position names one viewer for its lifetime.
      key={index}
      target={target}
      isTop={index === stack.length - 1}
      onClose={() => useViewerStack.setState((state) => ({ stack: state.stack.slice(0, index) }))}
    />
  ));
}

type ViewerContent =
  | { status: "loading" }
  | { status: "loaded"; absolutePath: string; content: string }
  | { status: "error"; message: string };

function MarkdownFileViewer({
  target,
  isTop,
  onClose,
}: {
  target: FileLinkActionTarget;
  isTop: boolean;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [file, setFile] = useState<ViewerContent>({ status: "loading" });
  usePreviewSheetHistoryEntry(true, sheetRef, onClose);
  // Wide screens show the file in the secondary view, over the app's right side.
  const dockTarget = useSecondaryViewTarget(true, onClose, "reading");
  const docked = dockTarget !== null;

  useEffect(() => {
    const controller = new AbortController();
    readFileLinkText(target, controller.signal)
      .then((result) => setFile({ status: "loaded", ...result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setFile({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [target]);

  useEffect(() => {
    if (!isTop) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isTop, onClose]);

  useEffect(() => {
    if (docked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [docked]);

  const path = file.status === "loaded" ? file.absolutePath : target.path;
  const name = path.split(/[\\/]/).pop() || path;
  const closeAll = () => useViewerStack.setState({ stack: [] });

  return createPortal(
    <div
      className={
        docked
          ? SECONDARY_VIEWER_LAYER_CLASS
          : "fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 sm:px-6"
      }
      onClick={(event) => {
        // Portal clicks still bubble through React to the link's own ancestors, such as a message row.
        event.stopPropagation();
        if (!docked) onClose();
      }}
      data-testid="markdown-file-viewer-backdrop"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal={docked ? undefined : "true"}
        aria-label={name}
        className={
          docked
            ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-cc-bg"
            : "flex h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-cc-border bg-cc-bg shadow-2xl sm:h-[calc(100dvh-3rem)]"
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-3 border-b border-cc-border bg-cc-card px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-cc-fg">{name}</div>
            <div className="break-all text-xs text-cc-muted">{path}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg transition-colors cursor-pointer"
            aria-label="Close file"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {file.status === "loading" && <div className="text-sm text-cc-muted">Loading…</div>}
          {file.status === "error" && (
            <div className="text-sm text-cc-error" role="alert">
              Cannot open this file: {file.message}
            </div>
          )}
          {file.status === "loaded" && (
            <MarkdownContent
              text={file.content}
              // Links in the file resolve beside it, on the same machine as the file itself.
              sessionId={target.sessionId}
              fileBasePath={file.absolutePath}
              wrapLongContent
              onSessionNavigate={closeAll}
              questLinkSurface="chat-feed"
            />
          )}
        </div>
      </div>
    </div>,
    dockTarget ?? document.body,
  );
}
