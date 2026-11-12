/**
 * Scenic backgrounds: an optional appearance setting that sets Takode's views inside a
 * hand-painted landscape without changing what any control does. Each style is a class on <html>
 * (`scenic scenic-<style>`) that re-tints the theme variables in light and dark and softens a few
 * stable surfaces, plus the painted scene behind the conversation and its own fanfares for a quest
 * finishing and a change landing. Off adds nothing.
 */
import type { ScenicBackground } from "../../shared/scenic-background.js";
import { useStore } from "../store.js";

export type ScenicStyle = Exclude<ScenicBackground, "off">;

export const SCENIC_STYLES: ReadonlyArray<{ id: ScenicStyle; label: string; blurb: string }> = [
  {
    id: "meadow",
    label: "Summer Meadow",
    blurb: "A painted summer valley under towering clouds; fireflies at night.",
  },
  {
    id: "seaside",
    label: "Seaside Town",
    blurb: "A hillside town above a sparkling sea; a moonlit bay at night.",
  },
  {
    id: "ink",
    label: "Ink & Paper",
    blurb: "An ink landscape washed in light ochre and blue, with a sea of clouds; ink by moonlight.",
  },
];

/** Fired when a quest-finishing fanfare starts, so the scene can lift its reading veil. */
export const SCENIC_REVEAL_EVENT = "scenic-reveal";

/** The active scenic style, or null when the setting is Off. */
export function useScenicStyle(): ScenicStyle | null {
  return useStore((state) => (state.scenicBackground === "off" ? null : state.scenicBackground));
}

export function getScenicStyle(): ScenicStyle | null {
  const background = useStore.getState().scenicBackground;
  return background === "off" ? null : background;
}

/** Puts the classes for `background` on <html>, removing any other style's. */
export function applyScenicClass(background: ScenicBackground): void {
  const root = document.documentElement;
  for (const { id } of SCENIC_STYLES) root.classList.toggle(`scenic-${id}`, background === id);
  root.classList.toggle("scenic", background !== "off");
}

/** Whether effects may move: never with reduced motion. */
export function scenicMotionAllowed(): boolean {
  return !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
