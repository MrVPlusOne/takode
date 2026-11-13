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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeScenicBackground } from "../../shared/scenic-background.js";
import { SCENIC_REVEAL_EVENT, applyScenicClass } from "./scenic-styles.js";

// Read from disk: Vitest turns a raw stylesheet import into an empty string, so a check on it passed
// whatever the stylesheet held.
const scenicCss = readFileSync(join(__dirname, "scenic.css"), "utf8");
const appCss = readFileSync(join(__dirname, "..", "index.css"), "utf8");

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

  // Ink & Colour was merged into Ink & Paper, which is now the colour version, so a saved
  // Ink & Colour choice keeps showing that painting.
  it("reads a saved Ink & Colour choice as Ink & Paper", () => {
    expect(normalizeScenicBackground("inkColor")).toBe("ink");
    expect(normalizeScenicBackground("sakura")).toBe("off");
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
    expect(scenicAsset("ink-day-thumb")).toBe("/scenic/ink-day-thumb.v3.webp");
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
  it("offers Off and each style, marks the saved one and saves a new pick", () => {
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

describe("message times", () => {
  // On a wide feed, message times normally sit in the left margin beside the paper column. With
  // a scenic background that margin shows the painting, where a time was hard to read, so every
  // margin placement must be limited to feeds without one; times then sit with their messages.
  it("moves message times into the feed's margin only without a scenic background", () => {
    const block = appCss.match(/@container feed \(min-width: 59rem\) \{([\s\S]*?)\n\}/)?.[1];
    expect(block).toBeTruthy();
    const selectors = [...block!.matchAll(/^\s*([^{}]+?)\s*\{/gm)].map((match) => match[1]);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) expect(selector).toMatch(/^html:not\(\.scenic\) /);
  });
});

/** Every rule of a stylesheet (comments and keyframes removed) as its selector list and body. */
function cssRules(source: string): { selectors: string[]; body: string }[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => {
    const selectors: string[] = [];
    let depth = 0;
    let current = "";
    for (const char of match[1]!) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        selectors.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    selectors.push(current.trim());
    return { selectors: selectors.filter(Boolean), body: match[2]! };
  });
}

describe("message sheets", () => {
  const rules = cssRules(scenicCss);

  it("styles nothing while the setting is Off", () => {
    // Off must look exactly as before: every selector needs a scenic class from <html>.
    const selectors = rules.flatMap((rule) => rule.selectors);
    expect(selectors.length).toBeGreaterThan(20);
    expect(selectors.filter((selector) => !/\.scenic\b|\.scenic-/.test(selector))).toEqual([]);
  });

  it("gives each message its own sheet and leaves the gaps between them clear", () => {
    // One opaque sheet under the whole conversation hid nearly all of the painting on a phone, so
    // the conversation column itself must have no backing; turn items and answer cards carry it.
    const columnRules = rules.filter((rule) =>
      rule.selectors.some((selector) => /\[data-feed-content-root="true"\]$/.test(selector)),
    );
    expect(columnRules.length).toBeGreaterThan(0);
    for (const rule of columnRules) expect(rule.body).not.toMatch(/background|box-shadow/);

    const sheeted = rules
      .filter((rule) => /background:\s*var\(--scenic-sheet\)/.test(rule.body))
      .flatMap((rule) => rule.selectors);
    expect(sheeted.some((selector) => /\.turn-container > :where\(:not\(/.test(selector))).toBe(true);
    expect(sheeted.some((selector) => /\.turn-container > \* > \.rounded-xl$/.test(selector))).toBe(true);
  });

  it("never changes the app's fonts", () => {
    // Jiayi found a serif on Ink & Paper's quest strip and on headings maddening: the messages with
    // headings looked foreign beside the rest. The scenic stylesheets keep every font as it is.
    const inkCss = readFileSync(join(__dirname, "ink-textures.css"), "utf8");
    for (const css of [scenicCss, inkCss]) {
      const fonts = cssRules(css).flatMap((rule) => [...rule.body.matchAll(/(?:^|[;\s])(font(?:-family)?)\s*:/g)]);
      expect(fonts.map((match) => match[1])).toEqual([]);
    }
    // The celebrations build their styles in code; their seals are drawn from outlines, not a font.
    for (const file of ["scenic-moments.ts", "ink-celebration.ts"]) {
      const code = readFileSync(join(__dirname, file), "utf8");
      expect(code.match(/fontFamily|font-family|font\s*:|font-style/g) ?? []).toEqual([]);
    }
  });

  it("gives the live-line slip only to status lines, not to pending messages", () => {
    // The slip once matched every block under the feed's footer ids, which pending messages share,
    // and wrapped a message still sending in a dark oval until it landed.
    const selectors = rules.flatMap((rule) => rule.selectors);
    expect(selectors.filter((selector) => selector.includes("data-feed-block-id"))).toEqual([]);
    expect(selectors.some((selector) => selector.includes("[data-feed-status-line]"))).toBe(true);
  });

  it("puts the activity summary on top of the turn's sheet, as its header", () => {
    // On a slip of its own the summary floated above the sheet and read as a chip hiding something
    // of its own (Jiayi), not as the header of the turn below it, as it reads without a painting.
    const bodyFor = (selector: string) => rules.find((rule) => rule.selectors.includes(selector))?.body ?? "";
    const header = "html.scenic .turn-container > :has(> [data-turn-toggle]):has(+ :not(:empty))";
    expect(bodyFor(header)).toMatch(/background:\s*var\(--scenic-sheet\)/);
    expect(bodyFor(header)).toMatch(/border-radius:\s*12px 12px 0 0/);
    // The sheet below squares its top corners to join it, whether it is a plain sheet or a card.
    expect(bodyFor("html.scenic .turn-container > :has(> [data-turn-toggle]) + :not(:empty)")).toMatch(
      /border-top-left-radius:\s*0/,
    );
    expect(bodyFor("html.scenic .turn-container > :has(> [data-turn-toggle]) + * > .rounded-xl")).toMatch(
      /border-top-left-radius:\s*0/,
    );
    expect(bodyFor("html.scenic .turn-container > :has(+ :not(:empty)) > [data-turn-toggle]")).toMatch(
      /background:\s*none/,
    );
  });

  it("keeps the label slips light enough for the summary's own rules to apply", () => {
    // The slips once shared an `:is()` with the message-time selector, which lent the summary that
    // selector's weight: the night rule meant to drop the summary's ring never applied, and a rule
    // for the summary as a header would not have either. `:where()` adds no weight.
    const slip = rules.find((rule) =>
      rule.selectors.some((selector) => selector.includes("minute-boundary-timestamp")),
    );
    expect(slip?.body).toMatch(/background:\s*var\(--scenic-sheet\)/);
    expect(slip?.selectors.find((selector) => selector.includes("[data-turn-toggle]"))).toMatch(
      /^html\.scenic :where\(/,
    );
  });

  it("gives activity holding messages from mid-turn its sheet", () => {
    // A worker's turn can hold its leader's messages, which arrive while it works. Excluding every
    // turn item with a message bubble from the sheet left that whole activity, answers included,
    // on the bare painting; only the message that opens the turn (its first item) sits on it.
    const sheet = rules.find((rule) =>
      rule.selectors.some((selector) => /^html\.scenic \.turn-container > :where\(:not\(/.test(selector)),
    );
    expect(sheet?.body).toMatch(/background:\s*var\(--scenic-sheet\)/);
    const selector = sheet!.selectors[0]!;
    expect(selector).toContain(':first-child:has([data-testid="user-message-bubble"])');
    expect(selector.match(/user-message-bubble/g)).toHaveLength(1);
  });

  it("gives your messages on paper a deeper tone of the bubble", () => {
    // The side column's paper, and a turn's sheet, are nearly the bubble's colour (Jiayi: they
    // blended in Ink & Paper), so there the bubble and the time beside it take the deeper tone, by
    // day and by night.
    const bodiesFor = (pattern: RegExp) =>
      rules
        .filter((rule) => rule.selectors.some((selector) => pattern.test(selector)))
        .map((rule) => rule.body)
        .join("\n");
    expect(bodiesFor(/^html\.scenic$/)).toMatch(
      /--scenic-deep-bubble:\s*color-mix\(in oklab, var\(--color-cc-user-bubble\)/,
    );
    expect(bodiesFor(/^html\.dark\.scenic$/)).toContain("--scenic-deep-bubble");
    const bubbles = rules.find((rule) =>
      rule.selectors.some(
        (selector) => /\[data-testid="user-message-bubble"\]$/.test(selector) && selector.includes(":is("),
      ),
    );
    expect(bubbles?.body).toContain("--color-cc-user-bubble: var(--scenic-deep-bubble)");
    expect(bubbles?.selectors[0]).toContain('[data-testid="topic-side-panel"]');
    expect(bubbles?.selectors[0]).toContain(".turn-container > :not(:first-child)");
    expect(bodiesFor(/topic-side-panel"\][\s\S]*message-time-label/)).toContain("var(--scenic-deep-bubble)");
  });

  it("makes the sheet from each theme's own paper, by day and by night", () => {
    // Meadow, Seaside and Ink & Paper each set their page and card colours; the sheet is mixed from
    // them rather than from a fixed colour, so every theme keeps its own paper.
    const sheetFor = (selector: string) =>
      rules.find((rule) => rule.selectors.includes(selector))?.body.match(/--scenic-sheet:\s*([^;]+);/)?.[1];
    expect(sheetFor("html.scenic")).toContain("var(--color-cc-bg)");
    expect(sheetFor("html.dark.scenic")).toContain("var(--color-cc-card)");
  });
});

describe("layering", () => {
  // Menus, popovers and hover cards rely on their z-index counting across the page. A property
  // that makes a stacking context on a styled container (the status-row bar's backdrop blur once
  // did) confines their z-index to that container, and the conversation after it then covers the
  // open menu. The keyframes only animate the backdrop's own layers, so they are left out.
  it("adds no stacking context to the page's own elements", () => {
    expect(scenicCss).toContain("html.scenic");
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
