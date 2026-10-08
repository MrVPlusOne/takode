// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { ZoomableImage } from "./ZoomableImage.js";

// jsdom has no layout, so give the image a 200x100 box at the viewport origin
// whose reported rect moves with its translate(), as a real browser would.
function renderZoomable(onParentClick = vi.fn()) {
  const view = render(
    <div onClick={onParentClick}>
      <ZoomableImage src="/a.png" alt="preview" imageTestId="image" />
    </div>,
  );
  const image = screen.getByTestId("image") as HTMLImageElement;
  Object.defineProperty(image, "offsetWidth", { value: 200 });
  Object.defineProperty(image, "offsetHeight", { value: 100 });
  image.getBoundingClientRect = () => {
    const { x, y } = readTransform(image);
    return { left: x, top: y } as DOMRect;
  };
  return { ...view, image, stage: screen.getByTestId("zoomable-image-stage"), onParentClick };
}

function readTransform(image: HTMLElement) {
  const match = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(image.style.transform);
  return match ? { x: Number(match[1]), y: Number(match[2]), scale: Number(match[3]) } : { x: 0, y: 0, scale: 1 };
}

function pointer(
  stage: HTMLElement,
  type: "pointerDown" | "pointerMove" | "pointerUp",
  pointerId: number,
  x: number,
  y: number,
  target: HTMLElement = stage,
) {
  fireEvent[type](target, { pointerId, clientX: x, clientY: y, pointerType: "touch", button: 0 });
}

function doubleTap(stage: HTMLElement, x: number, y: number) {
  for (let i = 0; i < 2; i += 1) {
    pointer(stage, "pointerDown", 1, x, y);
    pointer(stage, "pointerUp", 1, x, y);
  }
}

describe("ZoomableImage", () => {
  it("pinches to zoom around the fingers' midpoint", () => {
    // Fingers 40px apart centered on (100, 50) spread to 80px: 2x zoom, and the
    // content point under the midpoint stays put, so translation is -midpoint.
    const { stage, image } = renderZoomable();
    pointer(stage, "pointerDown", 1, 80, 50);
    pointer(stage, "pointerDown", 2, 120, 50);
    pointer(stage, "pointerMove", 1, 60, 50);
    pointer(stage, "pointerMove", 2, 140, 50);

    expect(readTransform(image)).toEqual({ x: -100, y: -50, scale: 2 });
  });

  it("pans with one finger once zoomed, clamped so the image keeps covering its box", () => {
    const { stage, image } = renderZoomable();
    doubleTap(stage, 100, 50);
    expect(readTransform(image)).toEqual({ x: -150, y: -75, scale: 2.5 });

    pointer(stage, "pointerDown", 1, 100, 50);
    pointer(stage, "pointerMove", 1, 130, 60);
    expect(readTransform(image)).toEqual({ x: -120, y: -65, scale: 2.5 });

    // Dragging far right would expose empty space left of the image, so x stops at 0.
    pointer(stage, "pointerMove", 1, 500, 60);
    expect(readTransform(image).x).toBe(0);
  });

  it("does not pan or zoom with one finger at the original size", () => {
    const { stage, image } = renderZoomable();
    pointer(stage, "pointerDown", 1, 100, 50);
    pointer(stage, "pointerMove", 1, 160, 90);

    expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("double-tap toggles between zoomed and the original size", () => {
    const { stage, image } = renderZoomable();
    doubleTap(stage, 100, 50);
    expect(readTransform(image).scale).toBe(2.5);

    doubleTap(stage, 100, 50);
    expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("zooms with the mouse wheel and resets when the image changes", () => {
    const { stage, image, rerender } = renderZoomable();
    fireEvent.wheel(stage, { deltaY: -200, clientX: 0, clientY: 0 });
    expect(readTransform(image).scale).toBeGreaterThan(1.4);

    rerender(
      <div>
        <ZoomableImage src="/b.png" alt="preview" imageTestId="image" />
      </div>,
    );
    expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  it("lets plain taps on the empty stage reach the parent but not drags or image taps", () => {
    // Lightbox closes on backdrop clicks, so only a plain tap outside the image may propagate.
    const { stage, image, onParentClick } = renderZoomable();

    pointer(stage, "pointerDown", 1, 300, 300);
    pointer(stage, "pointerUp", 1, 300, 300);
    fireEvent.click(stage);
    expect(onParentClick).toHaveBeenCalledTimes(1);

    pointer(stage, "pointerDown", 1, 300, 300);
    pointer(stage, "pointerMove", 1, 360, 300);
    pointer(stage, "pointerUp", 1, 360, 300);
    fireEvent.click(stage);
    expect(onParentClick).toHaveBeenCalledTimes(1);

    // Pointer capture retargets the click to the stage; the down target decides.
    pointer(stage, "pointerDown", 1, 50, 50, image);
    pointer(stage, "pointerUp", 1, 50, 50);
    fireEvent.click(stage);
    expect(onParentClick).toHaveBeenCalledTimes(1);
  });
});
