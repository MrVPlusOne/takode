// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ImagePreviewGroup } from "./ImagePreviewGroup.js";
import type { ImagePreviewItem } from "./image-preview-utils.js";

function image(id: string): ImagePreviewItem {
  return { id, filename: `${id}.png`, thumbnailUrl: `/thumb/${id}.png`, fullUrl: `/full/${id}.png` };
}

function openViewer(images: ImagePreviewItem[]) {
  render(<ImagePreviewGroup images={images} />);
  for (const preload of screen.getAllByTestId("image-preview-preload")) fireEvent.load(preload);
  fireEvent.click(screen.getByRole("button", { name: `Open image ${images[0]!.filename}` }));
  return within(screen.getByTestId("image-preview-modal")).getByTestId("zoomable-image-stage");
}

function swipe(stage: HTMLElement, fromX: number, toX: number) {
  const touch = { pointerId: 1, pointerType: "touch", button: 0, clientY: 100 };
  fireEvent.pointerDown(stage, { ...touch, clientX: fromX });
  fireEvent.pointerMove(stage, { ...touch, clientX: toX });
  fireEvent.pointerUp(stage, { ...touch, clientX: toX });
}

describe("ImagePreviewGroup viewer swipes", () => {
  it("moves through the group with one-finger swipes, wrapping like the buttons", () => {
    const stage = openViewer([image("one"), image("two"), image("three")]);

    swipe(stage, 300, 150);
    expect(screen.getByRole("dialog", { name: "Image preview: two.png" })).toBeVisible();
    expect(screen.getByTestId("image-preview-modal-index")).toHaveTextContent("2 of 3");

    swipe(stage, 150, 300);
    swipe(stage, 150, 300);
    expect(screen.getByTestId("image-preview-modal-index")).toHaveTextContent("3 of 3");
  });

  it("does not move a lone image when swiped", () => {
    const stage = openViewer([image("only")]);

    fireEvent.pointerDown(stage, { pointerId: 1, pointerType: "touch", button: 0, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, pointerType: "touch", button: 0, clientX: 150, clientY: 100 });
    expect(screen.getByTestId("image-preview-modal-image").style.transform).not.toContain("-150px");
    fireEvent.pointerUp(stage, { pointerId: 1, pointerType: "touch", button: 0, clientX: 150, clientY: 100 });

    expect(screen.getByRole("dialog", { name: "Image preview: only.png" })).toBeVisible();
  });
});
