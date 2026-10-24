import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { api, type EditorKind } from "../api.js";
import {
  FileLinkRequestError,
  buildFileLinkBrowserUrl,
  buildFileLinkImageVariantUrl,
  readFileLinkFolder,
  readFileLinkText,
  resolveFileLinkAction,
  type FileLinkActionTarget,
  type FileLinkFolderEntry,
} from "../api/file-link-actions.js";
import { useFileMachine } from "../remote-hosts.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";
import { SECONDARY_VIEWER_LAYER_CLASS, useSecondaryViewTarget } from "../utils/secondary-view.js";
import { backdropClickProps } from "../utils/backdrop-click.js";
import { highlightCode, inferLanguageFromPath, splitHighlightedHtmlByLine } from "../utils/syntax-highlighting.js";
import { editorOpenFor } from "../utils/editor-open.js";
import { isTouchDevice } from "../utils/mobile.js";
import { writeClipboardText } from "../utils/copy-utils.js";

/** A file or folder to show, with the lines a link points at. */
export interface FileViewerTarget extends FileLinkActionTarget {
  line?: number;
  endLine?: number;
}

/**
 * Open viewers, bottom first. They live outside the link that opened them, so a viewer stays open
 * when that link unmounts: a notification popover closing, or the feed moving its window.
 */
const useViewerStack = create<{ stack: FileViewerTarget[] }>(() => ({ stack: [] }));

/** Whether a linked file is Markdown, which the viewer renders rather than showing as text. */
export function isMarkdownFilePath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

/**
 * Show a linked file or folder inside Takode, above anything already open. It is read on the
 * machine that holds the linking session's files, so it works on a phone and for files on another
 * machine than the browser's, where a local editor cannot reach them.
 */
export function openFileViewer(target: FileViewerTarget): void {
  useViewerStack.setState((state) => ({ stack: [...state.stack, target] }));
}

/** Close every open file viewer, as following a session link from one does. */
export function closeFileViewers(): void {
  useViewerStack.setState({ stack: [] });
}

/** Renders the open file viewers; mount once at the app root. */
export function FileViewerHost() {
  const stack = useViewerStack((state) => state.stack);
  return stack.map((target, index) => (
    <FileViewer
      // The stack only grows and shrinks at its end, so a position names one viewer for its lifetime.
      key={index}
      target={target}
      isTop={index === stack.length - 1}
      onClose={() => useViewerStack.setState((state) => ({ stack: state.stack.slice(0, index) }))}
    />
  ));
}

/** Text files larger than this are shown without colours; highlighting them would stall the page. */
const MAX_HIGHLIGHT_BYTES = 200 * 1024;
/** Lines a text file shows at most. */
const MAX_TEXT_LINES = 20_000;

type ViewerContent =
  | { status: "loading" }
  | { status: "markdown"; absolutePath: string; content: string }
  | { status: "text"; absolutePath: string; content: string }
  | { status: "folder"; absolutePath: string; entries: FileLinkFolderEntry[]; truncated: boolean }
  | { status: "image"; absolutePath: string }
  | { status: "unsupported"; absolutePath: string; reason: string }
  | { status: "error"; message: string };

async function loadContent(
  target: FileViewerTarget,
  signal: AbortSignal,
  onMachine: (hostId: string | null) => void,
): Promise<ViewerContent> {
  const info = await resolveFileLinkAction(target);
  if (!signal.aborted) onMachine(info.hostId ?? null);
  if (!info.exists) return { status: "error", message: `Nothing at ${info.absolutePath}` };
  const absolutePath = info.absolutePath;
  if (info.isDirectory) {
    const folder = await readFileLinkFolder(target, signal);
    return { status: "folder", absolutePath, entries: folder.entries, truncated: folder.truncated };
  }
  if (info.isImage) return { status: "image", absolutePath };
  try {
    const file = await readFileLinkText(target, signal);
    return isMarkdownFilePath(file.absolutePath)
      ? { status: "markdown", ...file }
      : { status: "text", absolutePath: file.absolutePath, content: file.content };
  } catch (error) {
    if (!(error instanceof FileLinkRequestError)) throw error;
    if (error.status === 415) {
      return {
        status: "unsupported",
        absolutePath,
        reason: `Takode can't show this kind of file (${formatSize(info.size)}).`,
      };
    }
    if (error.status === 413) {
      return {
        status: "unsupported",
        absolutePath,
        reason: `This file is ${formatSize(info.size)}, too large to show here (up to 2 MB).`,
      };
    }
    throw error;
  }
}

function FileViewer({ target, isTop, onClose }: { target: FileViewerTarget; isTop: boolean; onClose: () => void }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [content, setContent] = useState<ViewerContent>({ status: "loading" });
  // The remote host holding the file, or null for the server's machine; undefined until resolved.
  const [hostId, setHostId] = useState<string | null | undefined>(undefined);
  usePreviewSheetHistoryEntry(true, sheetRef, onClose);
  // Wide screens show the file in the secondary view, over the app's right side; code needs the width.
  const dockTarget = useSecondaryViewTarget(true, onClose, content.status === "text" ? "wide" : "reading");
  const docked = dockTarget !== null;

  useEffect(() => {
    const controller = new AbortController();
    loadContent(target, controller.signal, setHostId)
      .then((loaded) => {
        if (!controller.signal.aborted) setContent(loaded);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setContent({ status: "error", message: error instanceof Error ? error.message : String(error) });
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

  const path = "absolutePath" in content ? content.absolutePath : target.path;
  const name =
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path;
  const backdropClick = backdropClickProps<HTMLDivElement>(() => {
    if (!docked) onClose();
  });
  const openEntry = (entry: FileLinkFolderEntry) =>
    openFileViewer({ path: entry.path, isRelative: false, sessionId: target.sessionId });

  return createPortal(
    <div
      className={
        docked
          ? SECONDARY_VIEWER_LAYER_CLASS
          : "fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-3 py-4 sm:px-6"
      }
      {...backdropClick}
      onClick={(event) => {
        // Portal clicks still bubble through React to the link's own ancestors, such as a message row.
        event.stopPropagation();
        backdropClick.onClick(event);
      }}
      data-testid="file-viewer-backdrop"
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
        <ViewerHeader name={name} path={path} content={content} hostId={hostId} line={target.line} onClose={onClose} />
        <div className={`min-h-0 flex-1 overflow-y-auto ${content.status === "text" ? "" : "px-4 py-3"}`}>
          {content.status === "loading" && <div className="text-sm text-cc-muted">Loading…</div>}
          {content.status === "error" && (
            <div className="text-sm text-cc-error" role="alert">
              Cannot open this: {content.message}
            </div>
          )}
          {content.status === "unsupported" && (
            <div className="space-y-1 text-sm text-cc-muted">
              <p>{content.reason}</p>
              <p>Copy its path, or open it in your editor if your editor can reach this machine.</p>
            </div>
          )}
          {content.status === "markdown" && (
            <MarkdownContent
              text={content.content}
              // Links in the file resolve beside it, on the same machine as the file itself.
              sessionId={target.sessionId}
              fileBasePath={content.absolutePath}
              wrapLongContent
              onSessionNavigate={closeFileViewers}
              questLinkSurface="chat-feed"
            />
          )}
          {content.status === "text" && (
            <TextFileView
              path={content.absolutePath}
              content={content.content}
              line={target.line}
              endLine={target.endLine}
            />
          )}
          {content.status === "image" && (
            <img
              src={buildFileLinkImageVariantUrl({ ...target, path: content.absolutePath, isRelative: false }, "full")}
              alt={name}
              className="mx-auto max-h-full max-w-full"
            />
          )}
          {content.status === "folder" && (
            <FolderView
              sessionId={target.sessionId}
              entries={content.entries}
              truncated={content.truncated}
              onOpen={openEntry}
            />
          )}
        </div>
      </div>
    </div>,
    dockTarget ?? document.body,
  );
}

/** Name, folder, the machine holding the file, and what else can be done with it. */
function ViewerHeader({
  name,
  path,
  content,
  hostId,
  line,
  onClose,
}: {
  name: string;
  path: string;
  content: ViewerContent;
  hostId: string | null | undefined;
  line?: number;
  onClose: () => void;
}) {
  const machine = useFileMachine(hostId);
  const editor = useEditorChoice();
  const [copied, setCopied] = useState(false);
  const loaded = content.status !== "loading" && content.status !== "error";
  const editorOpen = loaded && editor && !isTouchDevice() ? editorOpenFor(editor, machine) : { kind: "none" as const };
  const folder = path.replace(/[\\/][^\\/]*[\\/]?$/, "");
  return (
    <div className="flex items-start gap-3 border-b border-cc-border bg-cc-card px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-cc-fg">
          {name}
          {content.status === "folder" && "/"}
        </div>
        <div className="break-all text-xs text-cc-muted">
          {machine && <span className="text-cc-fg/80">{machine.name} · </span>}
          <span>{folder || path}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {editorOpen.kind !== "none" && (
          // Narrow screens are phones, where an editor link can't open.
          <span
            className="hidden sm:inline-flex"
            title={editorOpen.kind === "unavailable" ? editorOpen.reason : undefined}
          >
            <HeaderButton
              label={editorOpen.label}
              disabled={editorOpen.kind === "unavailable"}
              onClick={() => {
                if (editorOpen.kind !== "available") return;
                void editorOpen.open({
                  absolutePath: path,
                  ...(content.status === "folder" ? { targetKind: "directory" as const } : line ? { line } : {}),
                });
              }}
            />
          </span>
        )}
        {loaded && (
          <button
            type="button"
            onClick={() => {
              void writeClipboardText(path).then(() => setCopied(true));
            }}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg transition-colors cursor-pointer"
            aria-label={copied ? "Path copied" : "Copy path"}
            title={copied ? "Path copied" : "Copy path"}
          >
            {copied ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" className="h-4 w-4">
                <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                <path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />
              </svg>
            )}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg transition-colors cursor-pointer"
          aria-label="Close file"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}

function HeaderButton({
  label,
  disabled = false,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // aria-disabled rather than disabled, so the explaining tooltip still shows on hover.
      aria-disabled={disabled || undefined}
      className={`h-8 rounded-lg border border-cc-border px-2.5 text-xs transition-colors ${
        disabled ? "cursor-default text-cc-muted/60" : "cursor-pointer text-cc-fg hover:bg-cc-hover"
      }`}
    >
      {label}
    </button>
  );
}

/** The editor chosen in Settings, or null until it is known. */
function useEditorChoice(): EditorKind | null {
  const [editor, setEditor] = useState<EditorKind | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .getSettings()
      .then((settings) => !cancelled && setEditor(settings.editorConfig?.editor ?? "none"))
      .catch(() => !cancelled && setEditor("none"));
    return () => {
      cancelled = true;
    };
  }, []);
  return editor;
}

/** A text file with line numbers and colours, scrolled to the lines a link points at. */
function TextFileView({
  path,
  content,
  line,
  endLine,
}: {
  path: string;
  content: string;
  line?: number;
  endLine?: number;
}) {
  const targetRef = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => {
    const language = content.length <= MAX_HIGHLIGHT_BYTES ? inferLanguageFromPath(path) : null;
    const highlighted = language ? highlightCode(content, language) : null;
    const all = highlighted ? splitHighlightedHtmlByLine(highlighted) : content.split("\n").map(escapeHtml);
    return all.slice(0, MAX_TEXT_LINES);
  }, [content, path]);
  const total = content.split("\n").length;
  const first = line && line > 0 ? line : undefined;
  const last = first ? Math.max(first, endLine ?? first) : undefined;

  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (first) targetRef.current?.scrollIntoView?.({ block: "center" });
    // Logs are read from the end, where the latest lines are.
    else if (/\.log$/i.test(path)) endRef.current?.scrollIntoView?.({ block: "end" });
  }, [first, path]);

  return (
    <div className="min-w-0 overflow-x-auto bg-cc-code-bg py-2 font-mono-code text-[12px] leading-relaxed text-cc-code-fg sm:text-[13px]">
      <div className="min-w-max">
        {lines.map((html, index) => {
          const number = index + 1;
          const marked = first !== undefined && number >= first && number <= last!;
          return (
            <div
              key={number}
              ref={number === first ? targetRef : undefined}
              className={`flex ${marked ? "bg-cc-primary/15" : ""}`}
              data-line={number}
              data-marked={marked || undefined}
            >
              <span className="w-12 shrink-0 select-none pr-3 text-right text-cc-muted/70">{number}</span>
              <span className="whitespace-pre pr-4" dangerouslySetInnerHTML={{ __html: html || " " }} />
            </div>
          );
        })}
      </div>
      <div ref={endRef} />
      {total > MAX_TEXT_LINES && (
        <div className="px-4 pt-2 text-xs text-cc-muted">
          Showing the first {MAX_TEXT_LINES.toLocaleString()} of {total.toLocaleString()} lines.
        </div>
      )}
    </div>
  );
}

/** A folder's files and subfolders; opening one shows it in a viewer above this one. */
function FolderView({
  sessionId,
  entries,
  truncated,
  onOpen,
}: {
  sessionId?: string;
  entries: FileLinkFolderEntry[];
  truncated: boolean;
  onOpen: (entry: FileLinkFolderEntry) => void;
}) {
  if (!entries.length) return <div className="text-sm text-cc-muted">This folder is empty.</div>;
  return (
    <div>
      <ul className="-mx-2 divide-y divide-cc-border/60">
        {entries.map((entry) => {
          const row = (
            <>
              {!entry.isDirectory && isImagePath(entry.name) ? (
                <img
                  src={buildFileLinkImageVariantUrl({ path: entry.path, isRelative: false, sessionId }, "thumbnail")}
                  alt=""
                  loading="lazy"
                  className="h-8 w-8 shrink-0 rounded object-cover"
                />
              ) : (
                <EntryIcon folder={entry.isDirectory} />
              )}
              <span className="min-w-0 flex-1 truncate text-[14px] text-cc-fg">{entry.name}</span>
              <span className="shrink-0 text-[12px] tabular-nums text-cc-muted">
                {entry.isDirectory ? "" : formatSize(entry.size)}
              </span>
              <span className="hidden w-24 shrink-0 text-right text-[12px] text-cc-muted sm:block">
                {formatModified(entry.modifiedAt)}
              </span>
            </>
          );
          const rowClass = "flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-cc-hover";
          // HTML pages and PDFs open in a browser tab, as their links do.
          return (
            <li key={entry.path}>
              {!entry.isDirectory && opensInBrowserTab(entry.path) ? (
                <a
                  href={buildFileLinkBrowserUrl({ path: entry.path, isRelative: false, sessionId })}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={rowClass}
                >
                  {row}
                </a>
              ) : (
                <button type="button" className={rowClass} onClick={() => onOpen(entry)}>
                  {row}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {truncated && <div className="pt-2 text-xs text-cc-muted">Showing the first {entries.length} entries.</div>}
    </div>
  );
}

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(path);
}

/** Pages and documents the browser shows itself, in a new tab. */
export function opensInBrowserTab(path: string): boolean {
  return /\.(html|pdf)$/i.test(path);
}

function EntryIcon({ folder }: { folder: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
      className="h-4 w-8 shrink-0 text-cc-muted"
    >
      {folder ? (
        <path
          d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 1.5h4.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"
          strokeLinejoin="round"
        />
      ) : (
        <path d="M4 2h5l3 3v8.5a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5zM9 2v3h3" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatModified(modifiedAt: number): string {
  const date = new Date(modifiedAt);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
