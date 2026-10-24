import { useState } from "react";
import { ZoomableImage } from "../ZoomableImage.js";

const SHOWN_IMAGE =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450">' +
      '<rect width="800" height="450" fill="#334155"/>' +
      '<text x="400" y="240" text-anchor="middle" fill="white" font-size="40" font-family="sans-serif">Image 5 of 6</text>' +
      "</svg>",
  );

/**
 * The image viewer between Previous/Next and the new image arriving: the shown image stays,
 * dimmed under a spinner, until the next one has downloaded (here it never does).
 */
export function PlaygroundImageViewerLoading() {
  const [nextRequested, setNextRequested] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-md border border-cc-border px-2 py-1 text-xs text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        onClick={() => setNextRequested((requested) => !requested)}
      >
        {nextRequested ? "Back to the shown image" : "Request the next image (stays loading)"}
      </button>
      <ZoomableImage
        // null is a viewer image whose download has not finished.
        src={nextRequested ? null : SHOWN_IMAGE}
        alt="Viewer demo"
        className="relative flex h-56 items-center justify-center overflow-hidden rounded-lg border border-cc-border bg-cc-bg p-3"
        imageClassName="max-h-full max-w-full object-contain"
      />
    </div>
  );
}
