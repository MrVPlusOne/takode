/**
 * The typing effect setting: when chat inputs get the typing feel (the glowing caret and the gold
 * leaf or sparks each key throws). Saved in the server's settings like other appearance preferences.
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
