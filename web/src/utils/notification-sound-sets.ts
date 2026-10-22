/** One oscillator note with a 10 ms attack and an exponential decay. */
export interface NotificationTone {
  /** Seconds after the sound starts. */
  at: number;
  freq: number;
  /** Optional pitch the note glides to (exponentially) over `glide` seconds. */
  toFreq?: number;
  glide?: number;
  gain: number;
  /** Seconds until the note has decayed to silence. */
  duration: number;
  type: OscillatorType;
}

/** The two alert sounds of one set: a new needs-input prompt and a tab turning unread. */
interface NotificationSoundSet {
  id: string;
  label: string;
  needsInput: readonly NotificationTone[];
  review: readonly NotificationTone[];
}

const A4 = 440;
const C5 = 523.25;
const D5 = 587.33;
const E5 = 659.25;
const G5 = 783.99;
const B5 = 987.77;

function tone(
  at: number,
  freq: number,
  gain: number,
  duration: number,
  type: OscillatorType = "sine",
): NotificationTone {
  return { at, freq, gain, duration, type };
}

/** A struck metal bowl: a fundamental with a slowly beating twin and two inharmonic partials. */
function bowl(at: number, freq: number, duration: number, gain: number): NotificationTone[] {
  return [
    tone(at, freq, gain, duration),
    tone(at, freq + 3, gain * 0.6, duration),
    tone(at, freq * 2.71, gain * 0.25, duration * 0.6),
    tone(at, freq * 5.15, gain * 0.1, duration * 0.35),
  ];
}

/** A soft electric-piano chord: each note with a quickly fading octave. */
function chord(at: number, freqs: readonly number[], duration: number, gain: number): NotificationTone[] {
  return freqs.flatMap((freq) => [tone(at, freq, gain, duration), tone(at, freq * 2, gain * 0.3, duration * 0.4)]);
}

/**
 * The selectable sets, so people sharing a room can tell whose alert rang.
 * Classic is the original pair: a gentle E5 double-tap for needs-input and an
 * overlapping E5 → G5 chime for review.
 */
export const NOTIFICATION_SOUND_SETS = [
  {
    id: "classic",
    label: "Classic",
    needsInput: [tone(0, E5, 0.3, 0.15), tone(0.3, E5, 0.3, 0.15)],
    review: [tone(0, E5, 0.3, 0.3), tone(0.15, G5, 0.3, 0.35)],
  },
  {
    id: "singing-bowl",
    label: "Singing Bowl",
    needsInput: [...bowl(0, D5, 0.5, 0.2), ...bowl(0.2, D5, 0.7, 0.2)],
    review: bowl(0, A4, 1.3, 0.22),
  },
  {
    id: "lounge-piano",
    label: "Lounge Piano",
    needsInput: [...chord(0, [A4, C5, E5, G5], 0.28, 0.08), ...chord(0.2, [A4, C5, E5, G5], 0.28, 0.08)],
    // A rolled Cmaj7: each note 50 ms after the previous.
    review: [C5, E5, G5, B5].flatMap((freq, i) => chord(i * 0.05, [freq], 0.9, 0.09)),
  },
] as const satisfies readonly NotificationSoundSet[];

/** Plays the user's own uploaded sounds (kept on the server), or Classic for a sound not uploaded yet. */
export const CUSTOM_NOTIFICATION_SOUND_SET = "custom";

export type BuiltInNotificationSoundSetId = (typeof NOTIFICATION_SOUND_SETS)[number]["id"];

export type NotificationSoundSetId = BuiltInNotificationSoundSetId | typeof CUSTOM_NOTIFICATION_SOUND_SET;

export const DEFAULT_NOTIFICATION_SOUND_SET: BuiltInNotificationSoundSetId = "classic";

/** Every choice in Settings, in order: the built-in sets, then Custom. */
export const NOTIFICATION_SOUND_SET_CHOICES: ReadonlyArray<{ id: NotificationSoundSetId; label: string }> = [
  ...NOTIFICATION_SOUND_SETS.map(({ id, label }) => ({ id, label })),
  { id: CUSTOM_NOTIFICATION_SOUND_SET, label: "Custom" },
];

/** Narrows a stored value to a known set, falling back to the default for unknown or retired ids. */
export function toNotificationSoundSetId(value: string | null | undefined): NotificationSoundSetId {
  return NOTIFICATION_SOUND_SET_CHOICES.find((choice) => choice.id === value)?.id ?? DEFAULT_NOTIFICATION_SOUND_SET;
}
