import { useEffect, useRef } from "react";
import { startInkAlive } from "./ink-alive-gl.js";

/**
 * The living Ink & Paper scene on a canvas filling its parent. `onUnavailable` reports when it
 * cannot run: `retry` is true for a failure that may pass (a lost WebGL context, a layer that did
 * not load), false where it cannot run at all (no WebGL, or its shader does not compile here).
 */
export function InkAliveCanvas({
  dark,
  motion,
  onUnavailable,
}: {
  dark: boolean;
  motion: boolean;
  onUnavailable: (retry: boolean) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const stop = startInkAlive(canvas, { dark, motion, onFail: () => onUnavailable(true) });
    if (!stop) onUnavailable(false);
    return () => stop?.();
  }, [dark, motion, onUnavailable]);
  return <canvas ref={ref} data-testid="scenic-ink-alive" className="absolute inset-0 h-full w-full" />;
}
