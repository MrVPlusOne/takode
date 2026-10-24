import { useState } from "react";
import {
  ARTIFACT_KIND_LABELS,
  artifactThumbUrl,
  type ArtifactKind,
  type ArtifactSummary,
} from "../../../shared/artifact-library.js";
import { useStore } from "../../store.js";
import { StarIcon } from "../ArtifactInline.js";

/**
 * Gallery thumbnails. Figures and visuals show a small picture the server makes once per version
 * (its URL names the version, so the browser caches it for good); posts, reports, reviews and
 * tables show a miniature of their first lines, drawn from the excerpt that comes with the list,
 * so they cost no extra request.
 */
const MAX_THUMB_ATTEMPTS = 8;
const RETRY_MS = 2500;

export function ArtifactThumbnail({ artifact, className = "" }: { artifact: ArtifactSummary; className?: string }) {
  const dark = useStore((state) => state.darkMode);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const baseUrl = artifactThumbUrl(artifact, dark ? "dark" : "light");
  const url = baseUrl && attempt > 0 ? `${baseUrl}&try=${attempt}` : baseUrl;
  // A visual being drawn answers 202 (no picture yet): ask again shortly; anything else falls back to text.
  const onError = () => {
    if (!url || attempt >= MAX_THUMB_ATTEMPTS) return setFailed(true);
    void fetch(url, { method: "HEAD" })
      .then((response) => {
        if (response.ok && response.status !== 202) return setAttempt((value) => value + 1);
        if (response.status !== 202) return setFailed(true);
        setTimeout(() => setAttempt((value) => value + 1), RETRY_MS);
      })
      .catch(() => setFailed(true));
  };
  const frame = `relative flex items-center justify-center overflow-hidden rounded-xl border border-cc-border ${className}`;
  if (url && !failed) {
    return (
      <div className={`${frame} bg-cc-hover/50`} data-testid="artifact-thumbnail" data-thumb="picture">
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={onError}
          className="h-full w-full object-contain"
        />
      </div>
    );
  }
  return (
    <div className={`${frame} items-start justify-start bg-cc-card`} data-testid="artifact-thumbnail" data-thumb="text">
      <TextMiniature artifact={artifact} />
      {/* Fades the cut-off end of the miniature into the card. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-cc-card" />
    </div>
  );
}

function TextMiniature({ artifact }: { artifact: ArtifactSummary }) {
  const text = artifact.excerpt ?? artifact.preview;
  if (artifact.kind === "table") return <TableMiniature markdown={text} />;
  if (!text.trim()) return <KindGlyph kind={artifact.kind} />;
  const lines = text
    .split("\n")
    .filter((line) => line.trim())
    .slice(0, 12);
  return (
    <div className="w-full px-2.5 pt-2 text-left text-[10px] leading-[1.4] text-cc-fg/85" aria-hidden="true">
      {lines.map((line, index) => {
        const heading = /^#{1,6}\s+/.test(line);
        const bullet = /^\s*([-*+]|\d+\.)\s+/.test(line);
        const plain = stripMarkdown(line.replace(/^#{1,6}\s+/, "").replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        return (
          <div
            key={index}
            className={`${heading ? "mb-0.5 truncate text-[11px] font-semibold text-cc-fg" : "line-clamp-3 break-words"} ${bullet ? "pl-2" : ""}`}
          >
            {bullet ? "• " : ""}
            {plain}
          </div>
        );
      })}
    </div>
  );
}

function TableMiniature({ markdown }: { markdown: string }) {
  const rows = markdown
    .split("\n")
    .filter((line) => line.includes("|") && !/^\s*\|?\s*:?-{2,}/.test(line))
    .slice(0, 9)
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .slice(0, 4)
        .map((cell) => stripMarkdown(cell)),
    );
  if (rows.length === 0) return <KindGlyph kind="table" />;
  return (
    <table className="m-2 w-[calc(100%-1rem)] table-fixed border-collapse text-[9px] leading-tight" aria-hidden="true">
      <tbody>
        {rows.map((cells, rowIndex) => (
          <tr key={rowIndex} className={rowIndex === 0 ? "bg-cc-hover/70 font-semibold text-cc-fg" : "text-cc-fg/80"}>
            {cells.map((cell, cellIndex) => (
              <td key={cellIndex} className="truncate border border-cc-border/70 px-1 py-[2px]">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function stripMarkdown(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]|~~/g, "")
    .trim();
}

/** A gallery card: the thumbnail, the title, and kind (when kinds are mixed), version and date. */
export function ArtifactCard({
  artifact,
  showKind,
  showSpace,
  onOpen,
}: {
  artifact: ArtifactSummary;
  showKind: boolean;
  showSpace: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex min-w-0 flex-col gap-1.5 rounded-xl p-1 text-left hover:bg-cc-hover/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70"
      data-testid="library-artifact-card"
      data-kind={artifact.kind}
    >
      <ArtifactThumbnail artifact={artifact} className="aspect-[16/10] w-full" />
      <span className="min-w-0 px-0.5">
        <span className="line-clamp-2 text-[13.5px] leading-snug text-cc-fg">
          {artifact.title}
          {artifact.starred && <StarIcon filled className="ml-1 inline h-3 w-3 align-[-1px] text-cc-muted" />}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-cc-muted">
          {[
            showKind ? ARTIFACT_KIND_LABELS[artifact.kind] : null,
            artifact.versionCount > 1 ? `v${artifact.versionCount}` : null,
            showSpace ? artifact.space : null,
            formatWhen(artifact.updatedAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
    </button>
  );
}

function formatWhen(at: number): string {
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  return sameDay
    ? new Date(at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function KindGlyph({ kind, className = "h-7 w-7" }: { kind: ArtifactKind; className?: string }) {
  const paths: Record<ArtifactKind, string> = {
    post: "M4 5h16v11H9l-5 4z",
    report: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
    review: "M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
    visual: "M4 20V4 M4 20h16 M7 15l4-4 3 3 5-6",
    figure: "M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6",
    table: "M3 5h18v14H3z M3 10h18 M3 15h18 M9 5v14 M15 5v14",
  };
  return (
    <span className="flex h-full w-full items-center justify-center text-cc-muted" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className={className}
      >
        <path d={paths[kind]} />
      </svg>
    </span>
  );
}
