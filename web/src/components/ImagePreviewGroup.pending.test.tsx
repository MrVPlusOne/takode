// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import type { ImagePreviewItem } from "./image-preview-utils.js";

function makeImage(
  id: string,
  options: { expectedAttachment?: boolean; thumbnailUrl?: string; fullUrl?: string } = {},
): ImagePreviewItem {
  return {
    id,
    filename: `${id}.png`,
    thumbnailUrl: options.thumbnailUrl ?? `/thumb/${id}.png`,
    fullUrl: options.fullUrl ?? `/full/${id}.png`,
    ...(options.expectedAttachment === undefined ? { expectedAttachment: true } : options),
  };
}

function previewIds(group: HTMLElement): string[] {
  return Array.from(group.querySelectorAll<HTMLElement>("[data-image-preview-id]")).map(
    (element) => element.dataset.imagePreviewId ?? "",
  );
}

function thumbnailFor(group: HTMLElement, id: string): HTMLElement {
  const slot = group.querySelector<HTMLElement>(`[data-image-preview-id="${id}"]`);
  if (!slot) throw new Error(`Missing image preview slot for ${id}`);
  return within(slot).getByTestId("image-preview-thumbnail-image");
}

describe("ImagePreviewGroup pending attachments", () => {
  it("shows one accessible placeholder per expected attachment and preserves source order through out-of-order loads", () => {
    // Producer-known attachment refs may reserve visible slots before their browser previews finish loading.
    const images = [makeImage("first"), makeImage("second"), makeImage("third")];
    render(<ImagePreviewGroup images={images} testId="pending-images" />);

    const group = screen.getByTestId("pending-images");
    expect(previewIds(group)).toEqual(["first", "second", "third"]);
    expect(within(group).getAllByTestId("image-preview-loading-placeholder")).toHaveLength(3);

    for (const image of images) {
      const placeholder = within(group).getByRole("button", { name: `Loading image ${image.filename}` });
      expect(placeholder).toBeDisabled();
      expect(placeholder).toHaveAttribute("aria-busy", "true");
      expect(placeholder).toHaveTextContent("Loading image");
    }

    fireEvent.load(thumbnailFor(group, "third"));
    expect(previewIds(group)).toEqual(["first", "second", "third"]);
    expect(within(group).getByRole("button", { name: "Open image third.png" })).toBeEnabled();
    expect(within(group).getAllByTestId("image-preview-loading-placeholder")).toHaveLength(2);

    fireEvent.load(thumbnailFor(group, "first"));
    expect(previewIds(group)).toEqual(["first", "second", "third"]);
    expect(within(group).getByRole("button", { name: "Open image first.png" })).toBeEnabled();
    expect(within(group).getByRole("button", { name: "Loading image second.png" })).toBeDisabled();
  });

  it("replaces a successful placeholder in the same slot without duplicate preload or thumbnail elements", () => {
    const image = makeImage("only");
    render(<ImagePreviewGroup images={[image]} testId="pending-images" />);

    const group = screen.getByTestId("pending-images");
    const pendingSlot = within(group).getByRole("button", { name: "Loading image only.png" });
    const thumbnail = thumbnailFor(group, "only");

    expect(screen.queryByTestId("image-preview-preload")).toBeNull();
    expect(within(group).getAllByTestId("image-preview-thumbnail-image")).toHaveLength(1);

    fireEvent.load(thumbnail);

    const readySlot = within(group).getByRole("button", { name: "Open image only.png" });
    expect(readySlot).toBe(pendingSlot);
    expect(readySlot).not.toHaveAttribute("aria-busy");
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();
    expect(within(group).getAllByTestId("image-preview-thumbnail-image")).toHaveLength(1);
    expect(screen.queryByTestId("image-preview-preload")).toBeNull();
  });

  it("removes only a failed attachment slot and removes the group after every attachment fails", () => {
    const images = [makeImage("first"), makeImage("second"), makeImage("third")];
    render(<ImagePreviewGroup images={images} testId="pending-images" />);

    const group = screen.getByTestId("pending-images");
    const firstThumbnail = thumbnailFor(group, "first");
    const secondThumbnail = thumbnailFor(group, "second");
    const thirdThumbnail = thumbnailFor(group, "third");

    fireEvent.error(secondThumbnail);
    expect(previewIds(group)).toEqual(["first", "third"]);
    expect(within(group).queryByRole("button", { name: "Loading image second.png" })).toBeNull();
    expect(within(group).getAllByTestId("image-preview-loading-placeholder")).toHaveLength(2);

    fireEvent.error(firstThumbnail);
    expect(previewIds(group)).toEqual(["third"]);

    fireEvent.error(thirdThumbnail);
    expect(screen.queryByTestId("pending-images")).toBeNull();
    expect(screen.queryByTestId("image-preview-loading-placeholder")).toBeNull();
  });

  it("preserves loaded state for equivalent items and resets only an item whose thumbnail URL changes", () => {
    const first = makeImage("first");
    const second = makeImage("second");
    const { rerender } = render(<ImagePreviewGroup images={[first, second]} testId="pending-images" />);

    let group = screen.getByTestId("pending-images");
    fireEvent.load(thumbnailFor(group, "first"));
    fireEvent.load(thumbnailFor(group, "second"));
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();

    rerender(<ImagePreviewGroup images={[{ ...first }, { ...second }]} testId="pending-images" />);
    group = screen.getByTestId("pending-images");
    expect(within(group).getByRole("button", { name: "Open image first.png" })).toBeEnabled();
    expect(within(group).getByRole("button", { name: "Open image second.png" })).toBeEnabled();
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();

    const changedSecond = makeImage("second", { thumbnailUrl: "/thumb/second-v2.png" });
    rerender(<ImagePreviewGroup images={[{ ...first }, changedSecond]} testId="pending-images" />);
    group = screen.getByTestId("pending-images");

    expect(previewIds(group)).toEqual(["first", "second"]);
    expect(within(group).getByRole("button", { name: "Open image first.png" })).toBeEnabled();
    expect(within(group).getByRole("button", { name: "Loading image second.png" })).toBeDisabled();
    expect(within(group).getAllByTestId("image-preview-loading-placeholder")).toHaveLength(1);

    fireEvent.load(thumbnailFor(group, "second"));
    expect(within(group).getByRole("button", { name: "Open image second.png" })).toBeEnabled();
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();
  });

  it("keeps speculative references hidden until load and silently omits failures", () => {
    // Text-discovered paths are speculative, so they must retain q-1289's silent missing-image behavior.
    const loadable = makeImage("loadable", { expectedAttachment: false });
    const missing = makeImage("missing", { expectedAttachment: false });
    render(<ImagePreviewGroup images={[loadable, missing]} testId="speculative-images" />);

    expect(screen.queryByTestId("speculative-images")).toBeNull();
    expect(screen.queryByTestId("image-preview-loading-placeholder")).toBeNull();
    expect(screen.queryByRole("button", { name: /Loading image/ })).toBeNull();

    const preloads = screen.getAllByTestId("image-preview-preload");
    expect(preloads).toHaveLength(2);
    fireEvent.error(preloads[1]!);
    expect(screen.queryByTestId("speculative-images")).toBeNull();

    fireEvent.load(preloads[0]!);
    const group = screen.getByTestId("speculative-images");
    expect(previewIds(group)).toEqual(["loadable"]);
    expect(within(group).getByRole("button", { name: "Open image loadable.png" })).toBeEnabled();
    expect(within(group).queryByText("missing.png")).toBeNull();
    expect(screen.queryByTestId("image-preview-loading-placeholder")).toBeNull();
  });

  it("shows an origin-local preview immediately and falls back to the backend after a local error", () => {
    const onImageError = vi.fn();
    const image = makeImage("origin", {
      thumbnailUrl: "blob:origin",
      fullUrl: "blob:origin",
    });
    image.immediatelyAvailable = true;
    image.localImageId = "image-origin";
    image.fallback = { thumbnailUrl: "/thumb/origin.png", fullUrl: "/full/origin.png" };
    render(<ImagePreviewGroup images={[image]} testId="origin-image" onImageError={onImageError} />);

    const group = screen.getByTestId("origin-image");
    expect(within(group).getByRole("button", { name: "Open image origin.png" })).toBeEnabled();
    expect(within(group).queryByTestId("image-preview-loading-placeholder")).toBeNull();
    const localThumbnail = thumbnailFor(group, "origin");
    expect(localThumbnail).toHaveAttribute("src", "blob:origin");

    fireEvent.error(localThumbnail);

    expect(onImageError).toHaveBeenCalledWith(image);
    expect(within(group).getByRole("button", { name: "Loading image origin.png" })).toBeDisabled();
    expect(thumbnailFor(group, "origin")).toHaveAttribute("src", "/thumb/origin.png");
    fireEvent.load(thumbnailFor(group, "origin"));
    expect(within(group).getByRole("button", { name: "Open image origin.png" })).toBeEnabled();
  });

  it("keeps an opened local modal visible while its backend fallback loads", () => {
    const image = makeImage("origin-modal", {
      thumbnailUrl: "blob:origin-modal",
      fullUrl: "blob:origin-modal",
    });
    image.immediatelyAvailable = true;
    image.localImageId = "image-origin-modal";
    image.fallback = { thumbnailUrl: "/thumb/origin-modal.png", fullUrl: "/full/origin-modal.png" };
    render(<ImagePreviewGroup images={[image]} testId="origin-modal-images" />);

    const group = screen.getByTestId("origin-modal-images");
    fireEvent.click(within(group).getByRole("button", { name: "Open image origin-modal.png" }));
    expect(screen.getByTestId("image-preview-modal-image")).toHaveAttribute("src", "blob:origin-modal");

    fireEvent.error(thumbnailFor(group, "origin-modal"));

    expect(screen.getByRole("dialog", { name: "Image preview: origin-modal.png" })).toBeVisible();
    expect(screen.getByTestId("image-preview-modal-image")).toHaveAttribute("src", "/full/origin-modal.png");
    expect(within(group).getByRole("button", { name: "Loading image origin-modal.png" })).toBeDisabled();

    fireEvent.load(thumbnailFor(group, "origin-modal"));
    expect(screen.getByRole("dialog", { name: "Image preview: origin-modal.png" })).toBeVisible();
  });

  it("keeps pending and failed attachments out of modal navigation", () => {
    const images = [makeImage("ready-one"), makeImage("pending"), makeImage("failed"), makeImage("ready-two")];
    render(<ImagePreviewGroup images={images} testId="pending-images" />);

    const group = screen.getByTestId("pending-images");
    fireEvent.load(thumbnailFor(group, "ready-one"));
    fireEvent.error(thumbnailFor(group, "failed"));
    fireEvent.load(thumbnailFor(group, "ready-two"));

    fireEvent.click(within(group).getByRole("button", { name: "Open image ready-one.png" }));

    expect(screen.getByRole("dialog", { name: "Image preview: ready-one.png" })).toBeVisible();
    expect(screen.getByTestId("image-preview-modal-index")).toHaveTextContent("1 of 2");
    expect(within(group).getByRole("button", { name: "Loading image pending.png" })).toBeDisabled();
    expect(within(group).queryByRole("button", { name: /failed\.png/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(screen.getByRole("dialog", { name: "Image preview: ready-two.png" })).toBeVisible();
    expect(screen.getByTestId("image-preview-modal-index")).toHaveTextContent("2 of 2");
  });
});
