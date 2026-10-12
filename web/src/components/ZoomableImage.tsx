import { useEffect, useRef } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const TAP_SLOP_PX = 10;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_DISTANCE_PX = 30;
/** A one-finger drag this far sideways switches images; a quick flick needs less. */
const SWIPE_DISTANCE_PX = 60;
const FLICK_DISTANCE_PX = 25;
const FLICK_MS = 250;

interface Point {
  x: number;
  y: number;
}

interface ZoomTransform {
  scale: number;
  x: number;
  y: number;
}

interface Gesture {
  /** Transform when the current pointer set went down. */
  start: ZoomTransform;
  /** Centroid of the pointers at gesture start, in client coordinates. */
  anchor: Point;
  /** Distance between the first two pointers at gesture start; 0 for one pointer. */
  spread: number;
}

interface ZoomableImageProps {
  src: string;
  alt: string;
  /** Classes for the stage: the gesture surface that frames the image. */
  className?: string;
  imageClassName?: string;
  imageTestId?: string;
  /**
   * Called when a one-finger horizontal swipe ends on the unzoomed image: "next" for a swipe to the
   * left. Without it, a drag on the unzoomed image does nothing.
   */
  onSwipe?: (direction: "previous" | "next") => void;
}

/**
 * Image the user can zoom and pan inside its stage: pinch and drag on touch
 * screens, wheel or trackpad pinch and drag with a mouse, and double-tap or
 * double-click to toggle zoom at that point. The app viewport disables browser
 * pinch-zoom (so iOS does not zoom on input focus), so previews provide their own.
 *
 * With `onSwipe`, a one-finger horizontal swipe on the unzoomed image switches images;
 * once zoomed in, one finger pans instead.
 *
 * Clicks on the image, or ending a drag or pinch, do not propagate, so a parent's
 * click-to-close only fires for plain taps on the empty stage. Zoom resets when
 * `src` changes.
 */
export function ZoomableImage({
  src,
  alt,
  className = "",
  imageClassName = "",
  imageTestId,
  onSwipe,
}: ZoomableImageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const transformRef = useRef<ZoomTransform>({ scale: 1, x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, Point>());
  const gestureRef = useRef<Gesture | null>(null);
  // A tap is a single pointer that went down and up without moving.
  const tapRef = useRef<{ point: Point; valid: boolean } | null>(null);
  const lastTapRef = useRef<{ point: Point; time: number } | null>(null);
  const suppressClickRef = useRef(false);
  // A one-finger touch drag that began on the unzoomed image, until a second finger joins.
  const swipeRef = useRef<{ start: Point; time: number } | null>(null);

  // Image layout position with the current transform removed. The transform
  // origin is the image's top-left corner, so translation is the only offset.
  const imageOrigin = (): Point => {
    const rect = imageRef.current?.getBoundingClientRect();
    const { x, y } = transformRef.current;
    return { x: (rect?.left ?? 0) - x, y: (rect?.top ?? 0) - y };
  };

  const applyTransform = (next: ZoomTransform, animate = false) => {
    const image = imageRef.current;
    if (!image) return;
    const scale = next.scale < 1.01 ? 1 : Math.min(next.scale, MAX_SCALE);
    // Keep the zoomed image covering its unzoomed box so it cannot be dragged away.
    const x = clamp(next.x, image.offsetWidth * (1 - scale), 0);
    const y = clamp(next.y, image.offsetHeight * (1 - scale), 0);
    transformRef.current = { scale, x, y };
    image.style.transition = animate ? "transform 150ms ease-out" : "";
    image.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    image.style.cursor = scale > 1 ? "grab" : "";
  };

  // Scale to `scale` while moving the content point that was under `from` to `to`.
  const transformAround = (start: ZoomTransform, from: Point, to: Point, scale: number): ZoomTransform => {
    const origin = imageOrigin();
    const contentX = (from.x - origin.x - start.x) / start.scale;
    const contentY = (from.y - origin.y - start.y) / start.scale;
    return { scale, x: to.x - origin.x - contentX * scale, y: to.y - origin.y - contentY * scale };
  };

  const zoomAt = (scale: number, point: Point, animate = false) => {
    applyTransform(transformAround(transformRef.current, point, point, scale), animate);
  };

  // Restart the gesture from the current transform whenever the pointer set changes,
  // so adding or lifting a finger continues smoothly instead of jumping.
  const beginGesture = () => {
    const points = [...pointersRef.current.values()];
    gestureRef.current =
      points.length === 0
        ? null
        : { start: { ...transformRef.current }, anchor: centroid(points), spread: spread(points) };
  };

  useEffect(() => {
    applyTransform({ scale: 1, x: 0, y: 0 });
  }, [src]);

  // Slide the unzoomed image sideways with the finger; applyTransform's clamp would pin it.
  const showSwipeOffset = (dx: number, animate = false) => {
    const image = imageRef.current;
    if (!image) return;
    image.style.transition = animate ? "transform 150ms ease-out" : "";
    image.style.transform = dx === 0 ? "translate(0px, 0px) scale(1)" : `translate(${dx}px, 0px) scale(1)`;
  };

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // React wheel listeners are passive, so preventing page scroll needs a native one.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      // Trackpad pinches arrive as ctrl+wheel with small deltas.
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      zoomAt(transformRef.current.scale * factor, { x: event.clientX, y: event.clientY });
    };
    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    const firstPointer = pointersRef.current.size === 1;
    tapRef.current = firstPointer ? { point, valid: true } : null;
    // Pointer capture retargets the click to the stage, so remember whether the gesture began on the image.
    if (firstPointer) suppressClickRef.current = event.target === imageRef.current;
    // A second finger turns a swipe into a pinch, starting from the unshifted image.
    if (swipeRef.current) showSwipeOffset(0);
    swipeRef.current =
      firstPointer && onSwipe && event.pointerType !== "mouse" && transformRef.current.scale === 1
        ? { start: point, time: Date.now() }
        : null;
    beginGesture();
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    const gesture = gestureRef.current;
    if (!gesture || !pointers.has(event.pointerId)) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);
    const tap = tapRef.current;
    if (tap?.valid && distance(tap.point, point) > TAP_SLOP_PX) tap.valid = false;
    if (tap?.valid) return;

    suppressClickRef.current = true;
    if (swipeRef.current) {
      showSwipeOffset(point.x - swipeRef.current.start.x);
      return;
    }
    const points = [...pointers.values()];
    const currentSpread = spread(points);
    const scale =
      gesture.spread > 0 && currentSpread > 0
        ? (gesture.start.scale * currentSpread) / gesture.spread
        : gesture.start.scale;
    applyTransform(transformAround(gesture.start, gesture.anchor, centroid(points), scale));
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.delete(event.pointerId)) return;
    beginGesture();
    const swipe = swipeRef.current;
    swipeRef.current = null;
    if (swipe) {
      const dx = event.clientX - swipe.start.x;
      const dy = event.clientY - swipe.start.y;
      const isFlick = Date.now() - swipe.time < FLICK_MS && Math.abs(dx) >= FLICK_DISTANCE_PX;
      const isSwipe =
        event.type !== "pointercancel" && Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) >= SWIPE_DISTANCE_PX || isFlick);
      showSwipeOffset(0, !isSwipe);
      if (isSwipe) onSwipe?.(dx < 0 ? "next" : "previous");
    }
    const tap = tapRef.current;
    if (pointersRef.current.size > 0 || !tap?.valid) return;
    tapRef.current = null;

    const lastTap = lastTapRef.current;
    const now = Date.now();
    if (!lastTap || now - lastTap.time > DOUBLE_TAP_MS || distance(lastTap.point, tap.point) > DOUBLE_TAP_DISTANCE_PX) {
      lastTapRef.current = { point: tap.point, time: now };
      return;
    }
    lastTapRef.current = null;
    suppressClickRef.current = true;
    zoomAt(transformRef.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE, tap.point, true);
  };

  const handleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current || event.target === imageRef.current) event.stopPropagation();
    suppressClickRef.current = false;
  };

  return (
    <div
      ref={stageRef}
      className={className}
      style={{ touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClick={handleClick}
      data-testid="zoomable-image-stage"
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        className={imageClassName}
        style={{ transformOrigin: "0 0" }}
        draggable={false}
        data-testid={imageTestId}
      />
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function spread(points: Point[]) {
  return points.length < 2 ? 0 : distance(points[0], points[1]);
}
