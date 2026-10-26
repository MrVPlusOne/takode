import { useMemo } from "react";
import { ImagePreviewGroup } from "../ImagePreviewGroup.js";
import { ImagePathLinkContext, useImagePathLinks } from "../image-path-links.js";
import { imagePreviewIdForLocalPath, type ImagePreviewItem } from "../image-preview-utils.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { MIXED_READY_IMAGE, READY_IMAGE } from "./PlaygroundPendingImagePreviews.js";

const LOADED_PATH = "/tmp/takode-playground/tabs-after.png";
const LOADING_PATH = "/tmp/takode-playground/tabs-loading.png";
const MISSING_PATH = "/tmp/takode-playground/tabs-deleted.png";

const TEXT = `Here are the tabs after the change:

![Tabs after](${LOADED_PATH}) ![Still loading](${LOADING_PATH}) ![Deleted since](${MISSING_PATH})`;

/**
 * An agent message showing images with Markdown image syntax. Each keeps its tile from the first
 * render: loaded, still loading, and missing (the file can no longer be fetched).
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
      })),
    [],
  );
  const { groupRef, links } = useImagePathLinks(images);

  return (
    <div data-testid="playground-markdown-images">
      <ImagePathLinkContext.Provider value={links}>
        <MarkdownContent text={TEXT} />
        <ImagePreviewGroup ref={groupRef} images={images} testId="playground-markdown-image-group" />
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
