import { useEffect, useRef } from "react";
import { type InkPalette, startInkAlive } from "./ink-alive-gl.js";

/** The living Ink & Paper scene on a canvas filling its parent, in ink or washed with colour by day. */
export function InkAliveCanvas({
  dark,
  motion,
  palette,
  onUnavailable,
}: {
  dark: boolean;
  motion: boolean;
  palette: InkPalette;
  onUnavailable: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const stop = startInkAlive(canvas, { dark, motion, palette, onFail: onUnavailable });
    if (!stop) onUnavailable();
    return () => stop?.();
  }, [dark, motion, palette, onUnavailable]);
  return <canvas ref={ref} data-testid="scenic-ink-alive" className="absolute inset-0 h-full w-full" />;
}
