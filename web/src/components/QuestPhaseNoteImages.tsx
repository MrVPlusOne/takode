import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";

const SUPPORTED_IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "ico",
  "avif",
  "tif",
  "tiff",
  "heic",
  "heif",
]);

interface PhaseNoteImage {
  path: string;
  filename: string;
  url: string;
}

export function extractMentionedLocalImagePaths(text: string): PhaseNoteImage[] {
  const candidates: Array<{ index: number; path: string }> = [];
  const codeRanges: Array<{ start: number; end: number }> = [];
  const seen = new Set<string>();

  const addPath = (rawPath: string, index: number) => {
    const path = cleanCandidatePath(rawPath);
    if (!isSupportedAbsoluteImagePath(path) || seen.has(path)) return;

    seen.add(path);
    candidates.push({ index, path });
  };

  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const matchStart = match.index ?? 0;
    codeRanges.push({ start: matchStart, end: matchStart + match[0].length });
    addPath(match[1] ?? "", matchStart);
  }

  for (const match of text.matchAll(/\/[^\s`"'<>]+/g)) {
    const matchStart = match.index ?? 0;
    if (codeRanges.some((range) => matchStart >= range.start && matchStart < range.end)) continue;
    addPath(match[0], matchStart);
  }

  return candidates
    .sort((left, right) => left.index - right.index)
    .map(({ path }) => ({
      path,
      filename: filenameForPath(path),
      url: api.getFsImageUrl(path),
    }));
}

export function QuestPhaseNoteImages({ text }: { text: string }) {
  const images = useMemo(() => extractMentionedLocalImagePaths(text), [text]);
  const [loadedPaths, setLoadedPaths] = useState<Set<string>>(() => new Set());
  const [failedPaths, setFailedPaths] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  useEffect(() => {
    setLoadedPaths(new Set());
    setFailedPaths(new Set());
    setSelectedPath(null);
  }, [images]);

  if (images.length === 0) return null;

  const visibleImages = images.filter((image) => loadedPaths.has(image.path) && !failedPaths.has(image.path));
  const selectedIndex = selectedPath ? visibleImages.findIndex((image) => image.path === selectedPath) : -1;
  const selectedImage = selectedIndex >= 0 ? visibleImages[selectedIndex] : null;

  const markLoaded = (path: string) => {
    setLoadedPaths((current) => new Set(current).add(path));
  };

  const markFailed = (path: string) => {
    setFailedPaths((current) => new Set(current).add(path));
    setLoadedPaths((current) => {
      if (!current.has(path)) return current;
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  };

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2" data-testid="phase-note-image-thumbnails">
        {images
          .filter((image) => !failedPaths.has(image.path))
          .map((image) => {
            const loaded = loadedPaths.has(image.path);
            return (
              <button
                key={image.path}
                type="button"
                className={
                  loaded
                    ? "group max-w-[8rem] overflow-hidden rounded-md border border-cc-border bg-cc-code-bg/50 text-left transition-colors hover:border-cc-primary/60 hover:bg-cc-hover"
                    : "hidden"
                }
                onClick={() => setSelectedPath(image.path)}
                title={image.path}
                aria-label={`Open image ${image.filename}`}
                hidden={!loaded}
              >
                <img
                  src={image.url}
                  alt={image.filename}
                  className="h-16 w-28 object-cover"
                  onLoad={() => markLoaded(image.path)}
                  onError={() => markFailed(image.path)}
                  draggable={false}
                  data-testid="phase-note-image-thumbnail-image"
                />
                <span className="block truncate border-t border-cc-border/60 px-1.5 py-1 font-mono-code text-[10px] text-cc-muted group-hover:text-cc-fg">
                  {image.filename}
                </span>
              </button>
            );
          })}
      </div>
      {selectedImage && (
        <PhaseNoteImageModal
          images={visibleImages}
          selectedIndex={selectedIndex}
          onSelect={(image) => setSelectedPath(image.path)}
          onClose={() => setSelectedPath(null)}
        />
      )}
    </>
  );
}

function PhaseNoteImageModal({
  images,
  selectedIndex,
  onSelect,
  onClose,
}: {
  images: PhaseNoteImage[];
  selectedIndex: number;
  onSelect: (image: PhaseNoteImage) => void;
  onClose: () => void;
}) {
  const image = images[selectedIndex];
  const canNavigate = images.length > 1;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  if (!image) return null;

  const selectOffset = (offset: number) => {
    if (!canNavigate) return;
    const nextIndex = (selectedIndex + offset + images.length) % images.length;
    const nextImage = images[nextIndex];
    if (nextImage) onSelect(nextImage);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key === "ArrowLeft") selectOffset(-1);
    if (event.key === "ArrowRight") selectOffset(1);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-cc-bg/95"
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${image.filename}`}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid="phase-note-image-modal"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-cc-border px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-mono-code text-sm text-cc-fg" data-testid="phase-note-image-modal-filename">
              {image.filename}
            </div>
            <div className="mt-0.5 text-[11px] text-cc-muted">
              {selectedIndex + 1} / {images.length}
            </div>
          </div>
          <button
            type="button"
            className="rounded-md border border-cc-border px-2.5 py-1.5 text-xs text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg"
            onClick={onClose}
            aria-label="Close image preview"
          >
            Close
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-4">
          <button
            type="button"
            className="rounded-md border border-cc-border px-2.5 py-2 text-xs text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => selectOffset(-1)}
            disabled={!canNavigate}
            aria-label="Previous image"
          >
            Prev
          </button>
          <div className="flex min-h-0 min-w-0 justify-center">
            <img
              src={image.url}
              alt={image.filename}
              className="max-h-[calc(100vh-9rem)] max-w-full object-contain"
              draggable={false}
              data-testid="phase-note-image-modal-image"
            />
          </div>
          <button
            type="button"
            className="rounded-md border border-cc-border px-2.5 py-2 text-xs text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => selectOffset(1)}
            disabled={!canNavigate}
            aria-label="Next image"
          >
            Next
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function cleanCandidatePath(rawPath: string): string {
  let path = rawPath.trim();
  while (/[.,;:!?)}\]]$/.test(path)) {
    path = path.slice(0, -1);
  }
  return path;
}

function isSupportedAbsoluteImagePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension ? SUPPORTED_IMAGE_EXTENSIONS.has(extension) : false;
}

function filenameForPath(path: string): string {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}
