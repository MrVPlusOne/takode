import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ImagePreviewItem } from "./image-preview-utils.js";

interface ImagePreviewGroupProps {
  images: ImagePreviewItem[];
  className?: string;
  testId?: string;
}

export function ImagePreviewGroup({ images, className = "", testId = "image-preview-group" }: ImagePreviewGroupProps) {
  const stableImages = useMemo(() => images, [images]);
  const [loadedIds, setLoadedIds] = useState<Set<string>>(() => new Set());
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setLoadedIds(new Set());
    setFailedIds(new Set());
    setSelectedId(null);
  }, [stableImages]);

  const markLoaded = (id: string) => {
    setLoadedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const markFailed = (id: string) => {
    setFailedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
    setLoadedIds((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };

  if (stableImages.length === 0) return null;

  const visibleImages = stableImages.filter((image) => loadedIds.has(image.id) && !failedIds.has(image.id));
  const selectedIndex = selectedId ? visibleImages.findIndex((image) => image.id === selectedId) : -1;
  const selectedImage = selectedIndex >= 0 ? visibleImages[selectedIndex] : null;

  return (
    <>
      <div className="hidden" aria-hidden="true">
        {stableImages
          .filter((image) => !failedIds.has(image.id) && !loadedIds.has(image.id))
          .map((image) => (
            <img
              key={image.id}
              src={image.thumbnailUrl}
              alt=""
              onLoad={() => markLoaded(image.id)}
              onError={() => markFailed(image.id)}
              data-testid="image-preview-preload"
            />
          ))}
      </div>
      {visibleImages.length > 0 && (
        <div
          className={`mt-2 flex max-w-full gap-2 overflow-x-auto overflow-y-hidden pb-1 ${className}`}
          data-testid={testId}
        >
          {visibleImages.map((image) => (
            <button
              key={image.id}
              type="button"
              className="group h-16 w-24 shrink-0 overflow-hidden rounded-md border border-cc-border bg-cc-code-bg/50 transition-colors hover:border-cc-primary/60 hover:bg-cc-hover focus:outline-none focus:ring-2 focus:ring-cc-primary/40"
              onClick={() => setSelectedId(image.id)}
              title={image.title ?? image.filename}
              aria-label={`Open image ${image.filename}`}
            >
              <img
                src={image.thumbnailUrl}
                alt=""
                className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                draggable={false}
                loading="lazy"
                decoding="async"
                data-testid="image-preview-thumbnail-image"
              />
            </button>
          ))}
        </div>
      )}
      {selectedImage && (
        <ImagePreviewModal
          images={visibleImages}
          selectedIndex={selectedIndex}
          onSelect={(image) => setSelectedId(image.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

function ImagePreviewModal({
  images,
  selectedIndex,
  onSelect,
  onClose,
}: {
  images: ImagePreviewItem[];
  selectedIndex: number;
  onSelect: (image: ImagePreviewItem) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const image = images[selectedIndex];
  const canNavigate = images.length > 1;

  const selectOffset = useCallback(
    (offset: number) => {
      if (!canNavigate) return;
      const nextIndex = (selectedIndex + offset + images.length) % images.length;
      const nextImage = images[nextIndex];
      if (nextImage) onSelect(nextImage);
    },
    [canNavigate, images, onSelect, selectedIndex],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowLeft") selectOffset(-1);
      if (event.key === "ArrowRight") selectOffset(1);
    };
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [onClose, selectOffset]);

  if (!image) return null;

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-50 flex flex-col bg-cc-bg/95 text-cc-fg"
      role="dialog"
      aria-modal="true"
      aria-label={`Image preview: ${image.filename}`}
      tabIndex={-1}
      data-testid="image-preview-modal"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-[3.25rem] shrink-0 items-center justify-between gap-3 border-b border-cc-border bg-cc-card px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <IconButton label="Previous image" disabled={!canNavigate} onClick={() => selectOffset(-1)}>
              <path d="M10.5 3.5L6 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </IconButton>
            <IconButton label="Next image" disabled={!canNavigate} onClick={() => selectOffset(1)}>
              <path d="M5.5 3.5L10 8l-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </IconButton>
            <span className="shrink-0 font-mono-code text-xs text-cc-muted" data-testid="image-preview-modal-index">
              {selectedIndex + 1} / {images.length}
            </span>
            <span
              className="min-w-0 truncate font-mono-code text-sm text-cc-fg"
              data-testid="image-preview-modal-filename"
            >
              {image.filename}
            </span>
          </div>
          <IconButton label="Close image preview" onClick={onClose}>
            <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
          </IconButton>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3 sm:px-4 sm:py-4">
          <img
            src={image.fullUrl}
            alt={image.filename}
            className="max-h-full max-w-full object-contain"
            draggable={false}
            data-testid="image-preview-modal-image"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-cc-border text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus:outline-none focus:ring-2 focus:ring-cc-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      aria-label={label}
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4">
        {children}
      </svg>
    </button>
  );
}
