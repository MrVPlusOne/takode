import { useMemo } from "react";
import type { ArtifactMessageMarker } from "../../../shared/artifact-library.js";
import { ArtifactMarkersContext } from "../artifact-card-menu.js";
import { ImagePreviewGroup } from "../ImagePreviewGroup.js";
import { ImagePathLinkContext, useImagePathLinks } from "../image-path-links.js";
import { imagePreviewIdForLocalPath, type ImagePreviewItem } from "../image-preview-utils.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { MIXED_READY_IMAGE, READY_IMAGE } from "./PlaygroundPendingImagePreviews.js";

const LOADED_PATH = "/tmp/takode-playground/tabs-after.png";
const LOADING_PATH = "/tmp/takode-playground/tabs-loading.png";
const MISSING_PATH = "/tmp/takode-playground/tabs-deleted.png";

// The loaded image is a starred Library figure, so its viewer shows the filled star.
const FIGURE_MARKERS: ArtifactMessageMarker[] = [
  {
    id: "playground-figure",
    kind: "figure",
    title: "Tabs after",
    version: 1,
    versionCount: 1,
    path: LOADED_PATH,
    starred: true,
  },
];

const TEXT = `Here are the tabs after the change:

![Tabs after](${LOADED_PATH}) ![Still loading](${LOADING_PATH}) ![Deleted since](${MISSING_PATH})`;

/**
 * An agent message showing images with Markdown image syntax. Each keeps its tile from the first
 * render: loaded, still loading, and missing (the file can no longer be fetched). The loaded one
 * is a starred Library figure, so its viewer has the star, and its viewer offers Download.
 */
export function PlaygroundMarkdownImages() {
  const images = useMemo<ImagePreviewItem[]>(
    () =>
      [
        { path: LOADED_PATH, url: READY_IMAGE },
        { path: LOADING_PATH, url: "" },
        { path: MISSING_PATH, url: "/playground-missing-image.png" },
      ].map(({ path, url }) => ({
        id: imagePreviewIdForLocalPath(path, false),
        filename: path.split("/").at(-1) ?? path,
        thumbnailUrl: url,
        fullUrl: url,
        title: path,
        sourcePath: path,
        expectedAttachment: true,
        showWhenMissing: true,
        // A real message saves the file from its machine; the fixture saves the picture it shows.
        ...(url ? { download: { url, name: path.split("/").at(-1) ?? path } } : {}),
      })),
    [],
  );
  const { groupRef, links } = useImagePathLinks(images);

  return (
    <div data-testid="playground-markdown-images">
      <ImagePathLinkContext.Provider value={links}>
        <ArtifactMarkersContext.Provider value={FIGURE_MARKERS}>
          <MarkdownContent text={TEXT} />
          <ImagePreviewGroup ref={groupRef} images={images} testId="playground-markdown-image-group" />
        </ArtifactMarkersContext.Provider>
      </ImagePathLinkContext.Provider>
    </div>
  );
}

const EMBEDDED_TEXT = `## Latest plots

Embedded images open full size in the image viewer on click or tap:

![Evals by training data](${READY_IMAGE})

An image inside a link follows the link instead: [![Training by data](${MIXED_READY_IMAGE})](https://example.com)`;

/** A page with images embedded by URL, as a Scribe writes plots into a topic page. */
export function PlaygroundEmbeddedMarkdownImages() {
  return (
    <div data-testid="playground-embedded-markdown-images">
      <MarkdownContent text={EMBEDDED_TEXT} />
    </div>
  );
}
