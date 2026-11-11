/**
 * The painted scene of a scenic background, drawn in layers that take no taps:
 * - `ScenicBackdrop` paints the scene behind the conversation: a hand-painted landscape (a tall
 *   version on narrow panes such as phones) that breathes with a very slow camera drift, a cloud,
 *   haze or mist layer drifting in front of it, warm light rays, a reading veil where the text
 *   sits, gentle pointer parallax on desktop, and small lights (pollen, fireflies, glints).
 *   Ink & Paper is instead a living painting drawn with WebGL (`ink-alive/`): clouds and ink flow
 *   slowly, and now and then cranes cross or ink blooms into a cloud. Without WebGL it falls back
 *   to its still painting.
 * - `ScenicPanels` lays the same painting, faded, under the sessions panel and the side column.
 * The paintings are bundled WebP files that load only when a style is on, and only the day or the
 * night one for the theme in use. Lights run on one canvas at about 30 frames a second and pause
 * while the page is hidden; nothing moves with reduced motion, and both render nothing when the
 * setting is Off.
 */
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { InkAliveCanvas } from "./ink-alive/InkAliveCanvas.js";
import { SCENIC_REVEAL_EVENT, type ScenicStyle, scenicMotionAllowed, useScenicStyle } from "./scenic-styles.js";

type LightKind = "pollen" | "firefly" | "glint" | "glint-night";

interface SceneArt {
  /** A transparent painted layer that drifts slowly in front of the painting. */
  drift: { edge: "top" | "bottom"; height: string; opacity: [number, number] };
  /** Warm light rays from an upper corner, in the light theme only. */
  rays: "left" | "right" | null;
  /** Small lights behind the text, day and night, and how far down the pane they start. */
  lights: [LightKind | null, LightKind | null];
  lightsFrom: number;
}

/** A bundled scenic image by name. The version in the name lets browsers keep it for good. */
export function scenicAsset(name: string): string {
  return `/scenic/${name}.v${ASSET_VERSIONS[name] ?? 1}.webp`;
}

/** Files repainted since they first shipped; a new version makes browsers fetch the new image. */
const ASSET_VERSIONS: Record<string, number> = { "ink-day-thumb": 2, "ink-night-thumb": 2 };

const SCENES: Record<ScenicStyle, SceneArt> = {
  meadow: {
    drift: { edge: "top", height: "46%", opacity: [0.4, 0.22] },
    rays: "left",
    lights: ["pollen", "firefly"],
    lightsFrom: 0.15,
  },
  seaside: {
    drift: { edge: "top", height: "50%", opacity: [0.45, 0.25] },
    rays: "right",
    lights: ["glint", "glint-night"],
    lightsFrom: 0.72,
  },
  ink: {
    drift: { edge: "bottom", height: "58%", opacity: [0.6, 0.5] },
    rays: null,
    lights: [null, null],
    lightsFrom: 0,
  },
};

const DRIFT_LAYERS: Record<ScenicStyle, string> = { meadow: "clouds", seaside: "haze", ink: "mist" };

/** The painting for a style, day or night, wide or tall. */
export function scenicPainting(style: ScenicStyle, dark: boolean, tall: boolean): string {
  return scenicAsset(`${style}-${dark ? "night" : "day"}${tall ? "-portrait" : ""}`);
}

/** Lays the active painting, faded, under the sessions panel and the side column. */
export function ScenicPanels() {
  const style = useScenicStyle();
  const dark = useStore((state) => state.darkMode);
  useEffect(() => {
    if (!style) return;
    const root = document.documentElement.style;
    root.setProperty("--scenic-plate", `url("${scenicPainting(style, dark, false)}")`);
    return () => {
      root.removeProperty("--scenic-plate");
    };
  }, [style, dark]);
  return null;
}

/** The painted scene behind the conversation; sits inside the conversation pane. */
export function ScenicBackdrop() {
  const style = useScenicStyle();
  const dark = useStore((state) => state.darkMode);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [style]);
  useParallax(ref, style !== null);
  const [aliveFailed, setAliveFailed] = useState(false);
  const onAliveUnavailable = useCallback(() => setAliveFailed(true), []);
  if (!style) return null;
  // Ink & Paper is a living painting drawn with WebGL; without WebGL it shows its still painting.
  const alive = style === "ink" && !aliveFailed;
  const art = SCENES[style];
  const motion = scenicMotionAllowed();
  const lights = art.lights[dark ? 1 : 0];
  // Panes taller than wide (phones, narrow windows) get the tall painting, composed for them.
  const tall = size.height > size.width * 1.15;
  // No z-index: the backdrop paints first among the pane's positioned children, and the feed's
  // `relative` layout after it paints on top. A z-index here would need an isolated (stacking
  // context) pane, which traps the menus inside it under the content around it.
  return (
    <div
      ref={ref}
      aria-hidden="true"
      data-testid="scenic-backdrop"
      data-scenic-style={style}
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      {alive && <InkAliveCanvas dark={dark} motion={motion} onUnavailable={onAliveUnavailable} />}
      {!alive && (
        <Layer depth={5}>
          <div
            data-testid="scenic-painting"
            className="absolute inset-[-3%]"
            style={{
              backgroundImage: `url("${scenicPainting(style, dark, tall)}")`,
              backgroundSize: "cover",
              backgroundPosition: "center bottom",
              transformOrigin: "50% 100%",
              animation: motion ? "scenic-camera 90s ease-in-out infinite alternate" : undefined,
            }}
          />
        </Layer>
      )}
      {!alive && (
        <Layer depth={16}>
          <div
            data-testid="scenic-drift"
            className="absolute left-[-15%] right-[-15%]"
            style={{
              [art.drift.edge]: 0,
              height: art.drift.height,
              backgroundImage: `url("${scenicAsset(`${style}-${DRIFT_LAYERS[style]}`)}")`,
              backgroundSize: "100% 100%",
              opacity: art.drift.opacity[dark ? 1 : 0],
              maskImage:
                art.drift.edge === "top"
                  ? "linear-gradient(black 55%, transparent)"
                  : "linear-gradient(transparent, black 45%)",
              animation: motion ? "scenic-float 140s ease-in-out infinite alternate" : undefined,
            }}
          />
        </Layer>
      )}
      {art.rays && !dark && <Rays side={art.rays} motion={motion} />}
      {/* The living ink keeps its moments off the reading column, so a lighter veil reads as well. */}
      <Veil width={size.width} strength={alive ? 0.72 : 1} />
      {motion && lights && <LightCanvas kind={lights} from={art.lightsFrom} />}
    </div>
  );
}

/** A full-size layer that shifts with the pointer by up to `depth` pixels: nearer layers move more. */
function Layer({ depth, children }: { depth: number; children: ReactNode }) {
  return (
    <div
      className="absolute inset-0"
      style={{
        transform: `translate3d(calc(var(--scenic-mx, 0) * ${-depth}px), calc(var(--scenic-my, 0) * ${-depth * 0.5}px), 0)`,
        transition: "transform 1.6s cubic-bezier(0.2, 0.6, 0.2, 1)",
      }}
    >
      {children}
    </div>
  );
}

/** Soft sun rays fanning from an upper corner, slowly breathing. */
function Rays({ side, motion }: { side: "left" | "right"; motion: boolean }) {
  const at = side === "left" ? "0% 0%" : "100% 0%";
  const from = side === "left" ? 95 : 175;
  return (
    <div
      className="absolute inset-0"
      style={{
        background: `repeating-conic-gradient(from ${from}deg at ${at}, rgba(255,244,214,0) 0deg, rgba(255,244,214,0.22) 2.5deg, rgba(255,244,214,0) 6deg, rgba(255,244,214,0) 9deg)`,
        maskImage: `radial-gradient(circle at ${at}, black 0%, rgba(0,0,0,0.5) 35%, transparent 70%)`,
        transformOrigin: at,
        animation: motion ? "scenic-rays 16s ease-in-out infinite alternate" : undefined,
      }}
    />
  );
}

/**
 * Keeps the text readable: a soft band of the page colour where the conversation column sits,
 * thinner at the top and bottom so the sky and the land stay vivid there. Narrow panes get it
 * across their whole width.
 */
function Veil({ width, strength }: { width: number; strength: number }) {
  const ref = useRef<HTMLDivElement>(null);
  // While a quest-finishing fanfare plays, the veil lifts and the whole painting shows.
  useEffect(() => {
    const reveal = () => {
      const base = Number(ref.current?.style.opacity || 1);
      ref.current?.animate?.(
        [{ opacity: base }, { opacity: 0.12, offset: 0.2 }, { opacity: 0.12, offset: 0.75 }, { opacity: base }],
        { duration: 3600, easing: "ease-in-out" },
      );
    };
    window.addEventListener(SCENIC_REVEAL_EVENT, reveal);
    return () => window.removeEventListener(SCENIC_REVEAL_EVENT, reveal);
  }, []);
  const half = Math.min(width / 2, 430);
  const feather = 120;
  const background =
    width < 760
      ? "var(--scenic-veil)"
      : `linear-gradient(90deg, transparent calc(50% - ${half + feather}px), var(--scenic-veil) calc(50% - ${half}px), var(--scenic-veil) calc(50% + ${half}px), transparent calc(50% + ${half + feather}px))`;
  return (
    <div
      ref={ref}
      data-testid="scenic-veil"
      className="absolute inset-0"
      style={{
        background,
        opacity: strength,
        maskImage:
          // Stops stay in order on short panes too, so the veil never shows a hard edge.
          "linear-gradient(to bottom, rgba(0,0,0,0.3) 0px, rgba(0,0,0,0.92) min(190px, 25%), black 50%, rgba(0,0,0,0.94) max(calc(100% - 200px), 75%), rgba(0,0,0,0.55) 100%)",
      }}
    />
  );
}

/** Pointer parallax on desktop: sets --scenic-mx and --scenic-my in [-1, 1] on the backdrop. */
function useParallax(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !scenicMotionAllowed() || !window.matchMedia?.("(pointer: fine)").matches) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const move = (event: PointerEvent) => {
      x = (event.clientX / window.innerWidth) * 2 - 1;
      y = (event.clientY / window.innerHeight) * 2 - 1;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        ref.current?.style.setProperty("--scenic-mx", x.toFixed(3));
        ref.current?.style.setProperty("--scenic-my", y.toFixed(3));
      });
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(frame);
    };
  }, [ref, enabled]);
}

// ─── Small lights ─────────────────────────────────────────────────────────────

interface Light {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  phase: number;
  color: string;
}

interface LightLook {
  count: number;
  colors: string[];
  size: [number, number];
  speed: number;
  draw: (context: CanvasRenderingContext2D, light: Light) => void;
}

function drawGlow(context: CanvasRenderingContext2D, light: Light) {
  const radius = light.size * 5;
  const glow = context.createRadialGradient(light.x, light.y, 0, light.x, light.y, radius);
  glow.addColorStop(0, light.color);
  // Fade to the same colour, fully transparent: fading to transparent black leaves a grey halo.
  glow.addColorStop(1, light.color.replace(/[\d.]+\)$/, "0)"));
  context.fillStyle = glow;
  context.beginPath();
  context.arc(light.x, light.y, radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "rgba(255,252,232,0.95)";
  context.beginPath();
  context.arc(light.x, light.y, light.size * 0.6, 0, Math.PI * 2);
  context.fill();
}

function drawGlint(context: CanvasRenderingContext2D, light: Light) {
  const { x, y } = light;
  const s = light.size * 3.4;
  context.fillStyle = light.color;
  context.beginPath();
  context.moveTo(x, y - s);
  context.quadraticCurveTo(x, y, x + s, y);
  context.quadraticCurveTo(x, y, x, y + s);
  context.quadraticCurveTo(x, y, x - s, y);
  context.quadraticCurveTo(x, y, x, y - s);
  context.fill();
}

const LOOKS: Record<LightKind, LightLook> = {
  pollen: {
    count: 16,
    colors: ["rgba(255,236,170,0.55)", "rgba(255,248,214,0.5)"],
    size: [1, 1.8],
    speed: 7,
    draw: drawGlow,
  },
  firefly: {
    count: 16,
    colors: ["rgba(232,246,140,0.6)", "rgba(255,226,120,0.55)"],
    size: [1.4, 2.6],
    speed: 8,
    draw: drawGlow,
  },
  glint: {
    count: 14,
    colors: ["rgba(255,255,255,0.95)", "rgba(255,246,214,0.95)"],
    size: [1, 2],
    speed: 2,
    draw: drawGlint,
  },
  "glint-night": {
    count: 12,
    colors: ["rgba(220,235,255,0.9)", "rgba(255,246,214,0.85)"],
    size: [0.9, 1.8],
    speed: 2,
    draw: drawGlint,
  },
};

/** Lights hovering below `from` of the pane's height, wandering and pulsing slowly. */
function LightCanvas({ kind, from }: { kind: LightKind; from: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const look = LOOKS[kind];
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const place = (light: Light) => {
      light.x = Math.random() * width;
      light.y = height * from + Math.random() * height * (1 - from);
      light.vx = (Math.random() - 0.5) * look.speed;
      light.vy = (Math.random() - 0.5) * look.speed * 0.7;
    };
    const count = width < 640 ? Math.round(look.count * 0.6) : look.count;
    const lights: Light[] = Array.from({ length: count }, () => {
      const [low, high] = look.size;
      const light = {
        phase: Math.random() * Math.PI * 2,
        size: low + Math.random() * (high - low),
        alpha: 0.6 + Math.random() * 0.4,
        color: look.colors[Math.floor(Math.random() * look.colors.length)]!,
      } as Light;
      place(light);
      return light;
    });
    let frame = 0;
    let last = performance.now();
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const elapsed = (now - last) / 1000;
      if (elapsed < 1 / 30) return;
      last = now;
      if (document.hidden) return;
      context.clearRect(0, 0, width, height);
      for (const light of lights) {
        light.phase += elapsed * 1.2;
        light.x += light.vx * elapsed;
        light.y += light.vy * elapsed;
        if (light.x < -20 || light.x > width + 20 || light.y < height * from - 20 || light.y > height + 20) {
          place(light);
        }
        context.globalAlpha = light.alpha * Math.max(0, Math.sin(light.phase)) ** 2;
        look.draw(context, light);
      }
    };
    frame = requestAnimationFrame(draw);
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [kind, from]);
  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
