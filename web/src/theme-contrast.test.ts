import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LIGHT_CARD = "#ffffff";
const LIGHT_BG = "#f5f5f0";
const LIGHT_SIDEBAR = "#edeae2";
const LIGHT_CODE_BG = "#ece9df";
const DARK_CARD = "#181818";
const DARK_PARTICIPANT_CHIP_BG = "#202020";
const VSCODE_DARK_CARD = "#262626";
const VSCODE_DARK_PARTICIPANT_CHIP_BG = "#222222";
const MIN_NORMAL_TEXT_AA = 4.5;
const PHASE_THREAD_TAB_TITLE_TOKENS = [
  "--color-cc-phase-thread-tab-title-amber",
  "--color-cc-phase-thread-tab-title-blue",
  "--color-cc-phase-thread-tab-title-cyan",
  "--color-cc-phase-thread-tab-title-emerald",
  "--color-cc-phase-thread-tab-title-fuchsia",
  "--color-cc-phase-thread-tab-title-green",
  "--color-cc-phase-thread-tab-title-orange",
  "--color-cc-phase-thread-tab-title-sky",
  "--color-cc-phase-thread-tab-title-violet",
  "--color-cc-phase-thread-tab-title-yellow",
] as const;

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.css"), "utf8");

function cssVariable(name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing CSS variable ${name}`);
  return match[1].trim();
}

function cssVariableForSelector(selector: string, name: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) throw new Error(`Missing CSS selector ${selector}`);
  const variableMatch = match[1].match(new RegExp(`${name}:\\s*([^;]+);`));
  if (!variableMatch) throw new Error(`Missing CSS variable ${name} in ${selector}`);
  return variableMatch[1].trim();
}

type Rgb = [number, number, number];
type Rgba = [number, number, number, number];

function hexToRgb(hex: string): Rgb {
  const normalized = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Expected hex color, got ${hex}`);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function colorToRgba(color: string): Rgba {
  const trimmed = color.trim();
  if (trimmed.startsWith("#")) {
    const [r, g, b] = hexToRgb(trimmed);
    return [r, g, b, 1];
  }
  const match = trimmed.match(/^rgba?\(([^)]+)\)$/);
  if (!match) throw new Error(`Expected hex or rgb(a) color, got ${color}`);
  const [r, g, b, a] = match[1].split(",").map((part) => Number(part.trim()));
  return [r, g, b, a ?? 1];
}

function blend(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
}

function withAlpha(color: string, alpha: number): Rgba {
  const [r, g, b] = colorToRgba(color);
  return [r, g, b, alpha];
}

function withMultipliedAlpha(color: string, opacity: number): Rgba {
  const [r, g, b, alpha] = colorToRgba(color);
  return [r, g, b, alpha * opacity];
}

function relativeLuminance([r, g, b]: Rgb): number {
  const [sr, sg, sb] = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * sr + 0.7152 * sg + 0.0722 * sb;
}

function contrastRatio(foreground: string | Rgba, background: string | Rgba): number {
  const foregroundColor = typeof foreground === "string" ? colorToRgba(foreground) : foreground;
  const backgroundColor = typeof background === "string" ? colorToRgba(background) : background;
  const foregroundLuminance = relativeLuminance(foregroundColor.slice(0, 3) as Rgb);
  const backgroundLuminance = relativeLuminance(backgroundColor.slice(0, 3) as Rgb);
  const light = Math.max(foregroundLuminance, backgroundLuminance);
  const dark = Math.min(foregroundLuminance, backgroundLuminance);
  return (light + 0.05) / (dark + 0.05);
}

describe("theme contrast tokens", () => {
  it("keeps light-theme muted metadata readable on card and app backgrounds", () => {
    const muted = cssVariable("--color-cc-muted");

    expect(contrastRatio(muted, LIGHT_CARD)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
    expect(contrastRatio(muted, LIGHT_BG)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
  });

  it("keeps light syntax comments readable on the light code surface", () => {
    const comment = cssVariable("--cc-syntax-comment");

    expect(contrastRatio(comment, LIGHT_CODE_BG)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
  });

  it("keeps selected light sidebar metadata readable on the active row background", () => {
    const activeRowBackground = blend(colorToRgba(cssVariable("--color-cc-active")), colorToRgba(LIGHT_SIDEBAR));
    const selectedMetadataForeground = blend(withAlpha(cssVariable("--color-cc-fg"), 0.8), activeRowBackground);

    expect(contrastRatio(selectedMetadataForeground, activeRowBackground)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
  });

  it("keeps selected light sidebar git diff tokens readable on the active row background", () => {
    const activeRowBackground = blend(colorToRgba(cssVariable("--color-cc-active")), colorToRgba(LIGHT_SIDEBAR));
    const selectedGitDiffForeground = blend(withAlpha(cssVariable("--color-cc-fg"), 0.8), activeRowBackground);

    expect(contrastRatio(selectedGitDiffForeground, activeRowBackground)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
  });

  it("keeps theme-readable muted labels readable on dark action and chip surfaces", () => {
    expect(css).toMatch(/\.cc-muted-readable\s*{\s*color:\s*var\(--color-cc-muted-readable\)\s*!important;/);
    expect(css).toMatch(/\.cc-muted-readable:hover\s*{\s*color:\s*var\(--color-cc-fg\)\s*!important;/);
    expect(css).toMatch(
      /\.cc-participant-muted-readable\s*{\s*color:\s*var\(--color-cc-participant-muted-readable\)\s*!important;/,
    );

    const darkMuted = cssVariableForSelector(".dark", "--color-cc-muted");
    const darkReadableMuted = cssVariableForSelector(".dark .cc-muted-readable", "--color-cc-muted-readable");
    const darkParticipantReadableMuted = cssVariableForSelector(
      ".dark .cc-participant-muted-readable",
      "--color-cc-participant-muted-readable",
    );
    const vscodeDarkReadableMuted = cssVariableForSelector(
      ".theme-vscode-dark .cc-muted-readable",
      "--color-cc-muted-readable",
    );
    const vscodeDarkParticipantReadableMuted = cssVariableForSelector(
      ".theme-vscode-dark .cc-participant-muted-readable",
      "--color-cc-participant-muted-readable",
    );

    expect(contrastRatio(darkMuted, DARK_CARD)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
    expect(contrastRatio(darkReadableMuted, DARK_CARD)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
    expect(contrastRatio(darkParticipantReadableMuted, DARK_PARTICIPANT_CHIP_BG)).toBeGreaterThanOrEqual(
      MIN_NORMAL_TEXT_AA,
    );
    expect(contrastRatio(vscodeDarkReadableMuted, VSCODE_DARK_CARD)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
    expect(contrastRatio(vscodeDarkParticipantReadableMuted, VSCODE_DARK_PARTICIPANT_CHIP_BG)).toBeGreaterThanOrEqual(
      MIN_NORMAL_TEXT_AA,
    );
  });

  it("keeps light Work Board thread-tab phase titles readable on non-selected tab backgrounds", () => {
    const nonSelectedTabOnCard = blend(
      withMultipliedAlpha(cssVariable("--color-cc-hover"), 0.3),
      colorToRgba(LIGHT_CARD),
    );
    const nonSelectedTabOnApp = blend(withMultipliedAlpha(cssVariable("--color-cc-hover"), 0.3), colorToRgba(LIGHT_BG));

    // Work Board tab titles are normal text, so they need readable foreground
    // tokens instead of raw bright Journey metadata accents.
    for (const token of PHASE_THREAD_TAB_TITLE_TOKENS) {
      const titleColor = cssVariable(token);
      expect(contrastRatio(titleColor, nonSelectedTabOnCard)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
      expect(contrastRatio(titleColor, nonSelectedTabOnApp)).toBeGreaterThanOrEqual(MIN_NORMAL_TEXT_AA);
    }
  });
});
