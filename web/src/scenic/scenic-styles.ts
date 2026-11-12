/**
 * Scenic backgrounds: an optional appearance setting that sets Takode's views inside a
 * hand-painted landscape without changing what any control does. Each style is a class on <html>
 * (`scenic scenic-<style>`) that re-tints the theme variables in light and dark and softens a few
 * stable surfaces, plus the painted scene behind the conversation and its own fanfares for a quest
 * finishing and a change landing. Off adds nothing.
 */
import type { ScenicBackground } from "../../shared/scenic-background.js";
import { useStore } from "../store.js";
import type { InkPalette } from "./ink-alive/ink-alive-gl.js";

/** A painted scene. Ink & Colour is the Ink & Paper scene washed with colour by day. */
export type ScenicStyle = "meadow" | "seaside" | "ink";

export interface ScenicChoice {
  id: Exclude<ScenicBackground, "off">;
  /** The painted scene it shows. */
  scene: ScenicStyle;
  label: string;
  blurb: string;
  /** The Settings tile's picture, day and night. */
  thumbs: [string, string];
}

export const SCENIC_STYLES: readonly ScenicChoice[] = [
  {
    id: "meadow",
    scene: "meadow",
    label: "Summer Meadow",
    blurb: "A painted summer valley under towering clouds; fireflies at night.",
    thumbs: ["meadow-day-thumb", "meadow-night-thumb"],
  },
  {
    id: "seaside",
    scene: "seaside",
    label: "Seaside Town",
    blurb: "A hillside town above a sparkling sea; a moonlit bay at night.",
    thumbs: ["seaside-day-thumb", "seaside-night-thumb"],
  },
  {
    id: "ink",
    scene: "ink",
    label: "Ink & Paper",
    blurb: "An ink-wash landscape on rice paper, with drifting mist.",
    thumbs: ["ink-day-thumb", "ink-night-thumb"],
  },
  {
    id: "inkColor",
    scene: "ink",
    label: "Ink & Colour",
    blurb: "The ink landscape washed in light ochre and blue by day, in the 浅绛 manner; ink by moonlight.",
    // Night is the ink painting itself.
    thumbs: ["ink-colour-day-thumb", "ink-night-thumb"],
  },
];

/** The scene a background shows, or null for Off. */
export function scenicSceneOf(background: ScenicBackground): ScenicStyle | null {
  return SCENIC_STYLES.find((choice) => choice.id === background)?.scene ?? null;
}

/** How the Ink & Paper scene is coloured for a background: pure ink, or ochre and blue by day. */
export function inkPaletteOf(background: ScenicBackground): InkPalette {
  return background === "inkColor" ? "ochre" : "ink";
}

/** Fired when a quest-finishing fanfare starts, so the scene can lift its reading veil. */
export const SCENIC_REVEAL_EVENT = "scenic-reveal";

/** The active scenic style, or null when the setting is Off. */
export function useScenicStyle(): ScenicStyle | null {
  return useStore((state) => scenicSceneOf(state.scenicBackground));
}

export function getScenicStyle(): ScenicStyle | null {
  return scenicSceneOf(useStore.getState().scenicBackground);
}

/** Puts the classes for `background`'s scene on <html>, removing any other scene's. */
export function applyScenicClass(background: ScenicBackground): void {
  const root = document.documentElement;
  const scene = scenicSceneOf(background);
  for (const { scene: other } of SCENIC_STYLES) root.classList.toggle(`scenic-${other}`, scene === other);
  root.classList.toggle("scenic", scene !== null);
}

/** Whether effects may move: never with reduced motion. */
export function scenicMotionAllowed(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
