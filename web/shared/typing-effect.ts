/**
 * The typing effect settings: when chat inputs get the typing feel (the glowing caret and the
 * burst each key throws), and what each key throws in the light and the dark theme. Saved in the server's settings like other appearance preferences.
 */
export type TypingEffect = "off" | "scenic" | "always";

export const TYPING_EFFECTS: readonly TypingEffect[] = ["off", "scenic", "always"];

/** Only while a scenic background is on, as it played before it had its own setting. */
export const DEFAULT_TYPING_EFFECT: TypingEffect = "scenic";

export function isTypingEffect(value: unknown): value is TypingEffect {
  return TYPING_EFFECTS.includes(value as TypingEffect);
}

/** A saved value as the app uses it; anything missing or unknown is the default. */
export function normalizeTypingEffect(value: unknown): TypingEffect {
  return isTypingEffect(value) ? value : DEFAULT_TYPING_EFFECT;
}

/** What each typed key throws: forge sparks, gold glints (small stars) or a flake of gold leaf. */
export type TypingThrow = "sparks" | "glints" | "leaf";

export const TYPING_THROWS: readonly TypingThrow[] = ["sparks", "glints", "leaf"];

/** The throw chosen for the light and for the dark theme. */
export interface TypingThrows {
  light: TypingThrow;
  dark: TypingThrow;
}

/** Sparks in both themes: the effect Jiayi found most satisfying, carried over to paper by day. */
export const DEFAULT_TYPING_THROWS: TypingThrows = { light: "sparks", dark: "sparks" };

export function isTypingThrow(value: unknown): value is TypingThrow {
  return TYPING_THROWS.includes(value as TypingThrow);
}

/** A saved value as the app uses it; a missing or unknown throw for a theme is that theme's default. */
export function normalizeTypingThrows(value: unknown): TypingThrows {
  const saved = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof TypingThrows, unknown>>;
  return {
    light: isTypingThrow(saved.light) ? saved.light : DEFAULT_TYPING_THROWS.light,
    dark: isTypingThrow(saved.dark) ? saved.dark : DEFAULT_TYPING_THROWS.dark,
  };
}
