import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ImagePreviewItem } from "./image-preview-utils.js";

interface ImagePreviewGroupProps {
  images: ImagePreviewItem[];
  className?: string;
  testId?: string;
  onOpenImage?: (image: ImagePreviewItem) => void;
  size?: "standard" | "small" | "message";
}

export function ImagePreviewGroup({
  images,
  className = "",
  testId = "image-preview-group",
  onOpenImage,
  size = "standard",
}: ImagePreviewGroupProps) {
  const [loadedUrls, setLoadedUrls] = useState<Map<string, string>>(() => new Map());
  const [failedUrls, setFailedUrls] = useState<Map<string, string>>(() => new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const isLoaded = (image: ImagePreviewItem) => loadedUrls.get(image.id) === image.thumbnailUrl;
  const isFailed = (image: ImagePreviewItem) => failedUrls.get(image.id) === image.thumbnailUrl;

  const markLoaded = (image: ImagePreviewItem) => {
    setLoadedUrls((current) => {
      if (current.get(image.id) === image.thumbnailUrl) return current;
      const next = new Map(current);
      next.set(image.id, image.thumbnailUrl);
      return next;
    });
    setFailedUrls((current) => {
      if (current.get(image.id) !== image.thumbnailUrl) return current;
      const next = new Map(current);
      next.delete(image.id);
      return next;
    });
  };

  const markFailed = (image: ImagePreviewItem) => {
    setFailedUrls((current) => {
      if (current.get(image.id) === image.thumbnailUrl) return current;
      const next = new Map(current);
      next.set(image.id, image.thumbnailUrl);
      return next;
    });
    setLoadedUrls((current) => {
      if (current.get(image.id) !== image.thumbnailUrl) return current;
      const next = new Map(current);
      next.delete(image.id);
      return next;
    });
  };

  const visibleImages = images.filter((image) => isLoaded(image) && !isFailed(image));
  const renderedImages = images.filter(
    (image) => !isFailed(image) && (isLoaded(image) || image.expectedAttachment === true),
  );
  const selectedIndex = selectedId ? visibleImages.findIndex((image) => image.id === selectedId) : -1;
  const selectedImage = selectedIndex >= 0 ? visibleImages[selectedIndex] : null;

  useEffect(() => {
    if (selectedId && selectedIndex < 0) setSelectedId(null);
  }, [selectedId, selectedIndex]);

  if (images.length === 0) return null;

  const openImage = (image: ImagePreviewItem) => {
    if (onOpenImage) onOpenImage(image);
    else setSelectedId(image.id);
  };
  const slotSizeClassName =
    size === "small" ? "h-12 w-12" : size === "message" ? "h-24 w-24 sm:h-28 sm:w-28" : "h-16 w-24";
  const imageFitClassName = size === "message" ? "object-contain" : "object-cover";

  return (
    <>
      <div className="hidden" aria-hidden="true">
        {images
          .filter((image) => image.thumbnailUrl && !image.expectedAttachment && !isFailed(image) && !isLoaded(image))
          .map((image) => (
            <img
              key={`${image.id}:${image.thumbnailUrl}`}
              src={image.thumbnailUrl}
              alt=""
              onLoad={() => markLoaded(image)}
              onError={() => markFailed(image)}
              data-testid="image-preview-preload"
            />
          ))}
      </div>
      {renderedImages.length > 0 && (
        <div
          className={`mt-2 flex max-w-full gap-2 overflow-x-auto overflow-y-hidden pb-1 ${className}`}
          data-testid={testId}
        >
          {renderedImages.map((image) => {
            const loaded = isLoaded(image);
            return (
              <button
                key={image.id}
                type="button"
                className={`group relative ${slotSizeClassName} shrink-0 overflow-hidden rounded-md border border-cc-border bg-cc-code-bg/50 transition-colors enabled:hover:border-cc-primary/60 enabled:hover:bg-cc-hover enabled:focus:outline-none enabled:focus:ring-2 enabled:focus:ring-cc-primary/40 disabled:cursor-default`}
                onClick={() => openImage(image)}
                title={image.title ?? image.filename}
                aria-label={loaded ? `Open image ${image.filename}` : `Loading image ${image.filename}`}
                aria-busy={loaded ? undefined : true}
                disabled={!loaded}
                data-image-preview-id={image.id}
              >
                {image.thumbnailUrl ? (
                  <img
                    src={image.thumbnailUrl}
                    alt=""
                    className={`h-full w-full ${imageFitClassName} transition-opacity ${
                      loaded ? "opacity-100 group-hover:opacity-90" : "opacity-0"
                    }`}
                    draggable={false}
                    loading="lazy"
                    decoding="async"
                    onLoad={() => markLoaded(image)}
                    onError={() => markFailed(image)}
                    data-testid="image-preview-thumbnail-image"
                  />
                ) : null}
                {!loaded && <ImageLoadingPlaceholder compact={size === "small"} />}
              </button>
            );
          })}
        </div>
      )}
      {selectedImage && !onOpenImage && (
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

function ImageLoadingPlaceholder({ compact }: { compact: boolean }) {
  return (
    <span
      className={`absolute inset-0 flex flex-col items-center justify-center bg-cc-code-bg/80 px-1 text-center leading-tight text-cc-muted ${
        compact ? "gap-0.5 text-[8px]" : "gap-1 text-[10px]"
      }`}
      data-testid="image-preview-loading-placeholder"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        className={compact ? "h-3 w-3" : "h-4 w-4"}
        aria-hidden="true"
      >
        <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" />
        <circle cx="5.25" cy="6" r="1" />
        <path d="M3.75 11l2.75-2.75 2 2 1.5-1.5 2.25 2.25" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{compact ? "Loading" : "Loading image"}</span>
    </span>
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
        <div
          className="grid min-h-[3.25rem] shrink-0 grid-cols-[minmax(max-content,1fr)_minmax(0,42rem)_minmax(max-content,1fr)] items-center gap-2 border-b border-cc-border bg-cc-card px-3 py-2 sm:px-4"
          data-testid="image-preview-modal-header"
        >
          <ModalHeaderControlFootprint selectedIndex={selectedIndex} count={images.length} />
          <div
            className="pointer-events-none col-start-2 min-w-0 max-w-full justify-self-stretch overflow-hidden text-center"
            data-testid="image-preview-modal-title"
          >
            <span
              className="block min-w-0 w-full truncate font-mono-code text-sm text-cc-fg"
              data-testid="image-preview-modal-filename"
            >
              {image.filename}
            </span>
          </div>
          <div
            className="col-start-3 flex shrink-0 items-center gap-1.5 justify-self-end"
            data-testid="image-preview-modal-controls"
          >
            <IconButton label="Previous image" disabled={!canNavigate} onClick={() => selectOffset(-1)}>
              <path d="M10.5 3.5L6 8l4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </IconButton>
            <IconButton label="Next image" disabled={!canNavigate} onClick={() => selectOffset(1)}>
              <path d="M5.5 3.5L10 8l-4.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
            </IconButton>
            <span className="shrink-0 font-mono-code text-xs text-cc-muted" data-testid="image-preview-modal-index">
              {selectedIndex + 1} of {images.length}
            </span>
            <IconButton label="Close image preview" onClick={onClose}>
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </IconButton>
          </div>
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

function ModalHeaderControlFootprint({ selectedIndex, count }: { selectedIndex: number; count: number }) {
  return (
    <div
      className="invisible col-start-1 flex shrink-0 items-center gap-1.5 justify-self-start"
      aria-hidden="true"
      data-testid="image-preview-modal-control-footprint"
    >
      <span className="h-8 w-8 shrink-0 rounded-md border border-transparent" />
      <span className="h-8 w-8 shrink-0 rounded-md border border-transparent" />
      <span className="shrink-0 font-mono-code text-xs">
        {selectedIndex + 1} of {count}
      </span>
      <span className="h-8 w-8 shrink-0 rounded-md border border-transparent" />
    </div>
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
