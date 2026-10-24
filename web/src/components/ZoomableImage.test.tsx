// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ZoomableImage } from "./ZoomableImage.js";

// jsdom has no layout, so give the image a 200x100 box at the viewport origin
// whose reported rect moves with its translate(), as a real browser would.
function renderZoomable(onParentClick = vi.fn(), onSwipe?: (direction: "previous" | "next") => void) {
  const view = render(
    <div onClick={onParentClick}>
      <ZoomableImage src="/a.png" alt="preview" imageTestId="image" onSwipe={onSwipe} />
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
  pointerType = "touch",
) {
  fireEvent[type](target, { pointerId, clientX: x, clientY: y, pointerType, button: 0 });
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
    fireEvent.load(image);
    fireEvent.wheel(stage, { deltaY: -200, clientX: 0, clientY: 0 });
    expect(readTransform(image).scale).toBeGreaterThan(1.4);

    // The loaded image stays on screen while the next one loads, unzoomed.
    rerender(
      <div>
        <ZoomableImage src="/b.png" alt="preview" imageTestId="image" />
      </div>,
    );
    expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });
  });

  describe("loading a new image", () => {
    // Previous/Next used to change the counter while the old image stayed on screen,
    // undimmed, until the new one arrived. Now the old one stays only as a dimmed
    // placeholder under a spinner, and the new one replaces it once it has loaded.
    function renderLoaded(src: string | null) {
      const view = render(<ZoomableImage src={src} alt="preview" imageTestId="image" />);
      fireEvent.load(screen.getByTestId("image"));
      const rerender = (next: string | null) =>
        view.rerender(<ZoomableImage src={next} alt="preview" imageTestId="image" />);
      return { ...view, rerender, stage: screen.getByTestId("zoomable-image-stage") };
    }

    function shownImages(stage: HTMLElement) {
      return [...stage.querySelectorAll("img")].filter((img) => !img.classList.contains("opacity-0"));
    }

    it("keeps the previous image, dimmed under a spinner once slow, until the new one loads", () => {
      vi.useFakeTimers();
      const { rerender, stage } = renderLoaded("/a.png");
      expect(stage.getAttribute("aria-busy")).toBeNull();

      // Still downloading: no element for the new image yet.
      rerender(null);
      expect(shownImages(stage).map((img) => img.getAttribute("src"))).toEqual(["/a.png"]);
      expect(stage.getAttribute("aria-busy")).toBe("true");
      // A quick load swaps without dimming or a spinner.
      expect(screen.queryByTestId("zoomable-image-loading")).toBeNull();
      expect(shownImages(stage)[0].classList.contains("brightness-50")).toBe(false);

      act(() => vi.advanceTimersByTime(200));
      expect(screen.getByTestId("zoomable-image-loading")).toBeTruthy();
      expect(shownImages(stage)[0].classList.contains("brightness-50")).toBe(true);

      // The new image loads hidden, then replaces the old one.
      rerender("/b.png");
      const next = screen.getByTestId("image");
      expect(next.getAttribute("src")).toBe("/b.png");
      expect(next.classList.contains("opacity-0")).toBe(true);
      expect(shownImages(stage).map((img) => img.getAttribute("src"))).toEqual(["/a.png"]);

      fireEvent.load(next);
      expect(stage.querySelectorAll("img")).toHaveLength(1);
      expect(screen.getByTestId("image")).toBe(next);
      expect(next.classList.contains("opacity-0")).toBe(false);
      expect(screen.queryByTestId("zoomable-image-loading")).toBeNull();
      expect(stage.getAttribute("aria-busy")).toBeNull();
    });

    it("shows only the last requested image after a quick run of changes", () => {
      // Previous/Next pressed quickly: an image requested earlier must never replace the last one.
      const { rerender, stage } = renderLoaded("/a.png");
      rerender("/b.png");
      const abandoned = screen.getByTestId("image");
      rerender("/c.png");
      expect(abandoned.isConnected).toBe(false);

      fireEvent.load(screen.getByTestId("image"));
      expect([...stage.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["/c.png"]);
    });

    it("shows a failed image as broken instead of loading forever", () => {
      const { rerender, stage } = renderLoaded("/a.png");
      rerender("/missing.png");
      fireEvent.error(screen.getByTestId("image"));
      expect([...stage.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual(["/missing.png"]);
      expect(stage.getAttribute("aria-busy")).toBeNull();
    });
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

  describe("swiping between images", () => {
    // Swipes are judged by distance, or by speed for a short flick, so pin the clock.
    let now = 0;
    beforeEach(() => {
      now = 1_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
    });
    afterEach(() => vi.restoreAllMocks());

    function drag(stage: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }, ms = 400) {
      pointer(stage, "pointerDown", 1, from.x, from.y);
      now += ms;
      pointer(stage, "pointerMove", 1, to.x, to.y);
      pointer(stage, "pointerUp", 1, to.x, to.y);
    }

    it("swipes left for the next image and right for the previous one", () => {
      const onSwipe = vi.fn();
      const { stage, image } = renderZoomable(vi.fn(), onSwipe);

      // The image follows the finger sideways while it drags.
      pointer(stage, "pointerDown", 1, 150, 50);
      pointer(stage, "pointerMove", 1, 70, 60);
      expect(readTransform(image)).toEqual({ x: -80, y: 0, scale: 1 });
      pointer(stage, "pointerUp", 1, 70, 60);
      expect(onSwipe).toHaveBeenLastCalledWith("next");
      expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });

      drag(stage, { x: 50, y: 50 }, { x: 130, y: 50 });
      expect(onSwipe).toHaveBeenLastCalledWith("previous");
      expect(onSwipe).toHaveBeenCalledTimes(2);
    });

    it("needs a long drag or a quick flick, sideways rather than vertical", () => {
      const onSwipe = vi.fn();
      const { stage, image } = renderZoomable(vi.fn(), onSwipe);

      drag(stage, { x: 100, y: 50 }, { x: 70, y: 50 });
      expect(onSwipe).not.toHaveBeenCalled();
      // A short drag that does not switch slides back into place.
      expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });

      drag(stage, { x: 100, y: 50 }, { x: 30, y: 150 });
      expect(onSwipe).not.toHaveBeenCalled();

      drag(stage, { x: 100, y: 50 }, { x: 70, y: 50 }, 100);
      expect(onSwipe).toHaveBeenCalledWith("next");
    });

    it("pans instead of swiping once zoomed in, and pinches when a second finger joins", () => {
      const onSwipe = vi.fn();
      const { stage, image } = renderZoomable(vi.fn(), onSwipe);

      // A second finger mid-swipe starts a pinch from the unshifted image.
      pointer(stage, "pointerDown", 1, 80, 50);
      pointer(stage, "pointerMove", 1, 40, 50);
      pointer(stage, "pointerDown", 2, 120, 50);
      expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });
      pointer(stage, "pointerMove", 1, 20, 50);
      pointer(stage, "pointerMove", 2, 140, 50);
      expect(readTransform(image).scale).toBe(1.5);
      pointer(stage, "pointerUp", 1, 20, 50);
      pointer(stage, "pointerUp", 2, 140, 50);
      expect(onSwipe).not.toHaveBeenCalled();

      drag(stage, { x: 150, y: 50 }, { x: 50, y: 50 });
      expect(onSwipe).not.toHaveBeenCalled();
      expect(readTransform(image).scale).toBe(1.5);
    });

    it("leaves mouse drags alone", () => {
      const onSwipe = vi.fn();
      const { stage, image } = renderZoomable(vi.fn(), onSwipe);
      pointer(stage, "pointerDown", 1, 150, 50, stage, "mouse");
      pointer(stage, "pointerMove", 1, 50, 50, stage, "mouse");
      pointer(stage, "pointerUp", 1, 50, 50, stage, "mouse");

      expect(onSwipe).not.toHaveBeenCalled();
      expect(readTransform(image)).toEqual({ x: 0, y: 0, scale: 1 });
    });
  });
});
