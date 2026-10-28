import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ZoomableImage } from "./ZoomableImage.js";
import { CopyImageButton } from "./CopyImageButton.js";
import { SECONDARY_VIEWER_LAYER_CLASS, useSecondaryViewTarget } from "../utils/secondary-view.js";
import { backdropClickProps } from "../utils/backdrop-click.js";
import { formatImageDownload, useImageDownload } from "../hooks/use-image-download.js";
import { useConversationShown } from "./KeptConversationViews.js";

interface LightboxProps {
  /** The full-size image URL (e.g., data URI or http URL) */
  src: string;
  /** Alt text for the image */
  alt?: string;
  /** Called when the lightbox should close */
  onClose: () => void;
}

/**
 * Image lightbox: in the secondary view floating over the app's right side on wide
 * screens, otherwise a full-screen modal on document.body. The image is displayed at its
 * natural size, constrained to fit, and can be zoomed and panned, with its file size (and
 * download progress while it loads) in the top-left corner and a Copy image button beside Close.
 * Click around the image or press Escape to close.
 */
export function Lightbox({ src, alt = "Full-size image", onClose }: LightboxProps) {
  const dockTarget = useSecondaryViewTarget(true, onClose, "media");
  const docked = dockTarget !== null;
  const download = useImageDownload(src);
  const sizeLabel = formatImageDownload(download);
  const conversationShown = useConversationShown();
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [handleKeyDown]);

  useEffect(() => {
    if (docked) return;
    // Prevent body scroll while the full-screen lightbox is open
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [docked]);

  // Full-screen, the viewer sits on document.body, outside its conversation's hidden Activity.
  if (!conversationShown) return null;

  return createPortal(
    <div
      className={`${docked ? SECONDARY_VIEWER_LAYER_CLASS : "fixed inset-0 z-50 bg-black/80"} items-center justify-center cursor-zoom-out`}
      {...backdropClickProps(onClose)}
      data-testid="lightbox-backdrop"
    >
      {/* Close button in top-right corner */}
      <button
        className={`absolute top-4 right-4 z-10 w-9 h-9 flex items-center justify-center rounded-full transition-colors cursor-pointer ${
          docked
            ? "bg-cc-card text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            : "bg-white/10 hover:bg-white/20 text-white"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close lightbox"
        data-testid="lightbox-close"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>

      <CopyImageButton
        src={download.displaySrc}
        className={`absolute top-4 right-16 z-10 h-9 rounded-full px-3 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
          docked
            ? "bg-cc-card text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            : "bg-white/10 hover:bg-white/20 text-white"
        }`}
      />

      {sizeLabel && (
        <span
          className={`pointer-events-none absolute top-4 left-4 z-10 rounded-full px-2.5 py-1 font-mono-code text-xs tabular-nums ${
            docked ? "bg-cc-card text-cc-muted" : "bg-black/60 text-white/90 ring-1 ring-white/15"
          }`}
          data-testid="lightbox-size"
        >
          {sizeLabel}
        </span>
      )}

      <ZoomableImage
        src={download.displaySrc}
        alt={alt}
        className="absolute inset-0 flex items-center justify-center"
        imageClassName={`${
          docked ? "max-w-[calc(100%-2rem)] max-h-[calc(100%-2rem)]" : "max-w-[90vw] max-h-[90vh]"
        } object-contain rounded-lg shadow-2xl select-none`}
        imageTestId="lightbox-image"
      />
    </div>,
    dockTarget ?? document.body,
  );
}
