import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ARTIFACT_KIND_LABELS, shortArtifactId, type ArtifactDetail } from "../../shared/artifact-library.js";
import { artifactApi } from "../api/artifacts.js";
import { openLibraryArtifact } from "../utils/library-nav.js";
import { LibraryIcon } from "./ArtifactInline.js";
import { useHoverCardsSuppressed } from "./hover-card-suppression-context.js";
import { ArtifactThumbnail } from "./library/ArtifactThumbnail.js";

/** Artifacts already looked up for link previews, by the ID in the link. */
const previews = new Map<string, Promise<ArtifactDetail | null>>();

function loadPreview(id: string): Promise<ArtifactDetail | null> {
  let preview = previews.get(id);
  if (!preview) {
    preview = artifactApi.get(id).catch((error: Error) => {
      console.warn(`[library] Artifact link preview failed for ${id}:`, error.message);
      previews.delete(id);
      return null;
    });
    previews.set(id, preview);
  }
  return preview;
}

/**
 * Inline link for `artifact:<id>` and `artifact:<id>:v<n>` hrefs: a small Library marker sets it
 * apart from web links. A mouse hovering it shows a card with the artifact's thumbnail, kind and
 * versions; clicking or tapping opens it in the Library, at the linked version.
 */
export function ArtifactInlineLink({
  target,
  children,
  className,
  stopPropagation = false,
}: {
  target: { id: string; version?: number };
  children: ReactNode;
  className?: string;
  stopPropagation?: boolean;
}) {
  const suppressed = useHoverCardsSuppressed();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (hideTimer.current && clearTimeout(hideTimer.current)), []);
  const keepOpen = () => hideTimer.current && clearTimeout(hideTimer.current);
  const closeSoon = () => {
    keepOpen();
    hideTimer.current = setTimeout(() => setAnchor(null), 120);
  };
  return (
    <>
      <a
        href="#/library"
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          setAnchor(null);
          openLibraryArtifact(target.id, target.version);
        }}
        onPointerEnter={(event) => {
          // Only a mouse hovers; a tap opens the Library straight away.
          if (suppressed || event.pointerType !== "mouse") return;
          keepOpen();
          setAnchor(event.currentTarget.getBoundingClientRect());
        }}
        onPointerLeave={(event) => event.pointerType === "mouse" && closeSoon()}
        className={className ?? "text-cc-primary hover:underline"}
        data-testid="artifact-inline-link"
      >
        <LibraryIcon className="mr-[0.2em] inline-block h-[0.95em] w-[0.95em] align-[-0.12em]" />
        {children}
      </a>
      {anchor && (
        <ArtifactLinkCard target={target} anchor={anchor} onEnter={keepOpen} onLeave={() => setAnchor(null)} />
      )}
    </>
  );
}

function ArtifactLinkCard({
  target,
  anchor,
  onEnter,
  onLeave,
}: {
  target: { id: string; version?: number };
  anchor: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [detail, setDetail] = useState<ArtifactDetail | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void loadPreview(target.id).then((next) => !cancelled && setDetail(next));
    return () => {
      cancelled = true;
    };
  }, [target.id]);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) card.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    if (rect.bottom > window.innerHeight - 8) card.style.top = `${Math.max(8, anchor.top - rect.height - 4)}px`;
  }, [anchor, detail]);
  return createPortal(
    <div
      ref={cardRef}
      className="fixed z-50 w-[280px] overflow-hidden rounded-xl border border-cc-border bg-cc-card p-2 shadow-xl"
      style={{ left: anchor.left, top: anchor.bottom + 4 }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      data-testid="artifact-link-card"
    >
      {detail === undefined ? (
        <div className="px-1 py-3 text-[12px] text-cc-muted">Loading…</div>
      ) : detail === null ? (
        <div className="px-1 py-3 text-[12px] text-cc-muted">Artifact {target.id} not found.</div>
      ) : (
        <>
          <ArtifactThumbnail artifact={detail} className="aspect-[16/10] w-full" />
          <div className="px-0.5 pt-1.5">
            <div className="line-clamp-2 text-[13.5px] leading-snug text-cc-fg">{detail.title}</div>
            <div className="mt-0.5 text-[12px] text-cc-muted">
              {ARTIFACT_KIND_LABELS[detail.kind]}
              {target.version
                ? ` · version ${target.version} of ${detail.versionCount}`
                : detail.versionCount > 1
                  ? ` · ${detail.versionCount} versions`
                  : ""}
              {` · ${shortArtifactId(detail.id)}`}
            </div>
          </div>
        </>
      )}
    </div>,
    document.body,
  );
}
