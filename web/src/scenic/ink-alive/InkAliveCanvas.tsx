import { useEffect, useRef } from "react";
import { startInkAlive } from "./ink-alive-gl.js";

/** The living Ink & Paper scene on a canvas filling its parent. */
export function InkAliveCanvas({
  dark,
  motion,
  onUnavailable,
}: {
  dark: boolean;
  motion: boolean;
  onUnavailable: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const stop = startInkAlive(canvas, { dark, motion, onFail: onUnavailable });
    if (!stop) onUnavailable();
    return () => stop?.();
  }, [dark, motion, onUnavailable]);
  return <canvas ref={ref} data-testid="scenic-ink-alive" className="absolute inset-0 h-full w-full" />;
}
