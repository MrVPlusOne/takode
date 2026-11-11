// @vitest-environment jsdom
/**
 * Scenic backgrounds: the server-saved setting in the store, the classes on <html>, the painted
 * scene behind the conversation (day/night, wide/tall, reduced motion), the side panels' painting,
 * the fanfares, and the Settings picker. Off must add nothing, so several tests check that.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockUpdateSettings = vi.hoisted(() => vi.fn());

vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return { ...actual, api: { ...actual.api, updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) } };
});

import { useStore } from "../store.js";
import { SettingsScenicBackgroundSection } from "../components/SettingsScenicBackgroundSection.js";
import { ScenicBackdrop, ScenicPanels, scenicAsset, scenicPainting } from "./ScenicBackdrop.js";
import { playScenicMoment } from "./scenic-moments.js";
import { SCENIC_REVEAL_EVENT, applyScenicClass } from "./scenic-styles.js";
import scenicCss from "./scenic.css?raw";

/** Pane size the ResizeObserver stub reports to the backdrop. */
let paneSize = { width: 1000, height: 800 };
let reducedMotion = false;

beforeEach(() => {
  paneSize = { width: 1000, height: 800 };
  reducedMotion = false;
  mockUpdateSettings.mockReset().mockResolvedValue({});
  useStore.setState({ scenicBackground: "off", darkMode: false });
  globalThis.ResizeObserver = class {
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(target: Element) {
      Object.defineProperty(target, "clientWidth", { configurable: true, value: paneSize.width });
      Object.defineProperty(target, "clientHeight", { configurable: true, value: paneSize.height });
      this.callback([], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduced-motion") ? reducedMotion : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  // jsdom has no canvas; the lights simply skip drawing.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
  HTMLElement.prototype.animate = vi.fn(() => ({ cancel() {}, finish() {} })) as unknown as HTMLElement["animate"];
});

afterEach(() => {
  cleanup();
  applyScenicClass("off");
  document.querySelectorAll("[data-scenic-moment]").forEach((layer) => layer.remove());
});

describe("scenic background setting", () => {
  it("saves a choice on the server and goes back to the previous one when saving fails", async () => {
    // The store updates at once so the scene appears immediately; a failed save must not leave
    // the browser showing a background the server never stored.
    useStore.getState().setScenicBackground("meadow");
    expect(useStore.getState().scenicBackground).toBe("meadow");
    expect(mockUpdateSettings).toHaveBeenCalledWith({ scenicBackground: "meadow" });

    mockUpdateSettings.mockRejectedValueOnce(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    useStore.getState().setScenicBackground("ink");
    await vi.waitFor(() => expect(useStore.getState().scenicBackground).toBe("meadow"));
  });

  it("puts one style's classes on <html> and removes them all for Off", () => {
    applyScenicClass("seaside");
    expect(document.documentElement.classList.contains("scenic")).toBe(true);
    expect(document.documentElement.classList.contains("scenic-seaside")).toBe(true);
    applyScenicClass("ink");
    expect(document.documentElement.classList.contains("scenic-seaside")).toBe(false);
    expect(document.documentElement.classList.contains("scenic-ink")).toBe(true);
    applyScenicClass("off");
    expect([...document.documentElement.classList].some((name) => name.startsWith("scenic"))).toBe(false);
  });
});

describe("ScenicBackdrop", () => {
  it("renders nothing when the setting is Off", () => {
    const { container } = render(<ScenicBackdrop />);
    expect(container).toBeEmptyDOMElement();
  });

  it("paints the day painting in the light theme and the night one in the dark theme", () => {
    useStore.setState({ scenicBackground: "meadow" });
    render(<ScenicBackdrop />);
    expect(screen.getByTestId("scenic-painting").style.backgroundImage).toContain(
      scenicPainting("meadow", false, false),
    );
    expect(screen.getByTestId("scenic-drift").style.backgroundImage).toContain("/scenic/meadow-clouds.v1.webp");

    act(() => useStore.setState({ darkMode: true }));
    expect(screen.getByTestId("scenic-painting").style.backgroundImage).toContain("/scenic/meadow-night.v1.webp");
  });

  it("uses the tall painting on a pane taller than it is wide, as on a phone", () => {
    paneSize = { width: 400, height: 800 };
    useStore.setState({ scenicBackground: "seaside" });
    render(<ScenicBackdrop />);
    expect(screen.getByTestId("scenic-painting").style.backgroundImage).toContain(
      "/scenic/seaside-day-portrait.v1.webp",
    );
  });

  it("shows Ink & Paper's still painting where the living painting cannot run without WebGL", () => {
    // jsdom has no WebGL, like a browser with it turned off: the living canvas gives way to the
    // painting instead of leaving the pane blank.
    useStore.setState({ scenicBackground: "ink" });
    render(<ScenicBackdrop />);
    expect(screen.queryByTestId("scenic-ink-alive")).toBeNull();
    expect(screen.getByTestId("scenic-painting").style.backgroundImage).toContain("/scenic/ink-day.v1.webp");
  });

  it("asks for the repainted Ink & Paper thumbnails by their new version", () => {
    // Scenic files are cached for good, so a repainted file must change its name.
    expect(scenicAsset("ink-day-thumb")).toBe("/scenic/ink-day-thumb.v2.webp");
    expect(scenicAsset("meadow-day-thumb")).toBe("/scenic/meadow-day-thumb.v1.webp");
  });

  it("keeps the painting still and draws no lights with reduced motion", () => {
    reducedMotion = true;
    useStore.setState({ scenicBackground: "meadow" });
    const { container } = render(<ScenicBackdrop />);
    expect(screen.getByTestId("scenic-painting").style.animation).toBe("");
    expect(screen.getByTestId("scenic-drift").style.animation).toBe("");
    expect(container.querySelector("canvas")).toBeNull();
  });
});

describe("ScenicPanels", () => {
  it("gives the side panels the painting while a style is on and clears it for Off", () => {
    useStore.setState({ scenicBackground: "ink", darkMode: true });
    render(<ScenicPanels />);
    expect(document.documentElement.style.getPropertyValue("--scenic-plate")).toContain("/scenic/ink-night.v1.webp");
    act(() => useStore.setState({ scenicBackground: "off" }));
    expect(document.documentElement.style.getPropertyValue("--scenic-plate")).toBe("");
  });
});

describe("playScenicMoment", () => {
  const quest = { kind: "quest-complete", questId: "q-1", title: "Calm water" } as const;

  it("plays nothing when the setting is Off or with reduced motion", () => {
    playScenicMoment(quest, null);
    expect(document.querySelector("[data-scenic-moment]")).toBeNull();

    useStore.setState({ scenicBackground: "meadow" });
    reducedMotion = true;
    playScenicMoment(quest, null);
    expect(document.querySelector("[data-scenic-moment]")).toBeNull();
  });

  it("lifts the reading veil and shows the quest's title when a quest finishes", () => {
    useStore.setState({ scenicBackground: "meadow" });
    const reveal = vi.fn();
    window.addEventListener(SCENIC_REVEAL_EVENT, reveal);
    playScenicMoment(quest, null);
    window.removeEventListener(SCENIC_REVEAL_EVENT, reveal);
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-scenic-moment]")?.textContent).toContain("Calm water");
  });

  it("plays a small landing without lifting the veil", () => {
    useStore.setState({ scenicBackground: "seaside" });
    const reveal = vi.fn();
    window.addEventListener(SCENIC_REVEAL_EVENT, reveal);
    playScenicMoment({ kind: "landed" }, null);
    window.removeEventListener(SCENIC_REVEAL_EVENT, reveal);
    expect(reveal).not.toHaveBeenCalled();
    expect(document.querySelector("[data-scenic-moment]")).not.toBeNull();
  });
});

describe("SettingsScenicBackgroundSection", () => {
  it("offers Off and the three styles, marks the saved one and saves a new pick", () => {
    useStore.setState({ scenicBackground: "off" });
    render(<SettingsScenicBackgroundSection />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((radio) => radio.textContent)).toEqual(["Off", "Summer Meadow", "Seaside Town", "Ink & Paper"]);
    expect(screen.getByRole("radio", { name: "Off" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("radio", { name: "Seaside Town" }));
    expect(mockUpdateSettings).toHaveBeenCalledWith({ scenicBackground: "seaside" });
    expect(screen.getByRole("radio", { name: "Seaside Town" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("layering", () => {
  // Menus, popovers and hover cards rely on their z-index counting across the page. A property
  // that makes a stacking context on a styled container (the status-row bar's backdrop blur once
  // did) confines their z-index to that container, and the conversation after it then covers the
  // open menu. The keyframes only animate the backdrop's own layers, so they are left out.
  it("adds no stacking context to the page's own elements", () => {
    const css = scenicCss
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const stacking =
      /(?:^|[;{\s])(isolation|z-index|transform|filter|backdrop-filter|opacity|will-change|perspective|contain|mix-blend-mode|clip-path|mask(?:-image)?)\s*:/g;
    expect([...css.matchAll(stacking)].map((match) => match[1])).toEqual([]);
  });

  it("keeps the backdrop out of the stacking order so the conversation after it paints on top", () => {
    useStore.setState({ scenicBackground: "ink" });
    render(<ScenicBackdrop />);
    const backdrop = screen.getByTestId("scenic-backdrop");
    expect(backdrop.className).not.toMatch(/(?:^|\s)-?z-/);
    expect(backdrop.style.zIndex).toBe("");
  });
});
