import { GuidedReviewCard } from "./GuidedReviewCard.js";
import { Lightbox } from "./Lightbox.js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  ARTIFACT_KIND_LABELS,
  type ArtifactMessageMarker,
  type ArtifactVersionContent,
} from "../../shared/artifact-library.js";
import { artifactApi } from "../api/artifacts.js";
import { openLibraryArtifact } from "../utils/library-nav.js";
import { MarkdownDraftCard } from "./MarkdownDraftCard.js";
import { VisualBlock } from "./VisualBlock.js";

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
            onlyParts={marker.parts}
            renderMarkdown={renderMarkdown}
          />
          <button
            type="button"
            onClick={() => openLibraryArtifact(marker.id, marker.version)}
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
  onlyParts,
  renderMarkdown,
}: {
  id: string;
  version: number;
  /** For a post, show only these messages (0-based): the ones a newer version replaced. */
  onlyParts?: readonly number[];
  renderMarkdown: RenderMarkdown;
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
  const content =
    onlyParts && state.content.kind === "post"
      ? { ...state.content, parts: state.content.parts.filter((_, index) => onlyParts.includes(index)), figureIds: [] }
      : state.content;
  return <ArtifactVersionContentView content={content} renderMarkdown={renderMarkdown} />;
}

/** A version's content as the user saw it: posts as draft cards, reports as Markdown, visuals, figures. */
export function ArtifactVersionContentView({
  content,
  renderMarkdown,
}: {
  content: ArtifactVersionContent;
  renderMarkdown: RenderMarkdown;
}) {
  switch (content.kind) {
    case "post":
      return (
        <div>
          {content.parts.map((part, index) => (
            <MarkdownDraftCard
              key={index}
              label={content.parts.length > 1 ? `Part ${index + 1} of ${content.parts.length}` : undefined}
            >
              {renderMarkdown(part)}
            </MarkdownDraftCard>
          ))}
          {content.figureIds.length > 0 && (
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
 * The small Library link inside a card header: the version and its versions when there are
 * several, the Library entry otherwise. It replaces the line that sat under each saved artifact.
 */
export function ArtifactCardLink({ marker }: { marker: ArtifactMessageMarker }) {
  const several = marker.versionCount > 1;
  const label = several ? `Version ${marker.version} of ${marker.versionCount} in Library` : "Open in Library";
  return (
    <button
      type="button"
      onClick={() => openLibraryArtifact(marker.id, marker.version)}
      aria-label={label}
      title={label}
      className="inline-flex min-h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:min-h-8"
      data-testid="artifact-card-link"
    >
      <LibraryIcon className="h-3.5 w-3.5" />
      {several && <span>v{marker.version}</span>}
    </button>
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
function ZoomableFigure({ src }: { src: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block max-w-full cursor-zoom-in"
        aria-label="Open the figure"
      >
        <img src={src} alt="" className="max-h-[70vh] max-w-full rounded-lg border border-cc-border" />
      </button>
      {open && <Lightbox src={src} onClose={() => setOpen(false)} />}
    </>
  );
}
