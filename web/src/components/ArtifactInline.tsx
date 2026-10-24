import { useEffect, useState, type ReactNode } from "react";
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
export type RenderMarkdown = (text: string) => ReactNode;

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
          <span className="text-cc-fg">{marker.title}</span> · version {marker.version} of {marker.versionCount},
          replaced by a newer version
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
    case "report":
    case "review":
    case "table":
      return <div>{renderMarkdown(content.markdown)}</div>;
    case "visual":
      return <VisualBlock source={content.source} />;
    case "figure":
      return content.fileUrl ? (
        <img src={content.fileUrl} alt="" className="max-h-[70vh] max-w-full rounded-lg border border-cc-border" />
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

/**
 * The quiet line under an answer or report that saved an artifact. Posts always get it, since a
 * post is what people come back for; other kinds only once they have more than one version, so
 * answers with figures don't all grow a line.
 */
export function ArtifactSavedLine({ markers }: { markers: readonly ArtifactMessageMarker[] | undefined }) {
  const shown = (markers ?? []).filter((marker) => marker.kind === "post" || marker.versionCount > 1);
  if (shown.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col gap-0.5" data-copy-exclude="" data-testid="artifact-saved-line">
      {shown.map((marker) => (
        <div key={marker.id} className="flex items-center gap-2 text-[12px] text-cc-muted">
          <LibraryIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            Saved in Library as <span className="text-cc-fg">{marker.title}</span>
            {marker.versionCount > 1 ? `, version ${marker.version} of ${marker.versionCount}` : ""}
          </span>
          <button
            type="button"
            onClick={() => openLibraryArtifact(marker.id, marker.version)}
            className="ml-auto shrink-0 text-cc-primary hover:underline pointer-coarse:min-h-8"
          >
            {marker.versionCount > 1 ? "Versions ›" : "Open ›"}
          </button>
        </div>
      ))}
    </div>
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
