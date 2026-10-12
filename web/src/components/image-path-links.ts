import { createContext, useMemo, useRef } from "react";
import type { ImagePreviewGroupHandle } from "./ImagePreviewGroup.js";
import { imagePreviewIdForLocalPath, matchAbsoluteImagePaths, type ImagePreviewItem } from "./image-preview-utils.js";

export interface ImagePathTarget {
  path: string;
  isRelative: boolean;
}

/**
 * Connects image paths in a message's Markdown to the message's image previews: paths that have a
 * preview render as compact file-name links, and clicking one opens that preview's viewer.
 */
export interface ImagePathLinks {
  has: (target: ImagePathTarget) => boolean;
  /** Opens the image in the preview viewer; false when the viewer cannot show it, e.g. it failed to load. */
  open: (target: ImagePathTarget) => boolean;
}

export const ImagePathLinkContext = createContext<ImagePathLinks | null>(null);

/**
 * Builds the links for one preview group. Pass `groupRef` to that `ImagePreviewGroup` and provide
 * `links` around the Markdown that mentions the images; `links` is null when no image came from a path.
 */
export function useImagePathLinks(images: ImagePreviewItem[]) {
  const groupRef = useRef<ImagePreviewGroupHandle>(null);
  // Keyed by IDs so a message update that keeps the same images does not re-render its Markdown.
  const pathIdsKey = images
    .filter((image) => image.sourcePath)
    .map((image) => image.id)
    .join("\u0000");
  const links = useMemo<ImagePathLinks | null>(() => {
    if (!pathIdsKey) return null;
    const ids = new Set(pathIdsKey.split("\u0000"));
    const idFor = (target: ImagePathTarget) => imagePreviewIdForLocalPath(target.path, target.isRelative);
    return {
      has: (target) => ids.has(idFor(target)),
      open: (target) => ids.has(idFor(target)) && (groupRef.current?.openImage(idFor(target)) ?? false),
    };
  }, [pathIdsKey]);
  return { groupRef, links };
}

interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  title?: string | null;
}

/** Characters a bare path may follow, so `docs/a.png` is not read as the absolute path `/a.png`. */
const PATH_BOUNDARY = /[\s([{<"']/;

/**
 * Remark plugin that turns absolute image paths written as plain text or as a whole code span into
 * `file:` links labelled with the file name, for the paths `isLinkable` accepts.
 */
export function remarkImagePathLinks({ isLinkable }: { isLinkable: (path: string) => boolean }) {
  return (tree: MarkdownNode) => linkImagePaths(tree, isLinkable);
}

function linkImagePaths(node: MarkdownNode, isLinkable: (path: string) => boolean): void {
  if (!node.children || node.type === "link" || node.type === "linkReference" || node.type === "definition") return;
  node.children = node.children.flatMap((child) => {
    if (child.type === "text" && child.value) return splitTextAtImagePaths(child.value, isLinkable) ?? [child];
    if (child.type === "inlineCode" && child.value) {
      const path = child.value.trim();
      return path.startsWith("/") && isLinkable(path) ? [imagePathLink(path)] : [child];
    }
    linkImagePaths(child, isLinkable);
    return [child];
  });
}

function splitTextAtImagePaths(value: string, isLinkable: (path: string) => boolean): MarkdownNode[] | null {
  const nodes: MarkdownNode[] = [];
  let cursor = 0;
  for (const { index, path } of matchAbsoluteImagePaths(value)) {
    if (index > 0 && !PATH_BOUNDARY.test(value[index - 1] ?? "")) continue;
    if (!isLinkable(path)) continue;
    if (index > cursor) nodes.push({ type: "text", value: value.slice(cursor, index) });
    nodes.push(imagePathLink(path));
    cursor = index + path.length;
  }
  if (nodes.length === 0) return null;
  if (cursor < value.length) nodes.push({ type: "text", value: value.slice(cursor) });
  return nodes;
}

function imagePathLink(path: string): MarkdownNode {
  const name = path.split("/").filter(Boolean).at(-1) ?? path;
  return {
    type: "link",
    url: `file:${encodeURI(path)}`,
    title: null,
    children: [{ type: "text", value: name }],
  };
}
