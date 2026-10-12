import { useMemo } from "react";
import { ImagePreviewGroup } from "../ImagePreviewGroup.js";
import { ImagePathLinkContext, useImagePathLinks } from "../image-path-links.js";
import { imagePreviewIdForLocalPath, type ImagePreviewItem } from "../image-preview-utils.js";
import { MarkdownContent } from "../MarkdownContent.js";
import { MIXED_READY_IMAGE, READY_IMAGE } from "./PlaygroundPendingImagePreviews.js";

const DARK_PATH = "/tmp/takode-playground/01-bar-dark.takode-agent.jpeg";
const LIGHT_PATH = "/tmp/takode-playground/01-bar-light.takode-agent.jpeg";

const TEXT = `Status groups are built into the real app.

- The bar: ${DARK_PATH} (light: \`${LIGHT_PATH}\`)
- The log stays plain text: /tmp/takode-playground/run.log`;

/**
 * An agent message whose image paths render as file-name links. Previews use inline images, so a
 * link click opens the thumbnail viewer with the full copyable path, as it does for real local files.
 */
export function PlaygroundImagePathLinks() {
  const images = useMemo<ImagePreviewItem[]>(
    () =>
      [
        { path: DARK_PATH, url: READY_IMAGE },
        { path: LIGHT_PATH, url: MIXED_READY_IMAGE },
      ].map(({ path, url }) => ({
        id: imagePreviewIdForLocalPath(path, false),
        filename: path.split("/").at(-1) ?? path,
        thumbnailUrl: url,
        fullUrl: url,
        title: path,
        sourcePath: path,
      })),
    [],
  );
  const { groupRef, links } = useImagePathLinks(images);

  return (
    <div data-testid="playground-image-path-links">
      <ImagePathLinkContext.Provider value={links}>
        <MarkdownContent text={TEXT} />
        <ImagePreviewGroup ref={groupRef} images={images} testId="playground-image-path-link-group" />
      </ImagePathLinkContext.Provider>
    </div>
  );
}
