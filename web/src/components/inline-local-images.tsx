import { createContext, useContext, useState } from "react";
import { findLocalImageReferences } from "../../shared/local-image-references.js";

/**
 * Markdown images with local paths shown inline, where chat would show them as thumbnails, for
 * surfaces that render Markdown on their own (topic pages). The images are read through the
 * session whose files they are, so a remote host's images show too. `refreshKey` changes the
 * image URLs, so a file rewritten in place (a monitor's plot) shows its current version.
 */
export const InlineLocalImagesContext = createContext<{
  sessionId?: string;
  refreshKey: string;
  /** When each image was last modified, by the path the Markdown uses: shown under it as "Redrawn …". */
  modifiedAt?: Record<string, number>;
} | null>(null);

/** True inside a Markdown link: an image there follows the link instead of opening the image viewer. */
export const MarkdownLinkContext = createContext(false);

/**
 * The local image a Markdown image's source names, or null when it is not one: a local path, or
 * the server's own image URL for a local file (`/api/fs/file-link/image?path=…`, as Scribes embed
 * plots), so both forms get the page's refresh. Such a URL may name the session to read through, and
 * the size shown on the page: Scribes ask for the full image, which keeps plots legible.
 */
export function localImageOf(source: string): LocalImage | null {
  const served = servedLocalImageOf(source);
  if (served) return served;
  const reference = findLocalImageReferences(`![](${source})`)[0];
  return reference ? { path: reference.path, isRelative: reference.isRelative } : null;
}

export type LocalImage = { path: string; isRelative: boolean; sessionId?: string; variant?: ImageVariant };
type ImageVariant = "thumbnail" | "full";

function servedLocalImageOf(source: string): LocalImage | null {
  if (!source.startsWith(SERVED_IMAGE_PATH)) return null;
  const params = new URLSearchParams(source.slice(SERVED_IMAGE_PATH.length));
  const path = params.get("path");
  if (!path) return null;
  const sessionId = params.get("sessionId");
  const isRelative = params.get("isRelative");
  const variant = params.get("variant");
  return {
    path,
    isRelative: isRelative === "1" || isRelative === "true",
    ...(sessionId ? { sessionId } : {}),
    ...(variant === "thumbnail" || variant === "full" ? { variant } : {}),
  };
}

const SERVED_IMAGE_PATH = "/api/fs/file-link/image?";

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
  variant = "thumbnail",
  fallback,
  onOpen,
  modifiedAt,
}: {
  path: string;
  isRelative: boolean;
  /** The size shown on the page; the viewer always shows the full image. */
  variant?: ImageVariant;
  alt: string;
  sessionId?: string;
  refreshKey: string;
  /** Shown when the image cannot be loaded: the link chat would show. */
  fallback: React.ReactNode;
  onOpen: (image: ViewedImage) => void;
  /** When the file was last modified: a picture rewritten in place says how current it is. */
  modifiedAt?: number;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  const url = (size: ImageVariant) => {
    const params = new URLSearchParams({ path, isRelative: isRelative ? "1" : "0", variant: size, v: refreshKey });
    if (sessionId) params.set("sessionId", sessionId);
    return `/api/fs/file-link/image?${params.toString()}`;
  };
  const image = (
    <ViewableImage
      src={url(variant)}
      fullSrc={url("full")}
      alt={alt}
      title={alt || path}
      loading="lazy"
      onError={() => setFailed(true)}
      // A full image (a plot) takes the page's width; a thumbnail stays small.
      className={`${variant === "thumbnail" ? "max-h-80 " : ""}max-w-full rounded-lg border border-cc-border bg-cc-code-bg object-contain`}
      onOpen={onOpen}
    />
  );
  if (modifiedAt === undefined) return image;
  return (
    <span className="inline-flex max-w-full flex-col">
      {image}
      <span className="mt-0.5 text-[11px] text-cc-muted" data-testid="inline-image-modified">
        Redrawn{" "}
        {new Date(modifiedAt).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })}
      </span>
    </span>
  );
}
