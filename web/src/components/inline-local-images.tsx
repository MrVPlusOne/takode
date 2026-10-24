import { createContext, useState } from "react";
import { findLocalImageReferences } from "../../shared/local-image-references.js";
import { Lightbox } from "./Lightbox.js";

/**
 * Markdown images with local paths shown inline, where chat would show them as thumbnails, for
 * surfaces that render Markdown on their own (topic pages). The images are read through the
 * session whose files they are, so a remote host's images show too. `refreshKey` changes the
 * image URLs, so a file rewritten in place (a monitor's plot) shows its current version.
 */
export const InlineLocalImagesContext = createContext<{ sessionId?: string; refreshKey: string } | null>(null);

/** The local image a Markdown image's source names, or null when it is not one. */
export function localImageOf(source: string): { path: string; isRelative: boolean } | null {
  const reference = findLocalImageReferences(`![](${source})`)[0];
  return reference ? { path: reference.path, isRelative: reference.isRelative } : null;
}

export function InlineLocalImage({
  path,
  isRelative,
  alt,
  sessionId,
  refreshKey,
  fallback,
}: {
  path: string;
  isRelative: boolean;
  alt: string;
  sessionId?: string;
  refreshKey: string;
  /** Shown when the image cannot be loaded: the link chat would show. */
  fallback: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return <>{fallback}</>;
  const url = (variant: "thumbnail" | "full") => {
    const params = new URLSearchParams({ path, isRelative: isRelative ? "1" : "0", variant, v: refreshKey });
    if (sessionId) params.set("sessionId", sessionId);
    return `/api/fs/file-link/image?${params.toString()}`;
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="my-1 block max-w-full cursor-zoom-in"
        title={alt || path}
        data-testid="inline-local-image"
      >
        <img
          src={url("thumbnail")}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-80 max-w-full rounded-lg border border-cc-border bg-cc-code-bg object-contain"
        />
      </button>
      {open && <Lightbox src={url("full")} alt={alt || path} onClose={() => setOpen(false)} />}
    </>
  );
}
