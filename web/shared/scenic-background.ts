/**
 * The scenic background setting: Off, or one of the painted landscapes shown behind the
 * conversation. Saved in the server's settings like other appearance preferences.
 */
export type ScenicBackground = "off" | "meadow" | "seaside" | "ink";

export const SCENIC_BACKGROUNDS: readonly ScenicBackground[] = ["off", "meadow", "seaside", "ink"];

export function isScenicBackground(value: unknown): value is ScenicBackground {
  return SCENIC_BACKGROUNDS.includes(value as ScenicBackground);
}

/**
 * A saved value as the app uses it; anything missing or unknown is Off. Ink & Colour
 * (`inkColor`) was merged into Ink & Paper, which is now the colour version, so it reads as that.
 */
export function normalizeScenicBackground(value: unknown): ScenicBackground {
  if (value === "inkColor") return "ink";
  return isScenicBackground(value) ? value : "off";
}
