const TOUCH_KEYBOARD_MEDIA = "(hover: none) and (pointer: coarse)";
const LATE_VIEWPORT_UPDATE_DELAYS_MS = [80, 250];

export interface AppViewportMetrics {
  isTouchKeyboard: boolean;
  layoutViewportHeight: number | null;
  visualViewportHeight: number | null;
}

export function resolveAppViewportHeight(metrics: AppViewportMetrics): string {
  if (!metrics.isTouchKeyboard) return "100dvh";

  const visualHeight = normalizeViewportLength(metrics.visualViewportHeight);
  if (visualHeight == null) return "100dvh";

  const layoutHeight = normalizeViewportLength(metrics.layoutViewportHeight);
  const height = layoutHeight == null ? visualHeight : Math.min(visualHeight, layoutHeight);
  return `${roundCssPx(height)}px`;
}

export function readAppViewportMetrics(win: Window): AppViewportMetrics {
  return {
    isTouchKeyboard: isTouchKeyboardViewport(win),
    layoutViewportHeight: win.innerHeight,
    visualViewportHeight: win.visualViewport?.height ?? null,
  };
}

export function installAppViewportSizing(win: Window): () => void {
  const html = win.document.documentElement;
  const body = win.document.body;
  const root = win.document.getElementById("root");
  const timeouts = new Set<number>();
  let animationFrame: number | null = null;

  html.style.overflow = "hidden";
  html.style.width = "100vw";
  body.style.height = "100%";
  body.style.width = "100%";
  body.style.margin = "0";
  if (root) {
    root.style.height = "100%";
    root.style.width = "100%";
  }

  const apply = () => {
    html.style.height = resolveAppViewportHeight(readAppViewportMetrics(win));
  };

  const schedule = () => {
    apply();
    if (animationFrame != null && typeof win.cancelAnimationFrame === "function") {
      win.cancelAnimationFrame(animationFrame);
    }
    if (typeof win.requestAnimationFrame !== "function") return;
    animationFrame = win.requestAnimationFrame(() => {
      animationFrame = null;
      apply();
    });
  };

  const scheduleLate = () => {
    schedule();
    for (const delay of LATE_VIEWPORT_UPDATE_DELAYS_MS) {
      const timeout = win.setTimeout(() => {
        timeouts.delete(timeout);
        apply();
      }, delay);
      timeouts.add(timeout);
    }
  };

  schedule();

  win.addEventListener("resize", schedule);
  win.addEventListener("orientationchange", scheduleLate);
  win.document.addEventListener("focusin", scheduleLate);
  win.document.addEventListener("focusout", scheduleLate);
  win.visualViewport?.addEventListener("resize", schedule);
  win.visualViewport?.addEventListener("scroll", schedule);

  return () => {
    win.removeEventListener("resize", schedule);
    win.removeEventListener("orientationchange", scheduleLate);
    win.document.removeEventListener("focusin", scheduleLate);
    win.document.removeEventListener("focusout", scheduleLate);
    win.visualViewport?.removeEventListener("resize", schedule);
    win.visualViewport?.removeEventListener("scroll", schedule);
    if (animationFrame != null && typeof win.cancelAnimationFrame === "function") {
      win.cancelAnimationFrame(animationFrame);
    }
    for (const timeout of timeouts) {
      win.clearTimeout(timeout);
    }
  };
}

function isTouchKeyboardViewport(win: Window): boolean {
  return win.matchMedia?.(TOUCH_KEYBOARD_MEDIA).matches ?? false;
}

function normalizeViewportLength(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function roundCssPx(value: number): number {
  return Math.round(value * 100) / 100;
}
