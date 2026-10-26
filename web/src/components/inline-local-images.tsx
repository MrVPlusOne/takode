import { createContext, useContext, useState } from "react";
import { findLocalImageReferences } from "../../shared/local-image-references.js";

/**
 * Markdown images with local paths shown inline, where chat would show them as thumbnails, for
 * surfaces that render Markdown on their own (topic pages). The images are read through the
 * session whose files they are, so a remote host's images show too. `refreshKey` changes the
 * image URLs, so a file rewritten in place (a monitor's plot) shows its current version.
 */
export const InlineLocalImagesContext = createContext<{ sessionId?: string; refreshKey: string } | null>(null);

/** True inside a Markdown link: an image there follows the link instead of opening the image viewer. */
export const MarkdownLinkContext = createContext(false);

/** The local image a Markdown image's source names, or null when it is not one. */
export function localImageOf(source: string): { path: string; isRelative: boolean } | null {
  const reference = findLocalImageReferences(`![](${source})`)[0];
  return reference ? { path: reference.path, isRelative: reference.isRelative } : null;
}

/** An image for the image viewer: its full-size source and its description. */
export interface ViewedImage {
  src: string;
  alt: string;
}

/**
 * An image embedded in Markdown that opens in the image viewer on click or tap, unless it sits
 * inside a link, which it then follows. The Markdown renderer owns the viewer: its components are
 * recreated on every render, which would close a viewer kept here.
 */
export function ViewableImage({
  src,
  fullSrc = src,
  alt,
  title,
  className,
  loading,
  onError,
  onOpen,
}: {
  src: string;
  /** The image the viewer shows, when `src` is a smaller version. */
  fullSrc?: string;
  alt: string;
  title?: string;
  className?: string;
  loading?: "lazy" | "eager";
  onError?: () => void;
  onOpen: (image: ViewedImage) => void;
}) {
  const insideLink = useContext(MarkdownLinkContext);
  const image = <img src={src} alt={alt} title={title} loading={loading} onError={onError} className={className} />;
  if (insideLink) return image;
  return (
    <button
      type="button"
      onClick={(event) => {
        // Surfaces that open on a click (a collapsed card, a list row) must not also react.
        event.stopPropagation();
        onOpen({ src: fullSrc, alt: alt || title || "Full-size image" });
      }}
      className="my-1 block max-w-full cursor-zoom-in"
      title={title ?? alt}
      data-testid="viewable-image"
    >
      {image}
    </button>
  );
}

export function InlineLocalImage({
  path,
  isRelative,
  alt,
  sessionId,
  refreshKey,
  fallback,
  onOpen,
}: {
  path: string;
  isRelative: boolean;
  alt: string;
  sessionId?: string;
  refreshKey: string;
  /** Shown when the image cannot be loaded: the link chat would show. */
  fallback: React.ReactNode;
  onOpen: (image: ViewedImage) => void;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  const url = (variant: "thumbnail" | "full") => {
    const params = new URLSearchParams({ path, isRelative: isRelative ? "1" : "0", variant, v: refreshKey });
    if (sessionId) params.set("sessionId", sessionId);
    return `/api/fs/file-link/image?${params.toString()}`;
  };
  return (
    <ViewableImage
      src={url("thumbnail")}
      fullSrc={url("full")}
      alt={alt}
      title={alt || path}
      loading="lazy"
      onError={() => setFailed(true)}
      className="max-h-80 max-w-full rounded-lg border border-cc-border bg-cc-code-bg object-contain"
      onOpen={onOpen}
    />
  );
}
