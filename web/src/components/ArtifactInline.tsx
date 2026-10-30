import { GuidedReviewCard } from "./GuidedReviewCard.js";
import { Lightbox } from "./Lightbox.js";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ARTIFACT_KIND_LABELS,
  type ArtifactMessageMarker,
  type ArtifactVersionContent,
} from "../../shared/artifact-library.js";
import { postDestination, type GroupedDraftPost, type PostPartChanges } from "../../shared/draft-posts.js";
import { artifactApi } from "../api/artifacts.js";
import { openLibraryArtifact } from "../utils/library-nav.js";
import { newWindowClickLabel, openArtifactWindow } from "../utils/artifact-window.js";
import { canOpenInSide, openArtifact, openArtifactInSide } from "../utils/side-column.js";
import type { ContextMenuItem } from "./ContextMenu.js";
import {
  DraftPostCard,
  feedPostParts,
  postPartsOf,
  removedPartLabels,
  useVersionContent,
  type AttachmentRendering,
} from "./DraftPostCard.js";
import { VisualBlock } from "./VisualBlock.js";
import { writeClipboardText } from "../utils/copy-utils.js";
import { isSlideDeck } from "../../shared/slides.js";
import { SlideDeckCard } from "./slides/SlideDeckCard.js";

/** Renders Markdown with the caller's settings; passed in so these components don't import MarkdownContent. */
/** Renders a version's Markdown; a report passes its file's path so its relative file links resolve. */
export type RenderMarkdown = (text: string, options?: { fileBasePath?: string }) => ReactNode;

/**
 * A version a newer one replaced, collapsed to one line in the conversation. Its content was not
 * sent with the message; Show fetches it from the library.
 */
export function CollapsedArtifact({
  marker,
  renderMarkdown,
}: {
  marker: ArtifactMessageMarker;
  renderMarkdown: RenderMarkdown;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="my-2 rounded-xl border border-dashed border-cc-border"
      data-artifact-collapsed=""
      data-copy-exclude=""
    >
      <div className="flex min-h-9 items-center gap-2 px-3 py-1.5 text-[13px] text-cc-muted">
        <LibraryIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="text-cc-fg">{marker.title}</span> ·{" "}
          {marker.repeated
            ? `version ${marker.version}, sent again later`
            : `version ${marker.version} of ${marker.versionCount}, revised later`}
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 rounded-md px-2 py-1 text-cc-primary hover:bg-cc-hover pointer-coarse:min-h-9"
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <div className="border-t border-cc-border px-3 py-2">
          <ArtifactVersionLoader
            id={marker.id}
            version={marker.version}
            title={marker.title}
            renderMarkdown={renderMarkdown}
          />
          <button
            type="button"
            onClick={(event) => openArtifact({ id: marker.id, version: marker.version, title: marker.title }, event)}
            className="mt-1 text-[12px] text-cc-primary hover:underline"
          >
            All versions in Library ›
          </button>
        </div>
      )}
    </div>
  );
}

/** Loads and shows one saved version. */
export function ArtifactVersionLoader({
  id,
  version,
  title,
  changes,
  onlyParts,
  renderMarkdown,
  copied,
  onCopied,
}: {
  id: string;
  version: number;
  /** The artifact's title, shown on a post's card. */
  title?: string;
  /** For a post: how this version's parts changed from the one before, to mark them. */
  changes?: PostPartChanges;
  /** For a post, show only these messages (0-based), such as a part a later version removed. */
  onlyParts?: readonly number[];
  renderMarkdown: RenderMarkdown;
  /** For a post: the parts the user copied, and how to record a copy. */
  copied?: readonly number[];
  onCopied?: (parts: number[]) => void;
}) {
  const [state, setState] = useState<{
    content?: ArtifactVersionContent;
    error?: string;
  }>({});
  useEffect(() => {
    let cancelled = false;
    setState({});
    artifactApi
      .versionContent(id, version)
      .then((content) => !cancelled && setState({ content }))
      .catch((error: Error) => !cancelled && setState({ error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [id, version]);
  if (state.error) return <p className="py-1 text-[13px] text-cc-muted">{state.error}.</p>;
  if (!state.content) return <p className="py-1 text-[13px] text-cc-muted">Loading…</p>;
  return (
    <ArtifactVersionContentView
      content={state.content}
      title={title}
      changes={changes}
      onlyParts={onlyParts}
      renderMarkdown={renderMarkdown}
      removedFrom={{ id, version }}
      copied={copied}
      onCopied={onCopied}
    />
  );
}

/** A version's content as the user saw it: posts as draft cards, reports as Markdown, visuals, figures. */
export function ArtifactVersionContentView({
  content,
  title,
  changes,
  onlyParts,
  removedFrom,
  renderMarkdown,
  copied,
  onCopied,
}: {
  content: ArtifactVersionContent;
  title?: string;
  changes?: PostPartChanges;
  onlyParts?: readonly number[];
  /** The version shown, whose predecessor holds the parts it removed. */
  removedFrom?: { id: string; version: number };
  renderMarkdown: RenderMarkdown;
  copied?: readonly number[];
  onCopied?: (parts: number[]) => void;
}) {
  switch (content.kind) {
    case "post":
      return (
        <div>
          <DraftPostCard
            title={title}
            destination={content.destination}
            parts={postPartsOf(content, changes).filter((_, index) => !onlyParts || onlyParts.includes(index))}
            removed={
              onlyParts || !removedFrom
                ? []
                : removedPartLabels(changes).map(({ index, label }) => ({
                    label,
                    open: () => (
                      <ArtifactVersionLoader
                        id={removedFrom.id}
                        version={removedFrom.version - 1}
                        title={title}
                        onlyParts={[index]}
                        renderMarkdown={renderMarkdown}
                      />
                    ),
                  }))
            }
            renderMarkdown={(text) => renderMarkdown(text)}
            attachments={LIBRARY_ATTACHMENTS}
            copied={copied}
            onCopied={onCopied}
          />
          {!onlyParts && content.figureIds.length > 0 && (
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {content.figureIds.map((figureId) => (
                <FigureImage key={figureId} id={figureId} />
              ))}
            </div>
          )}
        </div>
      );
    case "review":
      // The same card the chat shows, opening the walkthrough; the Markdown when the message is gone.
      if (content.review) return <GuidedReviewCard target={content.review} />;
      return <div>{renderMarkdown(content.markdown)}</div>;
    case "report":
      if (isSlideDeck(content.markdown)) {
        return (
          <LibraryDeck
            title={title ?? ""}
            markdown={content.markdown}
            sourcePath={content.sourcePath}
            renderMarkdown={renderMarkdown}
          />
        );
      }
      return <div>{renderMarkdown(content.markdown, { fileBasePath: content.sourcePath })}</div>;
    case "table":
      return <div>{renderMarkdown(content.markdown)}</div>;
    case "visual":
      return <VisualBlock source={content.source} />;
    case "figure":
      return content.fileUrl ? (
        <ZoomableFigure src={content.fileUrl} />
      ) : (
        <p className="py-1 text-[13px] text-cc-muted">Only the newest version of a figure is kept.</p>
      );
  }
}

/** A deck in the Library or an artifact window, under the viewer's own title. */
function LibraryDeck({
  title,
  markdown,
  sourcePath,
  renderMarkdown,
}: {
  title: string;
  markdown: string;
  sourcePath?: string;
  renderMarkdown: RenderMarkdown;
}) {
  const render = useCallback(
    (slide: string) => renderMarkdown(slide, { fileBasePath: sourcePath }),
    [renderMarkdown, sourcePath],
  );
  return (
    <SlideDeckCard
      title={title}
      markdown={markdown}
      render={render}
      framed={false}
      menuItems={[{ label: "Copy Markdown", onClick: () => void writeClipboardText(markdown).catch(console.error) }]}
    />
  );
}

/** A figure's newest saved file; figures keep only their newest version. */
export function FigureImage({
  id,
  className = "",
  cover = false,
}: {
  id: string;
  className?: string;
  cover?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={`/api/artifacts/${encodeURIComponent(id)}/file`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`w-full rounded-lg border border-cc-border bg-cc-code-bg ${cover ? "object-cover" : "object-contain"} ${className}`}
    />
  );
}

/** The Library entries a message saved, for the cards that show them (drafts, reports). */
export const ArtifactMarkersContext = createContext<readonly ArtifactMessageMarker[] | undefined>(undefined);

/**
 * The marker of the post a draft card belongs to: by its title, or the message's only post when the
 * draft has none. Read-only views provide no markers, so their cards show no link.
 */
export function useDraftArtifactMarker(title: string | undefined): ArtifactMessageMarker | undefined {
  const posts = (useContext(ArtifactMarkersContext) ?? []).filter((marker) => marker.kind === "post");
  const named = title
    ? posts.find((marker) => marker.title.trim().toLowerCase() === title.trim().toLowerCase())
    : undefined;
  return named ?? (posts.length === 1 ? posts[0] : undefined);
}

/**
 * The More menu items opening a card's artifact elsewhere: in the Library at its version (named
 * when there are several), in the side column while a leader's conversation is on screen, and in a
 * window of its own.
 * Cards open full screen from their header; these are the less common places.
 */
export function libraryMenuItems(marker: ArtifactMessageMarker): ContextMenuItem[] {
  const target = { id: marker.id, version: marker.version, title: marker.title };
  return [
    {
      label:
        marker.versionCount > 1
          ? `Open version ${marker.version} of ${marker.versionCount} in Library`
          : "Open in Library",
      onClick: () => openLibraryArtifact(marker.id, marker.version),
    },
    ...(canOpenInSide() ? [{ label: "Open in side column", onClick: () => openArtifactInSide(target) }] : []),
    { label: `Open in new window (${newWindowClickLabel()})`, onClick: () => openArtifactWindow(target) },
  ];
}

/** Attachments of a saved version: the Library's copy of an image, else the file's name. */
const LIBRARY_ATTACHMENTS: AttachmentRendering = {
  render: (attachment) =>
    attachment.figureId ? (
      <ZoomableFigure src={`/api/artifacts/${encodeURIComponent(attachment.figureId)}/file`} thumbnail />
    ) : (
      <span className="text-[12px] text-cc-muted">{attachment.path.split("/").pop()}</span>
    ),
  copySource: (attachment) =>
    attachment.figureId ? `/api/artifacts/${encodeURIComponent(attachment.figureId)}/file` : null,
};

/**
 * A post's draft blocks in a conversation message, as one card. Its saved version (from the
 * message's Library markers) adds the version link, change marks and removed parts; a revision that
 * names its parts shows the whole saved version.
 */
export function FeedDraftPost({
  post,
  renderMarkdown,
  attachments,
}: {
  post: GroupedDraftPost;
  renderMarkdown: (text: string) => ReactNode;
  attachments: AttachmentRendering;
}) {
  const marker = useDraftArtifactMarker(post.title);
  const partial = post.blocks.some((block) => block.part);
  const saved = useVersionContent(marker, partial);
  const removed = marker
    ? removedPartLabels(marker.changes).map(({ index, label }) => ({
        label,
        open: () => (
          <ArtifactVersionLoader
            id={marker.id}
            version={marker.version - 1}
            title={marker.title}
            onlyParts={[index]}
            renderMarkdown={renderMarkdown}
          />
        ),
      }))
    : [];
  return (
    <DraftPostCard
      title={post.title}
      destination={
        postDestination(post.blocks) ?? (saved?.kind === "post" ? saved.destination : undefined) ?? marker?.destination
      }
      parts={feedPostParts(post.blocks, marker, saved)}
      removed={removed}
      menuItems={marker ? libraryMenuItems(marker) : []}
      renderMarkdown={renderMarkdown}
      attachments={attachments}
      copied={marker?.copied}
      // The server keeps what was copied and refreshes the markers, dimming the buttons everywhere.
      onCopied={
        marker
          ? (parts) => void artifactApi.markCopied(marker.id, marker.version, parts).catch(console.error)
          : undefined
      }
    />
  );
}

export function artifactKindLabel(kind: ArtifactMessageMarker["kind"]): string {
  return ARTIFACT_KIND_LABELS[kind];
}

export function LibraryIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
      <path d="M4 21V5" />
      <path d="M8 7h7" />
    </svg>
  );
}

export function StarIcon({ filled = false, className = "h-4 w-4" }: { filled?: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.7"
      className={className}
      aria-hidden="true"
    >
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" strokeLinejoin="round" />
    </svg>
  );
}

/** A figure shown large; tapping it opens the image viewer, as in chat. */
function ZoomableFigure({ src, thumbnail = false }: { src: string; thumbnail?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block max-w-full cursor-zoom-in"
        aria-label="Open the figure"
      >
        <img
          src={src}
          alt=""
          className={`${thumbnail ? "max-h-40" : "max-h-[70vh]"} max-w-full rounded-lg border border-cc-border`}
        />
      </button>
      {open && <Lightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}
